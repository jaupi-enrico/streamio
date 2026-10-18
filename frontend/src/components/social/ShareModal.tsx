/**
 * The share modal — a port of social.js's openShareModal. Same markup, inline
 * styles and requests; recipients' display names are rendered as JSX text
 * (they are other accounts' profile strings).
 *
 * One host is mounted by the app shell; pages open it through
 * `useShareModal()`:
 *
 *   const openShare = useShareModal();
 *   openShare({ provider, show_id, summary }, onShared);
 *
 * Pass `duration` (total seconds) to offer the clip-range slider; omit it to
 * share the title as a whole.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";
import { api } from "../../lib/auth";

export interface ShareContent {
  provider: string;
  show_id: string;
  episode_id?: string | null;
  episode_label?: string | null;
  clip_start_seconds?: number;
  clip_end_seconds?: number;
  duration?: number;
  summary?: string;
}

type OpenShare = (content: ShareContent, onShared?: () => void) => void;

const ShareContext = createContext<OpenShare>(() => {
  throw new Error("useShareModal() needs <ShareModalHost> above it");
});

export function useShareModal(): OpenShare {
  return useContext(ShareContext);
}

interface UserHit {
  id: string;
  display_name?: string | null;
}

const MIN_CLIP_GAP_SECONDS = 3;

function formatClipTime(seconds: number | string): string {
  const s = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const CLIP_STYLE = `
  .clip-range-input { -webkit-appearance:none; appearance:none; background:transparent; pointer-events:none; position:absolute; left:0; top:8px; width:100%; margin:0; }
  .clip-range-input::-webkit-slider-runnable-track { height:3px; background:rgba(255,255,255,0.15); border-radius:2px; }
  .clip-range-input::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; pointer-events:auto; width:15px; height:15px; border-radius:50%; background:var(--red,#e50914); cursor:pointer; margin-top:-6px; box-shadow:0 0 0 3px rgba(0,0,0,0.5); }
  .clip-range-input::-moz-range-track { height:3px; background:rgba(255,255,255,0.15); border-radius:2px; }
  .clip-range-input::-moz-range-thumb { pointer-events:auto; width:15px; height:15px; border-radius:50%; background:var(--red,#e50914); cursor:pointer; border:none; }
`;

const S = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center",
    justifyContent: "center", background: "rgba(0,0,0,0.7)",
  },
  card: {
    background: "var(--surface,#1f1f1f)", border: "1px solid var(--border,rgba(255,255,255,0.08))",
    borderRadius: 10, padding: 28, width: 380, maxWidth: "92vw", maxHeight: "86vh", overflowY: "auto",
  },
  title: {
    fontFamily: "'Bebas Neue',sans-serif", fontSize: "1.5rem", letterSpacing: "0.06em",
    marginBottom: 16, color: "var(--text,#fff)",
  },
  summary: { fontSize: "0.82rem", color: "var(--muted,#b3b3b3)", marginBottom: 14 },
  clipSection: {
    marginBottom: 16, padding: 12, border: "1px solid var(--border,rgba(255,255,255,.08))", borderRadius: 8,
  },
  clipModes: { display: "flex", gap: 16, marginBottom: 12, fontSize: "0.8rem", color: "var(--text,#fff)" },
  clipMode: { cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  sliderWrap: { position: "relative", height: 24 },
  clipLabel: { textAlign: "center", fontSize: "0.78rem", color: "var(--muted,#b3b3b3)", marginTop: 4 },
  search: {
    width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border,rgba(255,255,255,.08))",
    background: "var(--surface2,#2a2a2a)", color: "var(--text,#fff)", fontSize: "0.9rem", marginBottom: 8,
    boxSizing: "border-box",
  },
  results: { maxHeight: 140, overflowY: "auto", marginBottom: 8 },
  resultRow: { padding: "7px 8px", borderRadius: 6, cursor: "pointer", fontSize: "0.85rem", color: "var(--text,#fff)" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: {
    background: "var(--surface3,#333)", borderRadius: 20, padding: "4px 10px", fontSize: "0.78rem",
    display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text,#fff)",
  },
  chipX: { cursor: "pointer", opacity: 0.7 },
  message: {
    width: "100%", minHeight: 60, padding: "10px 12px", borderRadius: 6,
    border: "1px solid var(--border,rgba(255,255,255,.08))", background: "var(--surface2,#2a2a2a)",
    color: "var(--text,#fff)", fontSize: "0.85rem", resize: "vertical", marginBottom: 12, boxSizing: "border-box",
  },
  error: { color: "var(--red,#e50914)", fontSize: "0.8rem", marginBottom: 8 },
  actions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancel: {
    background: "none", border: "1px solid var(--border,rgba(255,255,255,.08))", color: "var(--muted,#b3b3b3)",
    padding: "9px 16px", borderRadius: 6, cursor: "pointer",
  },
  send: {
    background: "var(--red,#e50914)", border: "none", color: "#fff", padding: "9px 18px", borderRadius: 6,
    cursor: "pointer", fontWeight: 600,
  },
} satisfies Record<string, CSSProperties>;

interface OpenState {
  content: ShareContent;
  onShared?: () => void;
  /** Present only when the clip slider is offered. */
  clip: { duration: number; start: number; end: number } | null;
  /** Bumped per open, so each open starts from a clean form. */
  serial: number;
}

export function ShareModalHost({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<OpenState | null>(null);
  const serial = useRef(0);

  const open = useCallback<OpenShare>((content, onShared) => {
    let clip: OpenState["clip"] = null;
    if (typeof content.duration === "number" && content.duration > MIN_CLIP_GAP_SECONDS) {
      const dur = Math.max(MIN_CLIP_GAP_SECONDS, Math.floor(content.duration));
      const start = Math.min(Math.max(0, Math.floor(content.clip_start_seconds ?? 0)), dur - MIN_CLIP_GAP_SECONDS);
      const end = Math.min(
        Math.max(start + MIN_CLIP_GAP_SECONDS, Math.floor(content.clip_end_seconds ?? start + 30)),
        dur,
      );
      clip = { duration: dur, start, end };
    }
    serial.current += 1;
    setState({ content, onShared, clip, serial: serial.current });
  }, []);

  return (
    <ShareContext.Provider value={open}>
      {children}
      {state && <ShareModal key={state.serial} state={state} onClose={() => setState(null)} />}
    </ShareContext.Provider>
  );
}

function ShareModal({ state, onClose }: { state: OpenState; onClose: () => void }): JSX.Element {
  const { content, clip } = state;
  const [recipients, setRecipients] = useState<Map<string, string>>(() => new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserHit[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [wholeEpisode, setWholeEpisode] = useState(false);
  const [clipStart, setClipStart] = useState(clip?.start ?? 0);
  const [clipEnd, setClipEnd] = useState(clip?.end ?? 0);

  // Debounced people search; results exclude who is already picked.
  const recipientsRef = useRef(recipients);
  recipientsRef.current = recipients;
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const users = await api<UserHit[]>(`/api/social/users/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setResults(users.filter((u) => !recipientsRef.current.has(u.id)));
      } catch {
        // Ignore transient search errors.
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function pick(user: UserHit) {
    setRecipients((prev) => new Map(prev).set(user.id, user.display_name || "User"));
    setQuery("");
    setResults([]);
  }

  function unpick(id: string) {
    setRecipients((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  async function send() {
    setError(null);
    if (recipients.size === 0) {
      setError("Pick at least one person to share with.");
      return;
    }
    setSending(true);
    const asClip = clip !== null && !wholeEpisode;
    try {
      await api("/api/social/shares", {
        method: "POST",
        body: {
          provider: content.provider,
          show_id: content.show_id,
          episode_id: content.episode_id ?? undefined,
          episode_label: content.episode_label ?? undefined,
          clip_start_seconds: asClip ? clipStart : undefined,
          clip_end_seconds: asClip ? clipEnd : undefined,
          message: message.trim() || undefined,
          recipient_ids: [...recipients.keys()],
        },
      });
      onClose();
      state.onShared?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      id="socialShareModal"
      style={S.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{CLIP_STYLE}</style>
      <div style={S.card}>
        <div style={S.title}>Share</div>
        <div style={S.summary}>{content.summary || ""}</div>

        {clip && (
          <div style={S.clipSection}>
            <div style={S.clipModes}>
              <label style={S.clipMode}>
                <input type="radio" name="socialClipMode" checked={!wholeEpisode} onChange={() => setWholeEpisode(false)} />{" "}
                Share a clip
              </label>
              <label style={S.clipMode}>
                <input type="radio" name="socialClipMode" checked={wholeEpisode} onChange={() => setWholeEpisode(true)} />{" "}
                Whole episode
              </label>
            </div>
            {!wholeEpisode && (
              <>
                <div style={S.sliderWrap}>
                  <input
                    type="range"
                    className="clip-range-input"
                    min={0}
                    max={clip.duration}
                    step={1}
                    value={clipStart}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setClipStart(v > clipEnd - MIN_CLIP_GAP_SECONDS ? Math.max(0, clipEnd - MIN_CLIP_GAP_SECONDS) : v);
                    }}
                  />
                  <input
                    type="range"
                    className="clip-range-input"
                    min={0}
                    max={clip.duration}
                    step={1}
                    value={clipEnd}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setClipEnd(
                        v < clipStart + MIN_CLIP_GAP_SECONDS ? Math.min(clip.duration, clipStart + MIN_CLIP_GAP_SECONDS) : v,
                      );
                    }}
                  />
                </div>
                <div style={S.clipLabel}>
                  Clip: {formatClipTime(clipStart)} – {formatClipTime(clipEnd)}
                </div>
              </>
            )}
          </div>
        )}

        <input
          type="text"
          placeholder="Search people by name…"
          style={S.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={S.results}>
          {results.map((u) => (
            <ResultRow key={u.id} user={u} onPick={pick} />
          ))}
        </div>
        <div style={S.chips}>
          {[...recipients.entries()].map(([id, name]) => (
            <span key={id} style={S.chip}>
              {name}{" "}
              <span style={S.chipX} onClick={() => unpick(id)}>
                ✕
              </span>
            </span>
          ))}
        </div>
        <textarea
          placeholder="Add a message (optional)"
          style={S.message}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {error && <div style={S.error}>{error}</div>}
        <div style={S.actions}>
          <button type="button" style={S.cancel} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={S.send} disabled={sending} onClick={() => void send()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ user, onPick }: { user: UserHit; onPick: (u: UserHit) => void }): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="social-result-row"
      style={{ ...S.resultRow, background: hover ? "var(--surface2,#2a2a2a)" : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onPick(user)}
    >
      {user.display_name || "User"}
    </div>
  );
}
