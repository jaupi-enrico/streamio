/** Shapes the account page reads. Library rows carry only {provider, show_id}
 *  plus their own columns — the title comes from `GET /api/shows/:id`. */

export interface AccountUser {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified?: boolean;
  created_at?: string;
}

export interface LibraryItem {
  provider: string;
  show_id: string;
  added_at?: string;
  watched_at?: string;
  episode_id?: string | null;
  episode_label?: string | null;
  progress_seconds?: number;
  duration_seconds?: number;
  completed?: boolean;
}

/** Only the fields a library card reads off a title. */
export interface LibraryShow {
  title?: string;
  poster?: string | null;
  posterUrl?: string | null;
  rating?: number;
}

export interface Person {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ShareItem {
  id: string;
  provider: string;
  show_id: string;
  episode_id?: string | null;
  episode_label?: string | null;
  message?: string | null;
  clip_start_seconds?: number | null;
  clip_end_seconds?: number | null;
  sender?: Person | null;
  recipients?: Person[] | null;
  reactions?: { emoji: string; user: { id: string } }[] | null;
}

export interface AccountStats {
  total_watch_seconds: number;
  episodes_completed: number;
  movies_completed: number;
  shows_completed: number;
  titles_started: number;
  episodes_in_progress: number;
  current_streak_days: number;
  longest_streak_days: number;
  active_days: number;
  watchlist_count: number;
  favorites_count: number;
  ratings_count: number;
  average_rating: number | null;
  providers_used: number;
  top_provider: string | null;
  followers_count: number;
  following_count: number;
  shares_sent: number;
  reactions_received: number;
  member_since: string | null;
  last_watch_at: string | null;
}

export interface Badge {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tier: number;
  threshold: number;
  progress: number;
  earned: boolean;
  earned_at?: string | null;
}

export interface HostingPoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  last_synced_at?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
  shared_secret?: string;
}

export interface UpdateStatus {
  enabled: boolean;
  autoApply: boolean;
  repo: string | null;
  currentVersion: string;
  updateAvailable?: boolean;
  shouldUpdate?: boolean;
  requestedBy?: string | null;
  lastCheckError?: string | null;
  latest?: { version: string; url?: string | null } | null;
}

export interface UpdateHistoryRow {
  from_version: string;
  to_version: string;
  status: "ok" | "error" | "started";
  trigger: string;
  requested_by?: string | null;
  started_at: string;
  error?: string | null;
}

export interface ClientVersionSettings {
  latest?: string | null;
  minSupported?: string | null;
  downloadUrl?: string | null;
  notes?: string | null;
  enforce?: boolean;
  apkUploadedAt?: string | null;
  apkVersion?: string | null;
}

export interface PowerStatus {
  shouldShutdown?: boolean;
  reason?: string | null;
  enabled?: boolean;
  idleMinutes?: number;
  idleSeconds?: number;
}

export interface VersionInfo {
  server: { version: string; commit: string; builtAt?: string | null };
  api: { version: number };
}
