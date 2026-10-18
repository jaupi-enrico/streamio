/**
 * The player's keyboard shortcuts — PLAYER_SHORTCUTS / findShortcut in
 * public/scripts/watch.js. One table drives both the key handler and the
 * help modal, so a binding can't exist undocumented and the modal can't list
 * a key that does nothing.
 *
 * `combo` entries are matched against `code` (physical key, layout-
 * independent) with an optional `Shift+` prefix; `match` is for the few that
 * can't be (`?` is a different physical key on every layout, digits are a
 * range). `keys` is only what the modal prints.
 */

/** What a shortcut can do; the player controls implement it. */
export interface ShortcutActions {
  togglePlayback(): void;
  goEpisode(delta: number): void;
  skipSegment(): void;
  seekBy(delta: number): void;
  seekToFraction(fraction: number): void;
  adjustVolume(delta: number): void;
  toggleMute(): void;
  cycleSubtitles(): void;
  stepRate(direction: number): void;
  setRate(rate: number): void;
  toggleFullscreen(): void;
  toggleTheater(): void;
  togglePip(): void;
  toggleShortcuts(): void;
  escape(): void;
}

/** The subset of a KeyboardEvent the table reads. */
export interface ShortcutKey {
  code: string;
  key: string;
  shiftKey: boolean;
}

export type ShortcutGroup = "Playback" | "Seeking" | "Audio" | "Speed" | "Display";

export interface Shortcut {
  group: ShortcutGroup;
  keys: string[];
  label: string;
  combo?: string[];
  match?: (e: ShortcutKey) => boolean;
  /** Works with shortcuts turned off and with no player on screen. */
  anytime?: boolean;
  run: (e: ShortcutKey) => void;
}

export function buildShortcuts(a: ShortcutActions, seekStep: () => number): Shortcut[] {
  return [
    { group: "Playback", keys: ["Space", "K"], combo: ["Space", "KeyK"], label: "Play / pause", run: () => a.togglePlayback() },
    { group: "Playback", keys: ["N"], combo: ["KeyN"], label: "Next episode", run: () => a.goEpisode(1) },
    { group: "Playback", keys: ["P"], combo: ["KeyP"], label: "Previous episode", run: () => a.goEpisode(-1) },
    { group: "Playback", keys: ["S"], combo: ["KeyS"], label: "Skip intro / recap / credits", run: () => a.skipSegment() },
    {
      group: "Seeking",
      keys: ["←"],
      combo: ["ArrowLeft"],
      get label() {
        return `Back ${seekStep()} seconds`;
      },
      run: () => a.seekBy(-seekStep()),
    },
    {
      group: "Seeking",
      keys: ["→"],
      combo: ["ArrowRight"],
      get label() {
        return `Forward ${seekStep()} seconds`;
      },
      run: () => a.seekBy(seekStep()),
    },
    { group: "Seeking", keys: ["J"], combo: ["KeyJ"], label: "Back 10 seconds", run: () => a.seekBy(-10) },
    { group: "Seeking", keys: ["L"], combo: ["KeyL"], label: "Forward 10 seconds", run: () => a.seekBy(10) },
    { group: "Seeking", keys: ["Shift + ←"], combo: ["Shift+ArrowLeft"], label: "Back 30 seconds", run: () => a.seekBy(-30) },
    { group: "Seeking", keys: ["Shift + →"], combo: ["Shift+ArrowRight"], label: "Forward 30 seconds", run: () => a.seekBy(30) },
    { group: "Seeking", keys: ["Home"], combo: ["Home"], label: "Jump to the start", run: () => a.seekToFraction(0) },
    { group: "Seeking", keys: ["End"], combo: ["End"], label: "Jump to the end", run: () => a.seekToFraction(1) },
    {
      group: "Seeking",
      keys: ["0 – 9"],
      label: "Jump to 0% – 90%",
      match: (e) => /^(Digit|Numpad)[0-9]$/.test(e.code) && !e.shiftKey,
      run: (e) => a.seekToFraction(Number(e.code.slice(-1)) / 10),
    },
    { group: "Audio", keys: ["↑"], combo: ["ArrowUp"], label: "Volume up", run: () => a.adjustVolume(0.05) },
    { group: "Audio", keys: ["↓"], combo: ["ArrowDown"], label: "Volume down", run: () => a.adjustVolume(-0.05) },
    { group: "Audio", keys: ["M"], combo: ["KeyM"], label: "Mute / unmute", run: () => a.toggleMute() },
    { group: "Audio", keys: ["C"], combo: ["KeyC"], label: "Cycle subtitles", run: () => a.cycleSubtitles() },
    { group: "Speed", keys: [">"], combo: ["Period"], label: "Speed up", run: () => a.stepRate(1) },
    { group: "Speed", keys: ["<"], combo: ["Comma"], label: "Slow down", run: () => a.stepRate(-1) },
    { group: "Speed", keys: ["R"], combo: ["KeyR"], label: "Reset to normal speed", run: () => a.setRate(1) },
    { group: "Display", keys: ["F"], combo: ["KeyF"], label: "Fullscreen", run: () => a.toggleFullscreen() },
    { group: "Display", keys: ["T"], combo: ["KeyT"], label: "Theater mode", run: () => a.toggleTheater() },
    { group: "Display", keys: ["I"], combo: ["KeyI"], label: "Picture in picture", run: () => a.togglePip() },
    {
      group: "Display",
      keys: ["?"],
      label: "Show / hide this list",
      match: (e) => e.key === "?",
      anytime: true,
      run: () => a.toggleShortcuts(),
    },
    {
      group: "Display",
      keys: ["Esc"],
      combo: ["Escape"],
      label: "Close menus, leave fullscreen",
      anytime: true,
      run: () => a.escape(),
    },
  ];
}

/** "Shift+KeyL" — modifier prefix plus the physical key. */
export function shortcutCombo(e: ShortcutKey): string {
  return `${e.shiftKey ? "Shift+" : ""}${e.code}`;
}

export function findShortcut(list: readonly Shortcut[], e: ShortcutKey): Shortcut | undefined {
  const combo = shortcutCombo(e);
  return list.find((s) => (s.match ? s.match(e) : s.combo?.includes(combo)));
}

/** The help modal's sections, grouped in table order. */
export function shortcutGroups(list: readonly Shortcut[]): { name: ShortcutGroup; items: Shortcut[] }[] {
  const groups: { name: ShortcutGroup; items: Shortcut[] }[] = [];
  for (const s of list) {
    let group = groups.find((g) => g.name === s.group);
    if (!group) groups.push((group = { name: s.group, items: [] }));
    group.items.push(s);
  }
  return groups;
}
