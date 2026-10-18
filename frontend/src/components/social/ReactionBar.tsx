import { useState, type JSX } from "react";
import { api } from "../../lib/auth";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"] as const;

export interface Reaction {
  emoji: string;
  user: { id: string };
}

interface Props {
  shareId: string;
  reactions: Reaction[] | null | undefined;
  myUserId: string | null;
  /** Called after a reaction was set or cleared, to refetch the share. */
  onChanged?: (shareId: string) => void | Promise<void>;
}

/**
 * Emoji reactions on a share — social.js's renderReactionBar plus
 * attachReactionHandlers, same markup and classes.
 */
export function ReactionBar({ shareId, reactions, myUserId, onChanged }: Props): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const list = reactions || [];
  const mine = list.find((r) => r.user.id === myUserId);
  const counts: Record<string, number> = {};
  for (const r of list) counts[r.emoji] = (counts[r.emoji] || 0) + 1;

  async function toggle(emoji: string) {
    const wasActive = mine?.emoji === emoji;
    setBusy(emoji);
    try {
      if (wasActive) {
        await api(`/api/social/shares/${shareId}/reaction`, { method: "DELETE" });
      } else {
        await api(`/api/social/shares/${shareId}/reaction`, { method: "PUT", body: { emoji } });
      }
      await onChanged?.(shareId);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="reaction-bar" data-share={shareId}>
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={`reaction-btn${mine?.emoji === emoji ? " active" : ""}`}
          data-emoji={emoji}
          data-share={shareId}
          disabled={busy === emoji}
          onClick={() => void toggle(emoji)}
        >
          {emoji}
          {counts[emoji] ? <span className="reaction-count">{counts[emoji]}</span> : null}
        </button>
      ))}
    </div>
  );
}
