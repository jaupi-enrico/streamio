/** The account page's small formatters, ported from public/scripts/account.js. */

export function relativeDate(d: string | number | Date | null | undefined): string {
  const diff = Date.now() - new Date(d as string).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 365) return `${days}d ago`;
  return new Date(d as string).toLocaleDateString();
}

export function memberSince(d: string): string {
  return "Member since " + new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

export function formatWatchTime(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatDay(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}
