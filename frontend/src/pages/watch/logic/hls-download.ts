/**
 * The HLS downloader's pure parts — parseMaster / parseMedia /
 * decryptAES128 / pool / concatUint8Arrays in public/scripts/watch.js.
 */

export interface HlsVariant {
  url: string;
  bandwidth: number;
}

export interface HlsKey {
  url: string;
  /** Hex without the 0x, or null: the segment's sequence number is the IV. */
  iv: string | null;
}

/** A master playlist's variants, highest bandwidth first. */
export function parseMaster(text: string, baseUrl: string): HlsVariant[] {
  const lines = text.split("\n");
  const variants: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes("#EXT-X-STREAM-INF")) {
      const url = lines[i + 1]?.trim();
      const bandwidth = lines[i]!.match(/BANDWIDTH=(\d+)/)?.[1] || 0;
      if (url) variants.push({ url: new URL(url, baseUrl).href, bandwidth: Number(bandwidth) });
    }
  }
  return variants.sort((a, b) => b.bandwidth - a.bandwidth);
}

/** A media playlist's segment URLs, and its AES-128 key if it has one (the last one wins). */
export function parseMedia(text: string, baseUrl: string): { segments: string[]; key: HlsKey | null } {
  const lines = text.split("\n");
  let key: HlsKey | null = null;
  const segments: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-KEY")) {
      const uri = line.match(/URI="(.+?)"/)?.[1];
      const ivHex = line.match(/IV=0x([0-9a-fA-F]+)/)?.[1];
      if (uri) key = { url: new URL(uri, baseUrl).href, iv: ivHex || null };
    }
    if (line && !line.startsWith("#")) segments.push(new URL(line, baseUrl).href);
  }
  return { segments, key };
}

/** The IV for segment `idx`: the playlist's own, else the sequence number in the last byte. */
export function segmentIv(ivHex: string | null, idx: number): Uint8Array<ArrayBuffer> {
  if (ivHex) {
    const hex = ivHex.padStart(32, "0");
    return new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  }
  return new Uint8Array(16).fill(0).map((_, i) => (i === 15 ? idx : 0));
}

export async function decryptAES128(data: ArrayBuffer, keyBytes: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-CBC" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, data);
  return new Uint8Array(decrypted);
}

/** `fn` over `items` with at most `limit` in flight; results keep the items' order. */
export async function pool<T, R>(
  limit: number,
  items: readonly T[],
  fn: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  let done = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!, idx);
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

export function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
