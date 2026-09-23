/**
 * Where a library card, a history row or a share takes you.
 *
 * The vanilla page navigates the whole window; here the target stays inside
 * this app when it is ported (so a preview card doesn't drop you onto the old
 * site) and is a plain navigation otherwise. The provider is written to
 * `streamio.provider` first either way — the destination reads it.
 */
import type { NavigateFunction } from "react-router";
import { oldPageHref } from "../../lib/base";
import { isInApp } from "../../lib/pages";
import { setSelectedProvider } from "../../lib/provider-selection";

function go(navigate: NavigateFunction, path: string): void {
  if (isInApp(path)) navigate(path);
  else window.location.href = oldPageHref(path);
}

export function goToShow(navigate: NavigateFunction, provider: string, showId: string): void {
  setSelectedProvider(provider);
  go(navigate, `/details?id=${encodeURIComponent(showId)}&provider=${encodeURIComponent(provider)}`);
}

/**
 * A share pointing at a specific episode or clip range drops the recipient
 * straight into the player at that point, not onto the show's overview page —
 * otherwise the clip's timestamp is just inert text.
 */
export function goToSharedContent(
  navigate: NavigateFunction,
  { provider, show, episode, clipStart }: { provider: string; show: string; episode: string; clipStart: string },
): void {
  if (!episode && clipStart === "") {
    goToShow(navigate, provider, show);
    return;
  }
  setSelectedProvider(provider);
  const params = new URLSearchParams({ id: show, provider });
  if (episode) params.set("ep", episode);
  if (clipStart !== "") params.set("t", clipStart);
  go(navigate, `/watch?${params.toString()}`);
}
