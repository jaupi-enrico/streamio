import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../lib/auth")>()),
  apiFetch: (url: string) => apiFetch(url),
}));
vi.mock("../../lib/api", () => ({
  fetchShow: async () => ({ kind: "ok", show: { title: "t" } }),
}));

const { LibraryList } = await import("./library-store");

function page(n: number): Response {
  const items = Array.from({ length: n }, (_, i) => ({ provider: "p", show_id: `s${i}` }));
  return new Response(JSON.stringify(items), { headers: { "X-Total-Count": String(n), "X-Page-Rows": String(n) } });
}

describe("LibraryList.activate", () => {
  beforeEach(() => apiFetch.mockReset());

  it("starts a listing nobody loaded yet", async () => {
    // The history tab is only ever started through activate(); `loading`
    // starts true for the spinner, which once made activate() skip it.
    apiFetch.mockResolvedValue(page(3));
    const list = new LibraryList("/api/account/history");
    list.activate();
    await vi.waitFor(() => expect(list.getSnapshot().data).toHaveLength(3));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not refetch a listing that is already in flight", async () => {
    let resolve!: (r: Response) => void;
    apiFetch.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const list = new LibraryList("/api/account/watchlist");
    void list.load(true);
    list.activate();
    resolve(page(2));
    await vi.waitFor(() => expect(list.getSnapshot().loading).toBe(false));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
