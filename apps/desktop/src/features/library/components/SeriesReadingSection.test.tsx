import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";

import { SeriesReadingSection } from "./SeriesReadingSection";
import { useReadingStore } from "../readingStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const SERIES = {
  root: "C:\\s",
  groupKey: "Show",
  label: "剧名",
  episodes: [
    { season: 1, episode: 1, title: "开篇", path: "C:\\s\\e01.mkv" },
    { season: 1, episode: 2, title: "发展", path: "C:\\s\\e02.mkv" },
    { season: 1, episode: 3, title: "结局", path: "C:\\s\\e03.mkv" },
  ],
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SeriesReadingSection />
    </QueryClientProvider>,
  );
}

function openCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "player_open");
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "library_series_for_media") return Promise.resolve(SERIES);
    if (cmd === "media_list_siblings") return Promise.resolve([]);
    if (cmd === "player_open") {
      const path = (args as { path?: string }).path ?? "C:\\s\\e01.mkv";
      return Promise.resolve({
        status: "Paused",
        currentTimeMs: 0,
        durationMs: 60_000,
        volume: 80,
        rate: 1,
        currentFile: path,
        error: null,
      });
    }
    return Promise.resolve(null);
  });
  useReadingStore.setState({ doneSet: {} });
  usePlayerStore.setState({
    currentFile: "C:\\s\\e01.mkv",
    status: "Paused",
    currentTimeMs: 0,
    playlist: [],
    playlistIndex: -1,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("SeriesReadingSection", () => {
  it("lists episodes with statuses and continues the first not-done", async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByText("继续阅读 · 剧名")).toBeInTheDocument();
    });
    expect(screen.getByText("S01E01 开篇")).toBeInTheDocument();
    expect(screen.getByText("S01E03 结局")).toBeInTheDocument();
    fireEvent.click(screen.getByText("继续：S01E01 开篇"));
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1);
    });
    expect(openCalls()[0]?.[1]).toMatchObject({ path: "C:\\s\\e01.mkv" });
  });

  it("skips done episodes and toggles completion", async () => {
    useReadingStore.getState().markDone("C:\\s\\e01.mkv");
    renderSection();
    await waitFor(() => {
      expect(screen.getByText("继续：S01E02 发展")).toBeInTheDocument();
    });
    const doneButtons = screen.getAllByText("撤销");
    expect(doneButtons).toHaveLength(1);
    fireEvent.click(screen.getAllByText("完成")[0] as Element);
    await waitFor(() => {
      expect(screen.getAllByText("撤销")).toHaveLength(2);
    });
  });

  it("survives a missing file without crashing", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "library_series_for_media") return Promise.resolve(SERIES);
      if (cmd === "media_list_siblings") return Promise.resolve([]);
      if (cmd === "player_open") {
        throw { code: "LoadError", message: "无法打开该媒体文件" };
      }
      return Promise.resolve(null);
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText("继续：S01E01 开篇")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("继续：S01E01 开篇"));
    await waitFor(() => {
      expect(usePlayerStore.getState().status).toBe("Error");
    });
    // Section stays mounted and usable.
    expect(screen.getByText("S01E02 发展")).toBeInTheDocument();
  });

  it("stays silent when the media is not indexed", async () => {
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
    const { container } = renderSection();
    await waitFor(() => {
      expect(usePlayerStore.getState().currentFile).toBe("C:\\s\\e01.mkv");
    });
    expect(container.textContent).not.toContain("继续阅读");
  });

  it("stays silent for remote media without querying", async () => {
    usePlayerStore.setState({
      currentFile: "https://example.com/v/e01.mkv",
      status: "Playing",
    });
    const { container } = renderSection();
    await waitFor(() => {
      expect(usePlayerStore.getState().currentFile).toContain("https://");
    });
    expect(container.textContent).not.toContain("继续阅读");
    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_series_for_media"),
    ).toHaveLength(0);
  });

  it("offers a retry when the series query fails with no cache", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "library_series_for_media")
        return Promise.reject(new Error("boom"));
      return Promise.resolve(null);
    });
    renderSection();
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(
      screen.getByText("剧集信息加载失败，暂无可显示的缓存。"),
    ).toBeInTheDocument();
    await fireEvent.click(retry);
    await waitFor(() => {
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([cmd]) => cmd === "library_series_for_media"),
      ).toHaveLength(2);
    });
    // Still the honest fallback, not a fabricated list.
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("names the current episode with its real playback state", async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByText("继续阅读 · 剧名")).toBeInTheDocument();
    });
    const current = screen.getByRole("button", { name: "S01E01 开篇" });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).toHaveAttribute("title", "当前项 · 已暂停");
    expect(current).not.toBeDisabled();
  });

  describe("query retry gate", () => {
    const seriesCalls = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "library_series_for_media");

    it("hides the retry after the same file flips to Error", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "library_series_for_media")
          return Promise.reject(new Error("boom"));
        return Promise.resolve(null);
      });
      renderSection();
      await screen.findByRole("button", { name: "重试" });
      expect(seriesCalls()).toHaveLength(1);

      // Same file, player now Error: the query is disabled, so the stale
      // error must not offer a refetch that bypasses the enabled gate.
      usePlayerStore.setState({ status: "Error" });
      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "重试" }),
        ).not.toBeInTheDocument();
      });
      expect(seriesCalls()).toHaveLength(1);
    });

    it("never queries while Idle or Loading", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "library_series_for_media")
          return Promise.reject(new Error("boom"));
        return Promise.resolve(null);
      });
      // Stopped shape: Idle but the file is still held.
      usePlayerStore.setState({ status: "Idle" });
      const first = renderSection();
      await waitFor(() => {
        expect(usePlayerStore.getState().status).toBe("Idle");
      });
      expect(seriesCalls()).toHaveLength(0);
      expect(
        first.queryByRole("button", { name: "重试" }),
      ).not.toBeInTheDocument();
      first.unmount();

      usePlayerStore.setState({ status: "Loading" });
      const second = renderSection();
      await waitFor(() => {
        expect(usePlayerStore.getState().status).toBe("Loading");
      });
      expect(seriesCalls()).toHaveLength(0);
      expect(
        second.queryByRole("button", { name: "重试" }),
      ).not.toBeInTheDocument();
      second.unmount();
    });

    it("opens from the cached list while in Error", async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByText("继续阅读 · 剧名")).toBeInTheDocument();
      });
      // Cached series survives the Error flip with its own open retry.
      usePlayerStore.setState({ status: "Error" });
      await waitFor(() => {
        expect(screen.getByText("S01E02 发展")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: "重试" }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "S01E02 发展" }));
      await waitFor(() => {
        expect(openCalls()).toHaveLength(1);
      });
      expect(openCalls()[0]?.[1]).toMatchObject({ path: "C:\\s\\e02.mkv" });
    });

    it("restores a working retry when the player recovers", async () => {
      let fail = true;
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "library_series_for_media") {
          return fail ? Promise.reject(new Error("boom")) : Promise.resolve(SERIES);
        }
        return Promise.resolve(null);
      });
      usePlayerStore.setState({ status: "Error" });
      renderSection();
      await waitFor(() => {
        expect(usePlayerStore.getState().status).toBe("Error");
      });
      // Disabled query: silent, no call, no retry.
      expect(seriesCalls()).toHaveLength(0);
      expect(
        screen.queryByRole("button", { name: "重试" }),
      ).not.toBeInTheDocument();

      // Recovery re-enables the query; it fails once, offering a retry.
      usePlayerStore.setState({ status: "Paused" });
      const retry = await screen.findByRole("button", { name: "重试" });
      expect(seriesCalls()).toHaveLength(1);

      fail = false;
      fireEvent.click(retry);
      await waitFor(() => {
        expect(screen.getByText("继续阅读 · 剧名")).toBeInTheDocument();
      });
      expect(seriesCalls()).toHaveLength(2);
    });
  });
});
