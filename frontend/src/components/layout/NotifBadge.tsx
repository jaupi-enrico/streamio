import type { JSX } from "react";

/** The unread-share badge, styled exactly as social.js's setBadgeCount. */
export function NotifBadge({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span
      className="notif-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        marginLeft: 6,
        borderRadius: 8,
        background: "#e50914",
        color: "#fff",
        fontSize: "0.65rem",
        fontWeight: 700,
        lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      {count > 9 ? "9+" : String(count)}
    </span>
  );
}
