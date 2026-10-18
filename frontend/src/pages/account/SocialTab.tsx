/**
 * The Social tab: people (search, followers, following) and shares
 * (inbox/sent with emoji reactions).
 *
 * Everything another account authored — display names, avatar URLs, share
 * messages — renders as JSX text or as an element's `src`, never as markup.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useNavigate } from "react-router";
import { IconAlert, IconMail } from "../../components/icons/icons";
import { ReactionBar } from "../../components/social/ReactionBar";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/auth";
import { cachedShow, hydrateShowCache } from "./library-store";
import { goToSharedContent } from "./navigate-to-show";
import type { AccountUser, Person, ShareItem } from "./types";

type Toast = (msg: string, type?: "success" | "error") => void;

const SEARCH_DEBOUNCE_MS = 250;

function Note({ children }: { children: string }): JSX.Element {
  return (
    <div className="empty">
      <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>{children}</div>
    </div>
  );
}

function PersonRow({
  person,
  mode,
  following,
  onToggle,
}: {
  person: Person;
  mode: "view" | "search" | "following";
  following: boolean;
  onToggle?: (person: Person, following: boolean) => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const name = person.display_name || "User";
  return (
    <div className="person-row">
      <div className="person-avatar">
        {person.avatar_url ? (
          <img
            src={person.avatar_url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          />
        ) : (
          <span>{name[0]?.toUpperCase()}</span>
        )}
      </div>
      <div className="person-name">{name}</div>
      {mode !== "view" && (
        <button
          className={`btn ${following ? "btn-ghost" : "btn-secondary"} btn-sm follow-toggle`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onToggle?.(person, following);
            } finally {
              setBusy(false);
            }
          }}
        >
          {following ? "Unfollow" : "Follow"}
        </button>
      )}
    </div>
  );
}

export function SocialTab({ user, toast }: { user: AccountUser; toast: Toast }): JSX.Element {
  const [subtab, setSubtab] = useState<"people" | "shares">("people");
  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Social</div>
          <div className="section-sub">Follow people and manage shared content</div>
        </div>
      </div>

      <div className="filter-bar">
        <button
          className={`btn ${subtab === "people" ? "btn-secondary" : "btn-ghost"} btn-sm social-subtab${
            subtab === "people" ? " active" : ""
          }`}
          data-subtab="people"
          onClick={() => setSubtab("people")}
        >
          People
        </button>
        <button
          className={`btn ${subtab === "shares" ? "btn-secondary" : "btn-ghost"} btn-sm social-subtab${
            subtab === "shares" ? " active" : ""
          }`}
          data-subtab="shares"
          onClick={() => setSubtab("shares")}
        >
          Shares
        </button>
      </div>

      <div id="social-people" style={{ display: subtab === "people" ? "block" : "none" }}>
        <PeoplePane user={user} toast={toast} />
      </div>
      {/* Shares are fetched the first time the sub-tab is opened, as in the
          vanilla page — the inbox read-marking must not run before then. */}
      <div id="social-shares" style={{ display: subtab === "shares" ? "block" : "none" }}>
        {subtab === "shares" && <SharesPane user={user} toast={toast} />}
      </div>
    </>
  );
}

function PeoplePane({ user, toast }: { user: AccountUser; toast: Toast }): JSX.Element {
  const [counts, setCounts] = useState<{ followers: number; following: number }>({ followers: 0, following: 0 });
  const [followers, setFollowers] = useState<Person[] | "error" | null>(null);
  const [following, setFollowing] = useState<Person[] | "error" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | "error" | null>(null);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

  const loadCounts = useCallback(async () => {
    try {
      setCounts(await api<{ followers: number; following: number }>("/api/social/me/follow-counts"));
    } catch {
      /* ignore */
    }
  }, []);

  const loadFollowing = useCallback(async () => {
    try {
      const items = await api<Person[]>(`/api/social/users/${user.id}/following`);
      setFollowing(items);
      setFollowedIds(new Set(items.map((i) => i.id)));
    } catch {
      setFollowing("error");
    }
  }, [user.id]);

  useEffect(() => {
    void loadCounts();
    void (async () => {
      try {
        setFollowers(await api<Person[]>(`/api/social/users/${user.id}/followers`));
      } catch {
        setFollowers("error");
      }
    })();
    void loadFollowing();
  }, [loadCounts, loadFollowing, user.id]);

  // People search: debounced, and each result's follow state is filled in
  // afterwards so the button reads correctly for someone already followed.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await api<Person[]>(`/api/social/users/search?q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        setResults(found);
        for (const r of found) {
          void (async () => {
            try {
              const { following: isFollowing } = await api<{ following: boolean }>(
                `/api/social/follows/${r.id}/status`,
              );
              if (!cancelled && isFollowing) setFollowedIds((prev) => new Set(prev).add(r.id));
            } catch {
              /* ignore */
            }
          })();
        }
      } catch {
        if (!cancelled) setResults("error");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function toggleFollow(person: Person, isFollowing: boolean): Promise<void> {
    const name = person.display_name || "User";
    try {
      if (isFollowing) {
        await api(`/api/social/follows/${person.id}`, { method: "DELETE" });
        setFollowedIds((prev) => {
          const next = new Set(prev);
          next.delete(person.id);
          return next;
        });
        toast(`Unfollowed ${name}.`);
      } else {
        await api(`/api/social/follows/${person.id}`, { method: "POST" });
        setFollowedIds((prev) => new Set(prev).add(person.id));
        toast(`Following ${name}.`);
      }
      void loadCounts();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Find People</div>
        <input
          className="field-input"
          type="text"
          id="peopleSearchInput"
          placeholder="Search by display name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="people-list" id="peopleSearchResults">
          {results === "error" ? (
            <Note>Search failed.</Note>
          ) : results === null ? null : results.length ? (
            results.map((r) => (
              <PersonRow key={r.id} person={r} mode="search" following={followedIds.has(r.id)} onToggle={toggleFollow} />
            ))
          ) : (
            <Note>No matches.</Note>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Followers (<span id="followersCount">{counts.followers}</span>)</div>
        <div className="people-list" id="followersList">
          {followers === null ? (
            <Note>Loading…</Note>
          ) : followers === "error" ? (
            <Note>Failed to load followers.</Note>
          ) : followers.length ? (
            followers.map((p) => <PersonRow key={p.id} person={p} mode="view" following={false} />)
          ) : (
            <Note>No followers yet.</Note>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Following (<span id="followingCount">{counts.following}</span>)</div>
        <div className="people-list" id="followingList">
          {following === null ? (
            <Note>Loading…</Note>
          ) : following === "error" ? (
            <Note>Failed to load following.</Note>
          ) : following.length ? (
            following.map((p) => (
              <PersonRow key={p.id} person={p} mode="following" following={followedIds.has(p.id)} onToggle={toggleFollow} />
            ))
          ) : (
            <Note>Not following anyone yet.</Note>
          )}
        </div>
      </div>
    </>
  );
}

function shareContentLabel(item: ShareItem): string {
  let label = cachedShow(item)?.title ?? item.show_id;
  if (item.episode_label) label += ` · ${item.episode_label}`;
  if (item.clip_start_seconds != null && item.clip_end_seconds != null) {
    const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    label += ` (clip ${fmt(item.clip_start_seconds)}–${fmt(item.clip_end_seconds)})`;
  }
  return label;
}

function SharesPane({ user, toast }: { user: AccountUser; toast: Toast }): JSX.Element {
  const [view, setView] = useState<"inbox" | "sent">("inbox");
  const [items, setItems] = useState<ShareItem[] | "error" | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const readMarked = useRef(new Set<string>());

  const load = useCallback(
    async (which: "inbox" | "sent") => {
      try {
        const summary = await api<ShareItem[]>(`/api/social/shares/${which}`);
        await hydrateShowCache(summary);
        setItems(summary);

        // The detail call carries sender, recipients and reactions; the list
        // renders from the summary first so it isn't blank while they land.
        const detailed = await Promise.all(
          summary.map(async (item) => {
            try {
              const detail = await api<ShareItem>(`/api/social/shares/${item.id}`);
              return { ...item, sender: detail.sender, recipients: detail.recipients, reactions: detail.reactions };
            } catch {
              return item; // keep summary-level data
            }
          }),
        );
        setItems(detailed);

        // Viewing the inbox marks its shares as read, which lowers the badge.
        if (which === "inbox" && summary.length) {
          const unmarked = summary.filter((i) => !readMarked.current.has(i.id));
          if (unmarked.length) {
            for (const i of unmarked) readMarked.current.add(i.id);
            void Promise.all(
              unmarked.map((item) =>
                api(`/api/social/shares/${item.id}/read`, { method: "PATCH" }).catch(() => {}),
              ),
            ).then(() => queryClient.invalidateQueries({ queryKey: ["authed", "/api/social/shares/unread-count"] }));
          }
        }
      } catch {
        setItems("error");
      }
    },
    [queryClient],
  );

  useEffect(() => {
    setItems(null);
    void load(view);
  }, [load, view]);

  async function refreshOne(shareId: string): Promise<void> {
    try {
      const detail = await api<ShareItem>(`/api/social/shares/${shareId}`);
      setItems((cur) =>
        Array.isArray(cur) ? cur.map((i) => (i.id === shareId ? { ...i, reactions: detail.reactions } : i)) : cur,
      );
    } catch {
      /* ignore */
    }
  }

  async function remove(shareId: string): Promise<void> {
    try {
      await api(`/api/social/shares/${shareId}`, { method: "DELETE" });
      toast("Share removed.");
      void load(view);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <>
      <div className="filter-bar">
        <button
          className={`btn ${view === "inbox" ? "btn-secondary" : "btn-ghost"} btn-sm share-subtab${
            view === "inbox" ? " active" : ""
          }`}
          data-sharetab="inbox"
          onClick={() => setView("inbox")}
        >
          Inbox
        </button>
        <button
          className={`btn ${view === "sent" ? "btn-secondary" : "btn-ghost"} btn-sm share-subtab${
            view === "sent" ? " active" : ""
          }`}
          data-sharetab="sent"
          onClick={() => setView("sent")}
        >
          Sent
        </button>
      </div>
      <div id="sharesContent">
        {items === null ? (
          <Note>Loading…</Note>
        ) : items === "error" ? (
          <div className="empty">
            <div className="empty-icon">
              <IconAlert />
            </div>
            <h3>Couldn&apos;t Load</h3>
            <p>Failed to load shares.</p>
          </div>
        ) : !items.length ? (
          <div className="empty">
            <div className="empty-icon">
              <IconMail />
            </div>
            <h3>{view === "inbox" ? "Nothing Shared With You Yet" : "You Haven’t Shared Anything Yet"}</h3>
            <p>
              {view === "inbox"
                ? "Shows, episodes, and clips people share with you will show up here."
                : "Share a show or clip from its details page."}
            </p>
          </div>
        ) : (
          <div className="shares-list">
            {items.map((item) => {
              const who =
                view === "inbox"
                  ? item.sender
                    ? item.sender.display_name || "Someone"
                    : "…"
                  : item.recipients
                    ? item.recipients.map((r) => r.display_name || "Someone").join(", ")
                    : "…";
              return (
                <div
                  key={item.id}
                  className="share-card"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest(".share-delete, .reaction-btn")) return;
                    goToSharedContent(navigate, {
                      provider: item.provider,
                      show: item.show_id,
                      episode: item.episode_id || "",
                      clipStart: item.clip_start_seconds == null ? "" : String(item.clip_start_seconds),
                    });
                  }}
                >
                  <div className="share-body">
                    <div className="share-who">{view === "inbox" ? `From ${who}` : `To ${who}`}</div>
                    <div className="share-content-label">{shareContentLabel(item)}</div>
                    {item.message && <div className="share-message">&quot;{item.message}&quot;</div>}
                    {item.reactions ? (
                      <ReactionBar
                        shareId={item.id}
                        reactions={item.reactions}
                        myUserId={user.id}
                        onChanged={refreshOne}
                      />
                    ) : (
                      <div className="reaction-bar-placeholder" />
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm btn-icon share-delete"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(item.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
