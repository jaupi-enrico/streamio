import type { JSX } from "react";
import { useShareBadge } from "../../hooks/useShareBadge";
import { AppLink } from "./AppLink";
import { NotifBadge } from "./NotifBadge";
import type { NavKey } from "./TopNav";

const ITEMS: { key: NavKey; to: string; label: string; icon: JSX.Element }[] = [
  {
    key: "home",
    to: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    key: "catalog",
    to: "/catalog",
    label: "Catalog",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    key: "search",
    to: "/search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    key: "providers",
    to: "/providers",
    label: "Providers",
    icon: (
      <svg viewBox="0 0 24 24">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
  },
  {
    key: "account",
    to: "/account",
    label: "Account",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

/** The mobile bottom navigation, as on home/catalog/search/providers/details/account. */
export function BottomNav({ active }: { active?: NavKey }): JSX.Element {
  const unread = useShareBadge();
  return (
    <div className="bottom-nav" aria-label="Mobile navigation" role="navigation">
      {ITEMS.map((item) => (
        <AppLink key={item.key} to={item.to} className={`bottom-nav-item${item.key === active ? " active" : ""}`}>
          {item.icon}
          {item.label}
          {item.key === "account" && <NotifBadge count={unread} />}
        </AppLink>
      ))}
    </div>
  );
}
