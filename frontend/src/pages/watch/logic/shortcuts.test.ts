import { describe, expect, it, vi } from "vitest";
import { buildShortcuts, findShortcut, shortcutGroups, type ShortcutActions } from "./shortcuts";

function actions(): ShortcutActions {
  const names: (keyof ShortcutActions)[] = [
    "togglePlayback", "goEpisode", "skipSegment", "seekBy", "seekToFraction", "adjustVolume", "toggleMute",
    "cycleSubtitles", "stepRate", "setRate", "toggleFullscreen", "toggleTheater", "togglePip", "toggleShortcuts", "escape",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as ShortcutActions;
}

const key = (code: string, extra: Partial<{ key: string; shiftKey: boolean }> = {}) => ({
  code,
  key: extra.key ?? "",
  shiftKey: extra.shiftKey ?? false,
});

describe("shortcuts", () => {
  it("matches by physical key, with Shift as its own binding", () => {
    const a = actions();
    let step = 5;
    const list = buildShortcuts(a, () => step);
    findShortcut(list, key("ArrowLeft"))!.run(key("ArrowLeft"));
    expect(a.seekBy).toHaveBeenLastCalledWith(-5);
    findShortcut(list, key("ArrowLeft", { shiftKey: true }))!.run(key("ArrowLeft"));
    expect(a.seekBy).toHaveBeenLastCalledWith(-30);
    step = 15;
    expect(findShortcut(list, key("ArrowRight"))!.label).toBe("Forward 15 seconds");
  });

  it("jumps by digit, but not with Shift held", () => {
    const a = actions();
    const list = buildShortcuts(a, () => 10);
    findShortcut(list, key("Numpad7"))!.run(key("Numpad7"));
    expect(a.seekToFraction).toHaveBeenCalledWith(0.7);
    expect(findShortcut(list, key("Digit3", { shiftKey: true }))).toBeUndefined();
  });

  it("finds ? by the character, whatever the layout", () => {
    const list = buildShortcuts(actions(), () => 10);
    const help = findShortcut(list, key("Minus", { key: "?", shiftKey: true }));
    expect(help?.anytime).toBe(true);
    expect(help?.label).toBe("Show / hide this list");
  });

  it("groups the help in table order", () => {
    const groups = shortcutGroups(buildShortcuts(actions(), () => 10));
    expect(groups.map((g) => g.name)).toEqual(["Playback", "Seeking", "Audio", "Speed", "Display"]);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(25);
  });
});
