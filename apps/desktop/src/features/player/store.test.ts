import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSiblingVideos } = vi.hoisted(() => ({
  listSiblingVideos: vi.fn(),
}));

vi.mock("./api", () => ({ listSiblingVideos }));
vi.mock("./surfaceBridge", () => ({ ensureSurfaceBounds: vi.fn() }));

import { usePlayerStore } from "./store";

beforeEach(() => {
  listSiblingVideos.mockReset();
  usePlayerStore.setState({ playlist: [], playlistIndex: -1 });
});

describe("syncPlaylistForPath", () => {
  it("falls back to the single path when the sibling listing is not an array", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listSiblingVideos.mockResolvedValue(null);

    await usePlayerStore.getState().syncPlaylistForPath("D:\\movie\\a.mkv");

    expect(usePlayerStore.getState().playlist).toEqual(["D:\\movie\\a.mkv"]);
    expect(usePlayerStore.getState().playlistIndex).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("selects the opened file inside the sibling listing", async () => {
    listSiblingVideos.mockResolvedValue(["D:/movie/a.mkv", "D:/movie/b.mkv"]);

    await usePlayerStore.getState().syncPlaylistForPath("D:\\movie\\B.mkv");

    expect(usePlayerStore.getState().playlist).toEqual([
      "D:/movie/a.mkv",
      "D:/movie/b.mkv",
    ]);
    expect(usePlayerStore.getState().playlistIndex).toBe(1);
  });
});
