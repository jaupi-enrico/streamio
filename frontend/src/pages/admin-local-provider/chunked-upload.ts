/**
 * Chunked upload of one video file — a port of the vanilla page's uploader.
 *
 * The file goes up in fixed-size chunks rather than one big multipart POST: a
 * Cloudflare Tunnel (or similar proxy) in front of an install resets any
 * request body over ~100MB, which a movie always is — the browser sees
 * ERR_CONNECTION_RESET and the server never sees the request. Chunks also mean
 * an interrupted transfer costs one chunk instead of the whole file, and the
 * access token can be refreshed halfway through an upload that outlives it.
 */
import { api, getAccessToken, refreshAccessToken } from "../../lib/auth";
import { apiUrl } from "../../lib/base";

export const BASE = "/api/admin/local-provider";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChunkError extends Error {
  status?: number;
  data?: { error?: string; received?: number };
  cancelled?: boolean;
}

function chunkError(message: string, extra: Partial<ChunkError> = {}): ChunkError {
  return Object.assign(new Error(message), extra);
}

async function authToken(): Promise<string> {
  const token = getAccessToken() || (await refreshAccessToken());
  if (!token) throw new Error("Not signed in.");
  return token;
}

export interface UploadControl {
  cancelled: boolean;
  xhr: XMLHttpRequest | null;
  uploadId: string | null;
}

function sendChunk(
  ctrl: UploadControl,
  uploadId: string,
  offset: number,
  blob: Blob,
  token: string,
  onLoaded: (loaded: number) => void,
): Promise<{ received?: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    ctrl.xhr = xhr;
    xhr.open("POST", apiUrl(`${BASE}/uploads/${uploadId}/chunk?offset=${offset}`));
    xhr.withCredentials = true;
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onLoaded(e.loaded);
    };
    xhr.onload = () => {
      let data: { error?: string; received?: number } = {};
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {
        // Empty body.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      reject(chunkError(data.error || `HTTP ${xhr.status}`, { status: xhr.status, data }));
    };
    xhr.onerror = () => reject(chunkError("Connection lost.", { status: 0 }));
    xhr.onabort = () => reject(chunkError("Upload cancelled.", { cancelled: true }));
    xhr.send(blob);
  });
}

async function sendChunkWithRetry(
  ctrl: UploadControl,
  uploadId: string,
  offset: number,
  blob: Blob,
  onLoaded: (loaded: number) => void,
): Promise<{ received?: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (ctrl.cancelled) throw chunkError("Upload cancelled.", { cancelled: true });
    try {
      return await sendChunk(ctrl, uploadId, offset, blob, await authToken(), onLoaded);
    } catch (err) {
      const e = err as ChunkError;
      if (e.cancelled) throw e;
      lastErr = e;
      // The access token expired mid-upload: refresh and re-send this chunk
      // only — the whole point of chunking.
      if (e.status === 401) {
        await refreshAccessToken();
        continue;
      }
      // The server knows better than we do how much it actually holds.
      if (e.status === 409 && typeof e.data?.received === "number") return e.data;
      // A rejected/absent session won't start working on a retry.
      if (e.status === 400 || e.status === 404) throw e;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

export interface UploadSession {
  uploadId: string;
  chunkSize: number;
}

/**
 * Uploads `file` for one slot, reporting bytes through `onProgress`. Returns
 * the finished file's id. Throws with `cancelled` set when aborted.
 */
export async function uploadFile(
  ctrl: UploadControl,
  targetKind: string,
  targetId: string,
  file: File,
  onProgress: (loaded: number) => void,
): Promise<string> {
  const session = await api<UploadSession>(`${BASE}/uploads`, {
    method: "POST",
    body: { targetKind, targetId, filename: file.name, size: file.size },
  });
  ctrl.uploadId = session.uploadId;

  let offset = 0;
  let stalls = 0;
  while (offset < file.size) {
    if (ctrl.cancelled) throw chunkError("Upload cancelled.", { cancelled: true });

    const end = Math.min(offset + session.chunkSize, file.size);
    const base = offset;
    const result = await sendChunkWithRetry(ctrl, session.uploadId, offset, file.slice(offset, end), (loaded) =>
      onProgress(Math.min(base + loaded, file.size)),
    );

    const received = typeof result.received === "number" ? result.received : end;
    // A resync that doesn't move is the only way this loop could spin.
    if (received <= offset && ++stalls > 4) throw new Error("Upload stalled — try again.");
    if (received > offset) stalls = 0;
    offset = received;
    onProgress(offset);
  }

  const done = await api<{ fileId: string }>(`${BASE}/uploads/${session.uploadId}/complete`, { method: "POST" });
  return done.fileId;
}

export function isCancelled(err: unknown): boolean {
  return Boolean((err as ChunkError)?.cancelled);
}
