/**
 * "Download MP4" — downloadVideo / downloadMP4 / downloadHLSYTDLP /
 * getFFmpeg / mergeFFmpeg in public/scripts/watch.js. Fetches the highest
 * variant's segments (and a separate audio rendition when the master names
 * one), decrypts AES-128, and remuxes to MP4 with ffmpeg.wasm in the browser.
 *
 * ffmpeg is imported only when a download starts — the vanilla page loaded it
 * with the page itself. Its worker lives in frontend/public/vendor/ffmpeg: it
 * must be a real same-origin URL, since it has relative imports of its own
 * that don't resolve against a blob: base (load()/exec() then hang forever).
 */
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { concatUint8Arrays, decryptAES128, parseMaster, parseMedia, pool, segmentIv, type HlsKey } from "./logic/hls-download";
import { Store } from "./store";

export interface DownloadHost {
  /** hls.js's absolute manifest URL, else the URL last handed to the element. */
  manifestUrl(): string | null;
  /** The page heading (the vanilla page read #contentTitle). */
  title(): string;
}

export interface DownloadSnapshot {
  toastShown: boolean;
  status: string;
  /** Null until the first percentage: the markup's own empty bar shows. */
  barWidth: string | null;
}

const MAX_CONCURRENT = 8;
const MAX_RETRIES = 3;
const CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";

let ffmpeg: Promise<FFmpeg> | null = null;

/** One ffmpeg.wasm per document; loading it is the slow part. */
function getFFmpeg(): Promise<FFmpeg> {
  ffmpeg ??= (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")]);
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => console.log("[ffmpeg]", message));
    await ff.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      classWorkerURL: new URL("vendor/ffmpeg/worker.js", document.baseURI).href,
    });
    return ff;
  })().catch((err: unknown) => {
    ffmpeg = null; // a failed load is retried by the next download
    throw err;
  });
  return ffmpeg;
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      return r;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((res) => setTimeout(res, 300 * (i + 1)));
    }
  }
}

async function downloadSegments(
  segments: string[],
  key: HlsKey | null,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  let keyBytes: Uint8Array | null = null;
  if (key) {
    const res = await fetchWithRetry(key.url);
    keyBytes = new Uint8Array(await res.arrayBuffer());
  }
  return pool(
    MAX_CONCURRENT,
    segments,
    async (url, idx) => {
      const res = await fetchWithRetry(url);
      const buf = await res.arrayBuffer();
      if (keyBytes) return decryptAES128(buf, keyBytes, segmentIv(key!.iv, idx));
      return new Uint8Array(buf);
    },
    onProgress,
  );
}

async function mergeFFmpeg(
  video: Uint8Array,
  audio: Uint8Array | null,
  title: string,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const progressHandler = ({ progress }: { progress: number }): void => {
    if (Number.isFinite(progress)) onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);
  try {
    await ff.writeFile("video.ts", video);
    if (audio) await ff.writeFile("audio.ts", audio);
    const args = audio
      ? ["-i", "video.ts", "-i", "audio.ts", "-c", "copy", `${title}.mp4`]
      : ["-i", "video.ts", "-c", "copy", `${title}.mp4`];
    await ff.exec(args);
    const data = await ff.readFile(`${title}.mp4`);
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  } finally {
    ff.off("progress", progressHandler);
  }
}

export class Downloader {
  readonly store = new Store<DownloadSnapshot>({ toastShown: false, status: "0%", barWidth: null });
  private downloading = false;

  constructor(private readonly host: DownloadHost) {}

  dispose(): void {
    this.store.close();
  }

  closeToast(): void {
    this.store.set({ toastShown: false });
  }

  private progress(status: string, pct: number | null): void {
    const patch: Partial<DownloadSnapshot> = { status };
    if (pct != null) patch.barWidth = `${Math.min(100, Math.max(0, pct))}%`;
    this.store.set(patch);
  }

  /** The More menu's "Download MP4". */
  async download(): Promise<void> {
    if (this.downloading) return;
    this.downloading = true;
    this.store.set({ toastShown: true });
    try {
      await this.downloadMP4();
    } catch (err) {
      alert("Download failed: " + (err as Error).message);
    } finally {
      this.downloading = false;
    }
  }

  private async downloadMP4(): Promise<void> {
    const manifestUrl = this.host.manifestUrl();
    if (!manifestUrl) {
      alert("No video loaded");
      return;
    }
    const title = (this.host.title() || "video").replace(/\s+/g, "_");
    this.store.set({ toastShown: true });
    try {
      this.progress("Analyzing stream...", 0);
      const blob = await this.downloadHls(manifestUrl, title);
      this.progress("Done", 100);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${title}.mp4`;
      a.click();
    } catch (e) {
      console.error(e);
      this.progress("Error: " + (e as Error).message, null);
    }
  }

  private async downloadHls(manifestUrl: string, title: string): Promise<Blob> {
    const text = await (await fetch(manifestUrl)).text();
    const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);

    let videoUrl = manifestUrl;
    const isMaster = text.includes("#EXT-X-STREAM-INF");
    if (isMaster) videoUrl = parseMaster(text, baseUrl)[0]!.url;

    const mediaText = await (await fetch(videoUrl)).text();
    const mediaBase = videoUrl.substring(0, videoUrl.lastIndexOf("/") + 1);
    const { segments, key } = parseMedia(mediaText, mediaBase);
    console.log(`Segments: ${segments.length}`);
    console.log(`AES key:`, key);

    // #EXT-X-MEDIA:TYPE=AUDIO sits in the master, next to the variants, not
    // in the chosen variant's own playlist.
    const audioLine = isMaster
      ? text.split("\n").find((l) => l.includes("EXT-X-MEDIA") && l.includes("TYPE=AUDIO"))
      : undefined;
    const videoShare = audioLine ? 60 : 85;

    this.progress(`Downloading video segments (0/${segments.length})`, 0);
    const videoData = await downloadSegments(segments, key, (done, total) =>
      this.progress(`Downloading video segments (${done}/${total})`, (done / total) * videoShare),
    );

    let audioData: Uint8Array[] | null = null;
    if (audioLine) {
      try {
        const audioUrl = new URL(audioLine.split('URI="')[1]!.split('"')[0]!, baseUrl).href;
        const audioText = await (await fetch(audioUrl)).text();
        const audio = parseMedia(audioText, audioUrl);
        this.progress(`Downloading audio segments (0/${audio.segments.length})`, videoShare);
        audioData = await downloadSegments(audio.segments, audio.key, (done, total) =>
          this.progress(`Downloading audio segments (${done}/${total})`, videoShare + (done / total) * (85 - videoShare)),
        );
      } catch (e) {
        console.warn("Audio failed:", e);
      }
    }

    const videoFlat = concatUint8Arrays(videoData);
    const audioFlat = audioData ? concatUint8Arrays(audioData) : null;

    this.progress("Merging with ffmpeg...", 85);
    return mergeFFmpeg(videoFlat, audioFlat, title, (frac) =>
      this.progress(`Merging with ffmpeg... ${Math.round(frac * 100)}%`, 85 + frac * 13),
    );
  }
}
