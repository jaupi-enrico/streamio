/**
 * Admin: the local library — a port of public/admin-local-provider.html +
 * scripts/admin-local-provider.js. Add movies and shows, fill them in from a
 * TMDB id, upload the video files and watch them transcode.
 *
 * Styled by the account stylesheet plus its own, so it uses that scope.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type JSX,
  type ReactNode,
} from "react";
import { IconAlert, IconFilm } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { TopNav } from "../../components/layout/TopNav";
import { useStatusToast } from "../../components/ui/Toast";
import { useAdminAccess } from "../../hooks/useAdminAccess";
import { usePageScope } from "../../hooks/usePageScope";
import { api } from "../../lib/auth";
import { pageHref } from "../../lib/pages";
import { BASE, isCancelled, uploadFile, type UploadControl } from "./chunked-upload";
import {
  endUploadState,
  getTranscode,
  getUpload,
  setTranscodeState,
  startUploadState,
  subscribeSlot,
  subscribeUploads,
  updateUploadState,
  uploadCount,
} from "./upload-store";
import "../account/account.css";
import "../account/admin-local-provider.css";

const ACCEPT = "video/*,.mkv,.ts,.m2ts,.vob,.divx";

// ── Types ──

type FileStatus = "pending" | "transcoding" | "ready" | "failed" | null;

interface TitleRow {
  id: string;
  media_type: "movie" | "tv";
  title: string;
  poster: string | null;
  released: string | null;
  runtime: number | null;
  tmdb_id: number | string | null;
  file_id: string | null;
  file_status: FileStatus;
  file_error: string | null;
  duration_seconds: number | null;
  episode_count?: number;
  episode_ready?: number;
  episode_working?: number;
  episode_failed?: number;
}

interface EpisodeRow {
  id: string;
  number: number;
  title: string | null;
  file_id: string | null;
  file_status: FileStatus;
  file_error: string | null;
  duration_seconds: number | null;
}

interface SeasonRow {
  id: string;
  number: number;
  name: string | null;
  episodes?: EpisodeRow[];
}

interface TitleDetail extends TitleRow {
  overview: string | null;
  seasons?: SeasonRow[];
}

interface SlotFile {
  id: string | null;
  status: FileStatus;
  error: string | null;
  duration: number | null;
}

const slotKeyFor = (kind: string, id: string) => `${kind}:${id}`;
const fileOf = (row: { file_id: string | null; file_status: FileStatus; file_error: string | null; duration_seconds: number | null }): SlotFile => ({
  id: row.file_id,
  status: row.file_status,
  error: row.file_error,
  duration: row.duration_seconds,
});

// ── Formatting ──

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDuration(seconds: number | null): string {
  if (!Number.isFinite(seconds as number) || (seconds ?? 0) <= 0) return "";
  const h = Math.floor((seconds as number) / 3600);
  const m = Math.round(((seconds as number) % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function year(dateStr: string | null): string {
  const y = String(dateStr ?? "").slice(0, 4);
  return /^\d{4}$/.test(y) ? y : "";
}

/** One title's headline state: a movie's own file, or a show's episodes rolled up. */
function titleState(t: TitleRow): { cls: string; label: string } {
  if (t.media_type === "movie") {
    switch (t.file_status) {
      case "ready":
        return { cls: "ready", label: "Ready" };
      case "transcoding":
        return { cls: "working", label: "Processing" };
      case "pending":
        return { cls: "working", label: "Queued" };
      case "failed":
        return { cls: "failed", label: "Failed" };
      default:
        return { cls: "none", label: "No file" };
    }
  }
  const total = t.episode_count ?? 0;
  const ready = t.episode_ready ?? 0;
  if (!total) return { cls: "none", label: "No episodes" };
  if (t.episode_failed) return { cls: "failed", label: `${ready}/${total} ready` };
  if (t.episode_working) return { cls: "working", label: `${ready}/${total} ready` };
  if (ready === total) return { cls: "ready", label: `${total} episode${total === 1 ? "" : "s"}` };
  return { cls: "none", label: `${ready}/${total} ready` };
}

// ── Shared bits ──

function Empty({ icon, title, children }: { icon: JSX.Element; title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Modal({
  id,
  open,
  children,
  onBackdropClick,
}: {
  id: string;
  open: boolean;
  children: ReactNode;
  onBackdropClick?: () => void;
}): JSX.Element {
  return (
    <div
      className={`modal-backdrop${open ? " open" : ""}`}
      id={id}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdropClick?.();
      }}
    >
      {children}
    </div>
  );
}

/** `percent === null` draws the indeterminate bar. */
function Progress({ percent, label, detail }: { percent: number | null; label: string; detail: string }): JSX.Element {
  return (
    <>
      <div className={`progress ${percent === null ? "indeterminate" : ""}`}>
        <div className="progress-fill" style={{ width: percent === null ? "" : `${percent}%` }} />
      </div>
      <div className="progress-meta">
        <span data-progress-label>{label}</span>
        <span data-progress-detail>{detail}</span>
      </div>
    </>
  );
}

// ── One file slot ──

interface SlotProps {
  slotKey: string;
  label: ReactNode;
  file: SlotFile;
  inline?: boolean;
  onPick: (slotKey: string, file: File) => void;
  onCancel: (slotKey: string) => void;
  onRetry: (fileId: string, slotKey: string) => void;
}

/**
 * One file's row. Rendered from the server's view of the file unless an
 * upload for this slot is in flight, in which case the live byte counter
 * wins — a re-render mid-upload must not wipe the progress bar. Subscribes
 * to its own slot only.
 */
function Slot({ slotKey, label, file, inline = false, onPick, onCancel, onRetry }: SlotProps): JSX.Element {
  const subscribe = useCallback((l: () => void) => subscribeSlot(slotKey, l), [slotKey]);
  const up = useSyncExternalStore(subscribe, () => getUpload(slotKey));
  const transcode = useSyncExternalStore(subscribe, () => getTranscode(slotKey));

  let pill: JSX.Element;
  let actions: ReactNode = null;
  let progress: JSX.Element | null = null;
  let errorRow: ReactNode = null;
  let sub = "";

  if (up) {
    const pct = up.total ? Math.round((up.loaded / up.total) * 100) : 0;
    pill = (
      <span className="pill working" data-slot-pill>
        Uploading
      </span>
    );
    actions = (
      <button className="btn btn-ghost btn-sm" onClick={() => onCancel(slotKey)}>
        Cancel
      </button>
    );
    progress = (
      <Progress percent={pct} label={`Uploading ${pct}%`} detail={`${formatBytes(up.loaded)} / ${formatBytes(up.total)}`} />
    );
    sub = up.name;
  } else if (!file.id) {
    pill = (
      <span className="pill none" data-slot-pill>
        No file
      </span>
    );
    actions = <UploadButton slotKey={slotKey} label="Upload" onPick={onPick} />;
  } else if (file.status === "ready") {
    pill = (
      <span className="pill ready" data-slot-pill>
        Ready
      </span>
    );
    actions = <UploadButton slotKey={slotKey} label="Replace" onPick={onPick} />;
    sub = formatDuration(file.duration);
  } else if (file.status === "failed") {
    pill = (
      <span className="pill failed" data-slot-pill>
        Failed
      </span>
    );
    actions = (
      <>
        <button className="btn btn-ghost btn-sm" onClick={() => onRetry(file.id as string, slotKey)}>
          Retry
        </button>
        <UploadButton slotKey={slotKey} label="Replace" onPick={onPick} />
      </>
    );
    errorRow = file.error ? <div className="slot-error">{file.error}</div> : null;
  } else {
    // Queued or transcoding; the poller's own percentage wins once it reports.
    const queued = transcode ? transcode.queued : file.status === "pending";
    const pct = transcode?.percent ?? null;
    pill = (
      <span className="pill working" data-slot-pill>
        {queued ? "Queued" : "Processing"}
      </span>
    );
    progress = (
      <Progress
        percent={queued ? null : pct}
        label={queued ? "Waiting for the encoder" : pct === null ? "Processing" : `Processing ${pct}%`}
        detail=""
      />
    );
  }

  return (
    <div className="slot" data-slot={slotKey} data-file-id={file.id || ""} style={inline ? undefined : { marginTop: 4 }}>
      <div className="slot-row">
        <div className="slot-label">
          {label}
          <div className="slot-sub" data-slot-sub hidden={!sub}>
            {sub}
          </div>
        </div>
        {pill}
        <div className="slot-actions">{actions}</div>
      </div>
      <div className="slot-progress" hidden={!progress}>
        {progress ?? <Progress percent={0} label="" detail="" />}
      </div>
      {errorRow}
    </div>
  );
}

function UploadButton({
  slotKey,
  label,
  onPick,
}: {
  slotKey: string;
  label: string;
  onPick: (slotKey: string, file: File) => void;
}): JSX.Element {
  return (
    <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
      {label}
      <input
        type="file"
        hidden
        accept={ACCEPT}
        data-upload={slotKey}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(slotKey, file);
        }}
      />
    </label>
  );
}

function Dropzone({ slotKey, onPick }: { slotKey: string; onPick: (slotKey: string, file: File) => void }): JSX.Element {
  const [over, setOver] = useState(false);
  const stop = (e: DragEvent) => e.preventDefault();
  return (
    <label
      className={`dropzone${over ? " dragover" : ""}`}
      data-drop={slotKey}
      onDragEnter={(e) => {
        stop(e);
        setOver(true);
      }}
      onDragOver={(e) => {
        stop(e);
        setOver(true);
      }}
      onDragLeave={(e) => {
        stop(e);
        setOver(false);
      }}
      onDrop={(e) => {
        stop(e);
        setOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) onPick(slotKey, file);
      }}
    >
      <input
        type="file"
        hidden
        accept={ACCEPT}
        data-upload={slotKey}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(slotKey, file);
        }}
      />
      <div className="dropzone-title">Drop a video file here, or click to choose</div>
      <div className="dropzone-sub">
        Any format ffmpeg can read — mp4, mkv, avi, mov and the rest. It's converted for streaming after upload.
      </div>
    </label>
  );
}

// ── Page ──

export default function AdminLocalProviderPage(): JSX.Element {
  usePageScope("account", "My Library - Streamio", "italic");
  const access = useAdminAccess();
  const queryClient = useQueryClient();
  const { toast, show } = useStatusToast(3500);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [titleModal, setTitleModal] = useState<null | "movie" | "tv">(null);
  const [seasonModal, setSeasonModal] = useState(false);
  const [episodeModal, setEpisodeModal] = useState<string | null>(null);
  const pollers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const controls = useRef(new Map<string, UploadControl>());

  const uploading = useSyncExternalStore(subscribeUploads, uploadCount);

  useEffect(() => {
    if (access.data === "no") window.location.href = pageHref("/account");
  }, [access.data]);

  const titles = useQuery<TitleRow[]>({
    queryKey: ["local-titles"],
    enabled: access.data === "yes",
    retry: false,
    queryFn: () => api<TitleRow[]>(`${BASE}/titles`),
  });

  const detail = useQuery<TitleDetail>({
    queryKey: ["local-title", detailId],
    enabled: Boolean(detailId),
    retry: false,
    queryFn: () => api<TitleDetail>(`${BASE}/titles/${detailId}`),
  });

  const reloadTitles = () => queryClient.invalidateQueries({ queryKey: ["local-titles"] });
  const refreshDetail = () => queryClient.invalidateQueries({ queryKey: ["local-title", detailId] });

  // A tab closed mid-upload leaves a partial file server-side; the sweeper
  // clears it eventually, but the warning gives the admin the chance not to.
  useEffect(() => {
    if (!uploading) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [uploading]);

  useEffect(() => {
    const running = pollers.current;
    return () => {
      for (const handle of running.values()) clearInterval(handle);
      running.clear();
    };
  }, []);

  /** Follows one file until it stops being pending/transcoding. */
  const pollFile = useCallback(
    (fileId: string, slotKey: string) => {
      if (!fileId || pollers.current.has(fileId)) return;
      const handle = setInterval(async () => {
        let file: { status: FileStatus; progress?: number };
        try {
          file = await api<{ status: FileStatus; progress?: number }>(`${BASE}/files/${fileId}/status`);
        } catch {
          clearInterval(handle);
          pollers.current.delete(fileId);
          return;
        }

        if (file.status === "pending" || file.status === "transcoding") {
          setTranscodeState(slotKey, {
            queued: file.status === "pending",
            percent: typeof file.progress === "number" ? file.progress : null,
          });
          return;
        }

        clearInterval(handle);
        pollers.current.delete(fileId);
        setTranscodeState(slotKey, null);
        if (file.status === "ready") show("Ready to play.");
        else if (file.status === "failed") show("Conversion failed — see the error on the file.", "error");
        await refreshDetail();
        void reloadTitles();
      }, 3000);
      pollers.current.set(fileId, handle);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailId],
  );

  /**
   * Pick up polling for every file the sheet shows as still working —
   * including ones started before this page was opened.
   */
  useEffect(() => {
    const t = detail.data;
    if (!t) return;
    const working = (status: FileStatus) => status === "pending" || status === "transcoding";
    if (t.media_type === "movie") {
      if (t.file_id && working(t.file_status)) pollFile(t.file_id, slotKeyFor("movie", t.id));
    } else {
      for (const season of t.seasons ?? []) {
        for (const ep of season.episodes ?? []) {
          if (ep.file_id && working(ep.file_status)) pollFile(ep.file_id, slotKeyFor("episode", ep.id));
        }
      }
    }
  }, [detail.data, pollFile]);

  async function startUpload(slotKey: string, file: File) {
    if (getUpload(slotKey)) return;
    const [kind, id] = slotKey.split(":");
    if (!kind || !id) return;

    const ctrl: UploadControl = { cancelled: false, xhr: null, uploadId: null };
    controls.current.set(slotKey, ctrl);
    startUploadState(slotKey, { loaded: 0, total: file.size, name: file.name, cancelled: false, xhr: null, uploadId: null });

    try {
      const fileId = await uploadFile(ctrl, kind, id, file, (loaded) => updateUploadState(slotKey, loaded));
      endUploadState(slotKey);
      controls.current.delete(slotKey);
      show("Uploaded — converting for streaming now.");
      await refreshDetail();
      pollFile(fileId, slotKey);
      void reloadTitles();
    } catch (err) {
      endUploadState(slotKey);
      controls.current.delete(slotKey);
      if (ctrl.uploadId) {
        api(`${BASE}/uploads/${ctrl.uploadId}`, { method: "DELETE" }).catch(() => {});
      }
      const cancelled = isCancelled(err);
      show(cancelled ? "Upload cancelled." : (err instanceof Error && err.message) || "Upload failed.", cancelled ? "success" : "error");
    }
  }

  function cancelUpload(slotKey: string) {
    const ctrl = controls.current.get(slotKey);
    if (!ctrl) return;
    ctrl.cancelled = true;
    ctrl.xhr?.abort();
  }

  async function retryFile(fileId: string, slotKey: string) {
    try {
      await api(`${BASE}/files/${fileId}/retry`, { method: "POST" });
      show("Queued again.");
      await refreshDetail();
      pollFile(fileId, slotKey);
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const slotHandlers = { onPick: (k: string, f: File) => void startUpload(k, f), onCancel: cancelUpload, onRetry: (id: string, k: string) => void retryFile(id, k) };

  // ── Library grid ──

  let content: JSX.Element;
  if (access.data === "unknown") {
    content = (
      <Empty icon={<IconAlert />} title="Couldn't Check Access">
        The server didn't answer. This isn't a permission problem — reload to try again.
      </Empty>
    );
  } else if (!access.data || access.data === "no" || titles.isPending) {
    content = (
      <div className="empty">
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Loading library…</div>
      </div>
    );
  } else if (titles.isError) {
    content = (
      <Empty icon={<IconAlert />} title="Couldn't Load">
        {titles.error.message}
      </Empty>
    );
  } else if (!titles.data.length) {
    content = (
      <Empty icon={<IconFilm />} title="Nothing Here Yet">
        Add a movie or a show, then upload the video file for it.
      </Empty>
    );
  } else {
    content = (
      <div className="lib-grid">
        {titles.data.map((t) => {
          const state = titleState(t);
          const meta = [t.media_type === "movie" ? "Movie" : "Show", year(t.released)].filter(Boolean).join(" · ");
          return (
            <button className="lib-card" data-open={t.id} type="button" key={t.id} onClick={() => setDetailId(t.id)}>
              <div className="lib-poster">
                {t.poster ? (
                  <img src={t.poster} alt="" loading="lazy" />
                ) : (
                  <div className="lib-poster-empty">
                    <IconFilm />
                  </div>
                )}
                <span className="lib-kind">{t.media_type === "movie" ? "Movie" : "TV"}</span>
                <span className={`pill ${state.cls}`}>{state.label}</span>
              </div>
              <div>
                <div className="lib-card-title">{t.title}</div>
                <div className="lib-card-meta">{meta}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  const stats = (() => {
    const list = titles.data ?? [];
    if (!list.length) return null;
    const movies = list.filter((t) => t.media_type === "movie").length;
    const shows = list.length - movies;
    const working = list.filter((t) => titleState(t).cls === "working").length;
    const failed = list.filter((t) => titleState(t).cls === "failed").length;
    const chips: { num: number; label: string; cls?: string }[] = [
      { num: movies, label: movies === 1 ? "Movie" : "Movies" },
      { num: shows, label: shows === 1 ? "Show" : "Shows" },
    ];
    if (working) chips.push({ num: working, label: "Processing", cls: "busy" });
    if (failed) chips.push({ num: failed, label: "Needs attention", cls: "bad" });
    return chips;
  })();

  // ── Detail sheet ──

  function detailBody(t: TitleDetail): JSX.Element {
    if (t.media_type === "movie") {
      const key = slotKeyFor("movie", t.id);
      const hasSomething = Boolean(getUpload(key)) || Boolean(t.file_id);
      return hasSomething ? (
        <Slot slotKey={key} label="Video file" file={fileOf(t)} {...slotHandlers} />
      ) : (
        <Dropzone slotKey={key} onPick={slotHandlers.onPick} />
      );
    }

    const seasons = t.seasons ?? [];
    return (
      <>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setSeasonModal(true)}>
            + Add Season
          </button>
        </div>
        {seasons.length === 0 ? (
          <div className="hint-row">No seasons yet — add one to start uploading episodes.</div>
        ) : (
          seasons.map((s) => (
            <div className="season" key={s.id}>
              <div className="season-head">
                <span className="season-name">
                  Season {s.number}
                  {s.name ? ` · ${s.name}` : ""}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setEpisodeModal(s.id)}>
                  + Episode
                </button>
              </div>
              {(s.episodes ?? []).length === 0 ? (
                <div className="hint-row">No episodes in this season yet.</div>
              ) : (
                <div className="ep-list">
                  {(s.episodes ?? []).map((e) => (
                    <Slot
                      key={e.id}
                      slotKey={slotKeyFor("episode", e.id)}
                      label={
                        <>
                          <span className="ep-num">E{String(e.number).padStart(2, "0")}</span>
                          {e.title || "Untitled"}
                        </>
                      }
                      file={fileOf(e)}
                      inline
                      {...slotHandlers}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </>
    );
  }

  async function deleteTitle() {
    const t = detail.data;
    if (!t) return;
    if (!confirm(`Delete "${t.title}"? Its uploaded video files go too.`)) return;
    try {
      await api(`${BASE}/titles/${t.id}`, { method: "DELETE" });
      setDetailId(null);
      show("Deleted.");
      void reloadTitles();
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    }
  }

  return (
    <>
      <TopNav signOut />

      <div className="page-body">
        <div className="section-head">
          <div>
            <div className="section-title">My Library</div>
            <div className="section-sub">
              Your own movies and shows, uploaded here and played through the <strong>local</strong> provider.{" "}
              <AppLink to="/admin/providers">← Manage Providers</AppLink>
            </div>
          </div>
          <div className="lib-head-actions">
            <button className="btn btn-secondary btn-sm" id="addMovieBtn" onClick={() => setTitleModal("movie")}>
              + Add Movie
            </button>
            <button className="btn btn-secondary btn-sm" id="addShowBtn" onClick={() => setTitleModal("tv")}>
              + Add Show
            </button>
          </div>
        </div>

        <div id="libStats" className="lib-stats" hidden={!stats}>
          {(stats ?? []).map((c) => (
            <div className="stat" key={c.label}>
              <span className={`stat-num ${c.cls || ""}`}>{c.num}</span>
              <span className="stat-label">{c.label}</span>
            </div>
          ))}
        </div>

        <div id="titlesContent">{content}</div>
      </div>

      <AddTitleModal
        kind={titleModal}
        onClose={() => setTitleModal(null)}
        onCreated={async (id) => {
          setTitleModal(null);
          show("Added.");
          await reloadTitles();
          setDetailId(id);
        }}
        onError={(msg) => show(msg, "error")}
      />

      {/* The sheet never closes on a backdrop click while a file is going up:
          the upload keeps running, and losing the bar looks like a crash. */}
      <Modal
        id="detailModal"
        open={Boolean(detailId)}
        onBackdropClick={() => {
          if (!uploading) setDetailId(null);
        }}
      >
        <div className="modal modal-lg">
          <div id="detailContent">
            {detail.isError ? (
              <Empty icon={<IconAlert />} title="Couldn't Load">
                {detail.error.message}
              </Empty>
            ) : !detail.data ? (
              <div className="empty">
                <div className="spinner" style={{ margin: "0 auto" }} />
              </div>
            ) : (
              <>
                <div className="detail-head">
                  <div className="detail-poster">
                    {detail.data.poster ? (
                      <img src={detail.data.poster} alt="" />
                    ) : (
                      <div className="lib-poster-empty">
                        <IconFilm />
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="detail-title">{detail.data.title}</div>
                    <div className="detail-meta">
                      {[
                        detail.data.media_type === "movie" ? "Movie" : "TV Show",
                        year(detail.data.released),
                        detail.data.runtime ? `${detail.data.runtime} min` : "",
                        detail.data.tmdb_id ? `TMDB ${detail.data.tmdb_id}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {detail.data.overview ? <div className="detail-overview">{detail.data.overview}</div> : null}
                  </div>
                </div>
                <div className="detail-body">{detailBody(detail.data)}</div>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-danger" id="deleteTitleBtn" onClick={() => void deleteTitle()}>
              Delete
            </button>
            <button className="btn btn-primary" id="closeDetailBtn" onClick={() => setDetailId(null)}>
              Done
            </button>
          </div>
        </div>
      </Modal>

      <NumberedModal
        id="seasonModal"
        idPrefix="season"
        open={seasonModal}
        title="Add Season"
        desc="For a show you're filling in by hand."
        numberLabel="Season Number"
        min={0}
        nameLabel="Name"
        namePlaceholder="Optional"
        submitLabel="Add"
        initialNumber={nextFree((detail.data?.seasons ?? []).map((s) => s.number), 1)}
        onCancel={() => setSeasonModal(false)}
        onSubmit={async (number, name) => {
          if (!Number.isFinite(number) || number < 0) {
            show("Season number is required.", "error");
            return;
          }
          try {
            await api(`${BASE}/titles/${detail.data?.id}/seasons`, { method: "POST", body: { number, name: name || undefined } });
            setSeasonModal(false);
            show("Season added.");
            await refreshDetail();
            void reloadTitles();
          } catch (err) {
            show(err instanceof Error ? err.message : String(err), "error");
          }
        }}
      />

      <NumberedModal
        id="episodeModal"
        idPrefix="episode"
        open={Boolean(episodeModal)}
        title="Add Episode"
        desc="The video file is uploaded afterwards, from the episode's row."
        numberLabel="Episode Number"
        min={1}
        nameLabel="Title"
        namePlaceholder="Optional"
        submitLabel="Add"
        initialNumber={nextFree(
          ((detail.data?.seasons ?? []).find((s) => s.id === episodeModal)?.episodes ?? []).map((e) => e.number),
          1,
        )}
        onCancel={() => setEpisodeModal(null)}
        onSubmit={async (number, name) => {
          if (!Number.isFinite(number) || number < 1) {
            show("Episode number is required.", "error");
            return;
          }
          try {
            await api(`${BASE}/seasons/${episodeModal}/episodes`, { method: "POST", body: { number, title: name || undefined } });
            setEpisodeModal(null);
            show("Episode added.");
            await refreshDetail();
            void reloadTitles();
          } catch (err) {
            show(err instanceof Error ? err.message : String(err), "error");
          }
        }}
      />

      {toast}
    </>
  );
}

/** The lowest number not already used, so adding is one click. */
function nextFree(used: number[], from: number): number {
  const taken = new Set(used);
  let next = from;
  while (taken.has(next)) next++;
  return next;
}

function AddTitleModal({
  kind,
  onClose,
  onCreated,
  onError,
}: {
  kind: null | "movie" | "tv";
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
  onError: (msg: string) => void;
}): JSX.Element {
  const [tmdbId, setTmdbId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind) {
      setTmdbId("");
      setTitle("");
    }
  }, [kind]);

  async function save() {
    if (!tmdbId.trim() && !title.trim()) {
      onError("Give a TMDB id or a title.");
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string }>(`${BASE}/titles`, {
        method: "POST",
        body: { mediaType: kind, title: title.trim() || undefined, tmdbId: tmdbId.trim() || undefined },
      });
      await onCreated(created.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal id="titleModal" open={Boolean(kind)}>
      <div className="modal">
        <div className="modal-title" id="titleModalTitle">
          {kind === "tv" ? "Add Show" : "Add Movie"}
        </div>
        <div className="modal-desc">Give a TMDB id to fill everything in automatically, or just type a title.</div>
        <div className="form-grid full" style={{ gap: 14 }}>
          <div className="field">
            <label className="field-label">TMDB ID</label>
            <input
              className="field-input"
              id="titleTmdbInput"
              type="number"
              min={1}
              placeholder="e.g. 603"
              value={tmdbId}
              onChange={(e) => setTmdbId(e.target.value)}
            />
            <span className="field-hint" id="titleTmdbHint">
              {kind === "tv"
                ? "Fills in the show and pre-creates every season and episode."
                : "Fills in title, overview, poster and genres."}
            </span>
          </div>
          <div className="field">
            <label className="field-label">Title</label>
            <input
              className="field-input"
              id="titleNameInput"
              type="text"
              placeholder="Required if no TMDB id"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" id="cancelTitleBtn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" id="saveTitleBtn" disabled={busy} onClick={() => void save()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NumberedModal({
  id,
  open,
  title,
  desc,
  numberLabel,
  min,
  nameLabel,
  namePlaceholder,
  submitLabel,
  initialNumber,
  idPrefix,
  onCancel,
  onSubmit,
}: {
  id: string;
  /** Element ids the vanilla page gave these two modals' controls. */
  idPrefix: "season" | "episode";
  open: boolean;
  title: string;
  desc: string;
  numberLabel: string;
  min: number;
  nameLabel: string;
  namePlaceholder: string;
  submitLabel: string;
  initialNumber: number;
  onCancel: () => void;
  onSubmit: (number: number, name: string) => void | Promise<void>;
}): JSX.Element {
  const [number, setNumber] = useState(String(initialNumber));
  const [name, setName] = useState("");

  // Opening pre-fills the next free number, as the vanilla page did.
  useEffect(() => {
    if (open) {
      setNumber(String(initialNumber));
      setName("");
    }
  }, [open, initialNumber]);

  return (
    <Modal id={id} open={open}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        <div className="modal-desc">{desc}</div>
        <div className="form-grid full" style={{ gap: 14 }}>
          <div className="field">
            <label className="field-label">{numberLabel}</label>
            <input
              className="field-input"
              id={`${idPrefix}NumberInput`}
              type="number"
              min={min}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">{nameLabel}</label>
            <input
              className="field-input"
              id={`${idPrefix}${idPrefix === "season" ? "Name" : "Title"}Input`}
              type="text"
              placeholder={namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" id={`cancel${idPrefix === "season" ? "Season" : "Episode"}Btn`} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            id={`save${idPrefix === "season" ? "Season" : "Episode"}Btn`}
            onClick={() => void onSubmit(Number(number), name.trim())}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
