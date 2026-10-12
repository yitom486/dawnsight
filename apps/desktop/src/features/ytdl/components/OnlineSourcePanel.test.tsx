import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";

import { OnlineResourceSettingsPanel } from "./OnlineResourceSettingsPanel";
import { OnlineSourcePanel } from "./OnlineSourcePanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { invoke } from "@tauri-apps/api/core";

const REMOTE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx&index=7";

const META = {
  mediaId: "youtube:dQw4w9WgXcQ",
  title: "加长标题纪录片",
  durationMs: 1_574_000,
  webpageUrl: REMOTE,
  extractor: "youtube",
  chapters: [
    { id: 1, startMs: 0, endMs: 60_000, title: "开场" },
    { id: 2, startMs: 60_000, endMs: 120_000, title: null },
  ],
  formats: [],
  subtitles: [{ language: "zh", ext: "vtt", name: "中文" }],
};

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function cachedCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "ytdl_cached_resolve");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  usePlayerStore.setState({
    currentFile: null,
    sourceKind: "local",
    status: "Idle",
    statusMessage: "",
    error: null,
  });
});

describe("OnlineSourcePanel view separation", () => {
  it("keeps URL entry and resolver operations in settings", () => {
    usePlayerStore.setState({ currentFile: null, status: "Idle" });
    renderWithQuery(<OnlineSourcePanel />);
    expect(screen.queryByPlaceholderText("https://www.youtube.com/watch?v=…")).not.toBeInTheDocument();
    expect(screen.getByText("尚未打开在线媒体。")).toBeInTheDocument();

    cleanup();
    renderWithQuery(<OnlineResourceSettingsPanel />);
    expect(screen.getByPlaceholderText("https://www.youtube.com/watch?v=…")).toBeInTheDocument();
    expect(screen.getByText("在线解析 / 登录态")).toBeInTheDocument();
  });

  it("routes to existing settings only through the composition callback", () => {
    const onOpenSettings = vi.fn();
    usePlayerStore.setState({ currentFile: null, status: "Idle" });
    renderWithQuery(<OnlineSourcePanel onOpenSettings={onOpenSettings} />);

    const button = screen.getByRole("button", { name: "打开在线资源设置" });
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("explains the settings location when mounted standalone", () => {
    usePlayerStore.setState({ currentFile: null, status: "Idle" });
    renderWithQuery(<OnlineSourcePanel />);

    expect(
      screen.getByText("在线 URL 与登录配置请前往设置「在线资源」。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开在线资源设置" }),
    ).not.toBeInTheDocument();
  });

  it("shows cached title, source, mapped status and honest counts", async () => {
    usePlayerStore.setState({
      currentFile: REMOTE,
      sourceKind: "remote",
      status: "Playing",
      statusMessage: REMOTE,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["ytdl-resolve", REMOTE], META);
    render(
      <QueryClientProvider client={client}>
        <OnlineSourcePanel onOpenSettings={() => {}} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("加长标题纪录片")).toBeInTheDocument();
    });
    expect(screen.getByText("来源：youtube · youtube.com")).toBeInTheDocument();
    expect(screen.getByText("正在播放 · 2 个章节 · 1 条字幕")).toBeInTheDocument();
    // Signed stream params never surface as body copy.
    expect(screen.queryByText(/list=PLxxx/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Playing/)).not.toBeInTheDocument();
  });

  it("presents remote player failure honestly without new queries", async () => {
    usePlayerStore.setState({
      currentFile: REMOTE,
      sourceKind: "remote",
      status: "Error",
      statusMessage: "无法打开在线视频",
      error: { code: "LoadError", message: "无法打开在线视频" },
    });
    renderWithQuery(<OnlineSourcePanel />);
    await waitFor(() => {
      expect(screen.getByText("无法打开在线视频")).toBeInTheDocument();
    });

    expect(screen.getByText("播放失败")).toBeInTheDocument();
    expect(screen.queryByText("尚未打开在线媒体。")).not.toBeInTheDocument();
    expect(cachedCalls()).toHaveLength(0);
  });

  it("does not query without media or for local files", () => {
    usePlayerStore.setState({ currentFile: null, status: "Idle" });
    const { unmount } = renderWithQuery(<OnlineSourcePanel />);
    unmount();

    usePlayerStore.setState({
      currentFile: "D:/媒体/本地.mp4",
      sourceKind: "local",
      status: "Paused",
    });
    renderWithQuery(<OnlineSourcePanel />);
    expect(screen.getByText(/当前为本地媒体/)).toBeInTheDocument();
    expect(cachedCalls()).toHaveLength(0);
  });
});
