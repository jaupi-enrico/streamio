import { describe, expect, it } from "vitest";
import { concatUint8Arrays, decryptAES128, parseMaster, parseMedia, pool, segmentIv } from "./hls-download";

describe("hls download", () => {
  it("orders a master's variants by bandwidth and resolves them against the base", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
      "low/index.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720",
      "https://other/hi.m3u8",
    ].join("\n");
    expect(parseMaster(master, "https://cdn/show/")).toEqual([
      { url: "https://other/hi.m3u8", bandwidth: 2400000 },
      { url: "https://cdn/show/low/index.m3u8", bandwidth: 800000 },
    ]);
  });

  it("reads segments and the AES key from a media playlist", () => {
    const media = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0000000000000000000000000000000a',
      "#EXTINF:4,",
      "seg0.ts",
      "",
      "#EXTINF:4,",
      "/abs/seg1.ts",
    ].join("\r\n");
    expect(parseMedia(media, "https://cdn/v/")).toEqual({
      segments: ["https://cdn/v/seg0.ts", "https://cdn/abs/seg1.ts"],
      key: { url: "https://cdn/v/key.bin", iv: "0000000000000000000000000000000a" },
    });
  });

  it("uses the sequence number as the IV when the playlist gives none", () => {
    expect([...segmentIv(null, 7)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
    expect(segmentIv("ff", 0)[15]).toBe(255);
  });

  it("decrypts what AES-128-CBC encrypted", async () => {
    const keyBytes = new Uint8Array(16).fill(3);
    const iv = segmentIv(null, 1);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
    const plain = new TextEncoder().encode("segment bytes");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, plain);
    expect(new TextDecoder().decode(await decryptAES128(encrypted, keyBytes, iv))).toBe("segment bytes");
  });

  it("keeps results in order under concurrency and reports progress", async () => {
    const seen: number[] = [];
    const out = await pool(
      3,
      [30, 5, 20, 1, 10],
      (ms, i) => new Promise<number>((r) => setTimeout(() => r(i), ms)),
      (done) => seen.push(done),
    );
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("concatenates chunks", () => {
    expect([...concatUint8Arrays([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])])]).toEqual([1, 2, 3]);
  });
});
