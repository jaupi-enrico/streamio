import type { CSSProperties, JSX } from "react";
import { useShareBadge } from "../../hooks/useShareBadge";
import { logout } from "../../lib/auth";
import { AppLink } from "./AppLink";
import { NotifBadge } from "./NotifBadge";

export type NavKey = "home" | "catalog" | "search" | "providers" | "rooms" | "account";

const LINKS: { key: NavKey; to: string; label: string }[] = [
  { key: "home", to: "/", label: "Home" },
  { key: "catalog", to: "/catalog", label: "Catalog" },
  { key: "search", to: "/search", label: "Search" },
  { key: "providers", to: "/providers", label: "Providers" },
  { key: "rooms", to: "/rooms", label: "Rooms" },
  { key: "account", to: "/account", label: "Account" },
];

const RED: CSSProperties = { color: "var(--red)" };

interface Props {
  /** `id` of the <nav>, where the vanilla page had one (mainNav, navbar). */
  id?: string;
  /** Extra class on the <nav> (home's `solid` once scrolled). */
  className?: string;
  active?: NavKey;
  /**
   * How the active link is marked. Most pages use `class="active"`; the
   * rooms page colours it red inline instead.
   */
  activeStyle?: "class" | "red";
  /** Links the vanilla page leaves out (details has no Rooms). */
  omit?: NavKey[];
  /** Append "Sign Out" (account, admin pages). */
  signOut?: boolean;
  /**
   * Unread-share badge on "Account". Off where the vanilla page never
   * started it (rooms).
   */
  badge?: boolean;
}

/**
 * The top navigation bar — markup only. Each page's own stylesheet styles
 * `nav`, `.brand` and `.nav-links`, as in the vanilla pages, which differ
 * slightly per page; the props reproduce those differences.
 */
export function TopNav({ id, className, active, activeStyle = "class", omit = [], signOut = false, badge = true }: Props): JSX.Element {
  const unread = useShareBadge(badge);
  return (
    <nav id={id} className={className}>
      <AppLink to="/" className="brand">
        STREAMIO
      </AppLink>
      <ul className="nav-links">
        {LINKS.filter((l) => !omit.includes(l.key)).map((l) => {
          const isActive = l.key === active;
          return (
            <li key={l.key}>
              <AppLink
                to={l.to}
                className={isActive && activeStyle === "class" ? "active" : undefined}
                style={isActive && activeStyle === "red" ? RED : undefined}
              >
                {l.label}
                {l.key === "account" && <NotifBadge count={unread} />}
              </AppLink>
            </li>
          );
        })}
        {signOut && (
          <li>
            <a
              href="#"
              id="logoutLink"
              style={RED}
              onClick={(e) => {
                e.preventDefault();
                void logout();
              }}
            >
              Sign Out
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
}
