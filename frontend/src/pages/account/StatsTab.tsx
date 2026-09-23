/**
 * Stats and badges — both private to the account.
 *
 * `GET /api/account/stats` is what *awards* badges server-side, so it is
 * fetched fresh each time the tab opens rather than cached with the rest of
 * the page.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { IconAlert } from "../../components/icons/icons";
import { api } from "../../lib/auth";
import { getName as providerLabel } from "../../lib/provider-names";
import { formatDay, formatWatchTime, relativeDate } from "./format";
import type { AccountStats, Badge } from "./types";

const CATEGORY_LABELS: Record<string, string> = {
  time: "Watch time",
  episodes: "Episodes",
  movies: "Movies",
  shows: "Shows",
  streak: "Streaks",
  library: "Library",
  ratings: "Ratings",
  social: "Social",
  explorer: "Discovery",
};

interface Props {
  /** Bumped by the page each time the tab is opened. */
  openToken: number;
  onBadgeCount: (earned: number) => void;
}

export function StatsTab({ openToken, onBadgeCount }: Props): JSX.Element {
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [earnedOnly, setEarnedOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ stats: AccountStats; badges?: Badge[] }>("/api/account/stats");
      setStats(data.stats);
      setBadges(data.badges || []);
      setLoaded(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, openToken]);

  const earned = badges.filter((b) => b.earned).length;
  useEffect(() => {
    if (loaded) onBadgeCount(earned);
  }, [earned, loaded, onBadgeCount]);

  const cards = stats ? statCards(stats) : [];
  const visible = earnedOnly ? badges.filter((b) => b.earned) : badges;

  // One section per category, tiers in order — the ladder only reads as a
  // ladder if the next one up sits right after the one you just earned.
  const groups = new Map<string, Badge[]>();
  for (const b of visible) {
    if (!groups.has(b.category)) groups.set(b.category, []);
    groups.get(b.category)?.push(b);
  }

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Your Stats</div>
          <div className="section-sub" id="statsSubtitle">
            {failed
              ? "Unavailable"
              : stats
                ? `Member since ${formatDay(stats.member_since)} · ${
                    stats.last_watch_at ? `Last watched ${relativeDate(stats.last_watch_at)}` : "Nothing watched yet"
                  }`
                : "Loading…"}
          </div>
        </div>
      </div>

      <div className="stat-grid" id="statGrid">
        {failed ? null : !loaded ? (
          <div className="stat-card stat-card-loading">Loading…</div>
        ) : (
          cards.map((c) => (
            <div className="stat-card" key={c.label}>
              <div className="stat-value">{String(c.value)}</div>
              <div className="stat-label">{c.label}</div>
              {c.hint ? <div className="stat-hint">{c.hint}</div> : null}
            </div>
          ))
        )}
      </div>

      <div className="section-head" style={{ marginTop: 32 }}>
        <div>
          <div className="section-title">Badges</div>
          <div className="section-sub" id="badgesSubtitle">
            {loaded ? `${earned} of ${badges.length} earned` : "Earn badges by watching, rating and sharing"}
          </div>
        </div>
        <label className="badge-filter">
          <input type="checkbox" id="badgeEarnedOnly" checked={earnedOnly} onChange={(e) => setEarnedOnly(e.target.checked)} /> Earned only
        </label>
      </div>

      <div id="badgeContent">
        {failed ? (
          <div className="empty">
            <div className="empty-icon">
              <IconAlert />
            </div>
            <h3>Couldn&apos;t Load</h3>
            <p>Failed to load your stats.</p>
          </div>
        ) : !visible.length ? (
          loaded ? (
            <div className="empty">
              <div className="empty-icon">🏆</div>
              <h3>No Badges Yet</h3>
              <p>Watch, rate and share to start earning them.</p>
            </div>
          ) : null
        ) : (
          [...groups.entries()].map(([category, list]) => (
            <div className="badge-group" key={category}>
              <div className="badge-group-title">{CATEGORY_LABELS[category] || category}</div>
              <div className="badge-grid">
                {[...list].sort((a, b) => a.tier - b.tier).map((b) => (
                  <BadgeCard badge={b} key={b.slug || b.name} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/**
 * Grouped the way they'd be read, not the way they're stored: what you
 * watched, what you finished, what you keep, who you watch with.
 */
function statCards(s: AccountStats): { label: string; value: string | number; hint?: string }[] {
  return [
    { label: "Watch time", value: formatWatchTime(s.total_watch_seconds), hint: "Total playback" },
    { label: "Episodes finished", value: s.episodes_completed },
    { label: "Movies finished", value: s.movies_completed },
    { label: "Shows finished", value: s.shows_completed, hint: "Nothing left unfinished" },
    { label: "Titles started", value: s.titles_started },
    { label: "Still watching", value: s.episodes_in_progress, hint: "Started, not finished" },
    { label: "Current streak", value: `${s.current_streak_days}d`, hint: `Best: ${s.longest_streak_days}d` },
    { label: "Active days", value: s.active_days },
    { label: "In watchlist", value: s.watchlist_count },
    { label: "Favorites", value: s.favorites_count },
    {
      label: "Titles rated",
      value: s.ratings_count,
      hint: s.average_rating != null ? `Avg ${s.average_rating}/10` : "No ratings yet",
    },
    {
      label: "Providers used",
      value: s.providers_used,
      hint: s.top_provider ? `Most: ${providerLabel(s.top_provider)}` : "",
    },
    { label: "Followers", value: s.followers_count, hint: `Following ${s.following_count}` },
    { label: "Shares sent", value: s.shares_sent, hint: `${s.reactions_received} reactions received` },
  ];
}

function BadgeCard({ badge: b }: { badge: Badge }): JSX.Element {
  const pct = b.threshold > 0 ? Math.min(100, Math.round((b.progress / b.threshold) * 100)) : 0;
  const meta = b.earned ? `Earned ${relativeDate(b.earned_at)}` : `${b.progress} / ${b.threshold}`;
  return (
    <div className={`badge-card ${b.earned ? "earned" : "locked"}`} title={b.description}>
      <div className="badge-icon">{b.icon}</div>
      <div className="badge-body">
        <div className="badge-name">{b.name}</div>
        <div className="badge-desc">{b.description}</div>
        {b.earned ? null : (
          <div className="badge-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="badge-meta">{meta}</div>
      </div>
    </div>
  );
}
