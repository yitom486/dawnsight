import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { getAcpWatchFeed, type AcpWatchFeedItem } from "../api";
import { WatchFeedView } from "./WatchFeedView";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getAcpWatchFeed: vi.fn() };
});

afterEach(() => {
  cleanup();
  usePlayerStore.setState({ currentFile: null, currentTimeMs: 0 });
  vi.mocked(getAcpWatchFeed).mockReset();
});

function renderFeed(props: ComponentProps<typeof WatchFeedView>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WatchFeedView {...props} />
    </QueryClientProvider>,
  );
}

function makeItem(
  id: number,
  content: string,
  startMs: number,
  itemType: string,
  chapterId = id,
): AcpWatchFeedItem {
  return {
    id,
    episodeId: 2,
    chapterId,
    revisionId: null,
    taskId: null,
    itemType,
    source: "ai",
    content,
    spoilerLevel: "current_chapter",
    contentVersion: "v1",
    publishedAtMs: id,
    chapter: {
      id: chapterId,
      startMs,
      endMs: startMs + 10_000,
      spoilerLevel: "current_chapter",
      title: `章节 ${chapterId}`,
      mainline: null,
      status: "ready",
    },
    revision: null,
    questionCandidate: null,
    screenshotRefs: [],
    coverRef: null,
  };
}

describe("WatchFeedView", () => {
  it("shows a compact empty state when no durable projection exists", () => {
    renderFeed({ onSelectTask: vi.fn() });

    expect(screen.getByText("暂无观剧记录")).toBeInTheDocument();
    expect(screen.queryByText(/已就绪/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI 观剧流" })).toBeInTheDocument();
  });

  it("shows watch-feed shortcuts and emits a stable task id", async () => {
    const onSelectTask = vi.fn();
    renderFeed({ onSelectTask });

    expect(screen.getByRole("button", { name: "本段总结" })).toBeInTheDocument();
    await screen.getByRole("button", { name: "本段总结" }).click();
    expect(onSelectTask).toHaveBeenCalledWith("chapter_recap");
  });

  it("renders one replaceable card per slot and filters future chapters", async () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\episode-01.mp4",
      currentTimeMs: 10_000,
    });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({
      source: "sqlite",
      items: [
        makeItem(1, "当前观剧记录", 0, "chapter", 1),
        makeItem(
          2,
          JSON.stringify({
            version: "chapter_recap.v1",
            scope: { label: "已观看内容" },
            recap: "已格式化的前情提要",
            evidence: ["字幕证据"],
          }),
          0,
          "recap",
          1,
        ),
        makeItem(3, "本段需要留意人物的选择", 0, "watch_point", 1),
        makeItem(4, "尚未播放的章节", 30_000, "chapter", 2),
      ],
    });

    renderFeed({ onSelectTask: vi.fn() });

    expect(await screen.findByText("当前观剧记录")).toBeInTheDocument();
    expect(screen.queryByText("尚未播放的章节")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-watch-feed-slot]")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /前情提要/ }));
    expect(await screen.findByText("已格式化的前情提要")).toBeInTheDocument();
    expect(screen.queryByText(/chapter_recap\.v1/)).not.toBeInTheDocument();

    usePlayerStore.setState({ currentTimeMs: 30_000 });

    expect(await screen.findByText("尚未播放的章节")).toBeInTheDocument();
    expect(screen.queryByText("当前观剧记录")).not.toBeInTheDocument();
  });

  it("prefers SQLite content and keeps asset references non-visual metadata", async () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\episode-01.mp4",
      currentTimeMs: 10_000,
    });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({
      source: "sqlite",
      items: [
        {
          ...makeItem(7, "已保存的章节主线", 10_000, "chapter", 3),
          revisionId: 4,
          taskId: 5,
          screenshotRefs: ["opaque-frame-1"],
          coverRef: "opaque-cover-1",
        },
      ],
    });

    renderFeed({ onSelectTask: vi.fn() });

    expect(await screen.findByText("已保存的章节主线")).toBeInTheDocument();
    expect(screen.getByText(/含章节封面引用/)).toBeInTheDocument();
    expect(screen.getByText(/含 1 个画面引用/)).toBeInTheDocument();
  });

  it("keeps the watch feed compact when the SQLite read fails", async () => {
    usePlayerStore.setState({ currentFile: "C:\\videos\\episode-01.mp4" });
    vi.mocked(getAcpWatchFeed).mockRejectedValue(new Error("read failed"));

    renderFeed({ onSelectTask: vi.fn() });

    expect(
      await screen.findByText("本地观剧流暂时不可用，聊天仍可继续使用。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本段总结" })).toBeInTheDocument();
  });

  it("shows a safe empty state for an empty SQLite projection", async () => {
    usePlayerStore.setState({ currentFile: "C:\\videos\\episode-01.mp4" });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({ source: "empty", items: [] });

    renderFeed({ onSelectTask: vi.fn() });

    expect(await screen.findByText("暂无观剧记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "剧情梳理" })).toBeInTheDocument();
  });

  it("keeps the position line readable without live-announcing every tick", async () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\episode-01.mp4",
      currentTimeMs: 10_000,
    });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({
      source: "sqlite",
      items: [makeItem(1, "当前观剧记录", 0, "chapter", 1)],
    });

    renderFeed({ onSelectTask: vi.fn() });

    await screen.findByText("当前观剧记录");
    const position = document.querySelector("[data-watch-feed-position]");
    expect(position).not.toBeNull();
    expect(position?.getAttribute("role")).toBeNull();
    expect(position?.textContent).toMatch(/当前播放/);
  });

  it("keeps the loading line as the only live region", async () => {
    usePlayerStore.setState({ currentFile: "C:\\videos\\episode-01.mp4" });
    let resolveFeed!: (value: { source: "sqlite"; items: never[] }) => void;
    const gate = new Promise<{ source: "sqlite"; items: never[] }>((resolve) => {
      resolveFeed = resolve;
    });
    vi.mocked(getAcpWatchFeed).mockImplementation(() => gate);

    renderFeed({ onSelectTask: vi.fn() });

    const loading = await screen.findByText("正在读取已保存的观剧流…");
    expect(loading.getAttribute("role")).toBe("status");
    resolveFeed({ source: "sqlite", items: [] });
    await waitFor(() => {
      expect(screen.queryByText("正在读取已保存的观剧流…")).not.toBeInTheDocument();
    });
  });

  it("keeps the user's expanded recap across playback ticks until the item changes", async () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\episode-01.mp4",
      currentTimeMs: 10_000,
    });
    const recap = makeItem(
      2,
      JSON.stringify({
        version: "chapter_recap.v1",
        scope: { label: "已观看内容" },
        recap: "已格式化的前情提要",
        evidence: ["字幕证据"],
      }),
      0,
      "recap",
      1,
    );
    vi.mocked(getAcpWatchFeed).mockResolvedValue({ source: "sqlite", items: [recap] });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (
      <QueryClientProvider client={client}>
        <WatchFeedView onSelectTask={vi.fn()} />
      </QueryClientProvider>
    );
    render(tree);
    fireEvent.click(await screen.findByRole("button", { name: /前情提要/ }));
    expect(await screen.findByText("已格式化的前情提要")).toBeInTheDocument();

    usePlayerStore.setState({ currentTimeMs: 11_000 });
    await waitFor(() => {
      expect(document.querySelector("[data-watch-feed-position]"))
        .toHaveAttribute("data-watch-feed-position", "11000");
    });
    expect(screen.getByText("已格式化的前情提要")).toBeInTheDocument();

    vi.mocked(getAcpWatchFeed).mockResolvedValue({
      source: "sqlite",
      items: [{ ...recap, id: 9 }],
    });
    await client.invalidateQueries();
    await waitFor(() => {
      expect(screen.queryByText("已格式化的前情提要")).not.toBeInTheDocument();
    });
  });

  it("disables the quick actions without changing their set", async () => {
    usePlayerStore.setState({ currentFile: "C:\\videos\\episode-01.mp4" });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({ source: "empty", items: [] });
    const onSelectTask = vi.fn();

    renderFeed({ onSelectTask, quickActionsDisabled: true });

    await screen.findByText("暂无观剧记录");
    for (const name of ["本段总结", "后续看点", "观众问题", "剧情梳理"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it("hides unknown closed JSON behind the safe fallback", async () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\episode-01.mp4",
      currentTimeMs: 10_000,
    });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({
      source: "sqlite",
      items: [makeItem(5, '{"version":"nope.v9","blob":{}}', 0, "chapter", 1)],
    });

    renderFeed({ onSelectTask: vi.fn() });

    expect(await screen.findByText("观剧记录")).toBeInTheDocument();
    expect(screen.getByText("该结构化内容暂时无法展示，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/nope\.v9/)).not.toBeInTheDocument();
  });

  it("keeps future content out of accessible names too", async () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\episode-01.mp4",
      currentTimeMs: 10_000,
    });
    vi.mocked(getAcpWatchFeed).mockResolvedValue({
      source: "sqlite",
      items: [
        makeItem(1, "当前观剧记录", 0, "chapter", 1),
        makeItem(8, "未来剧透正文", 60_000, "chapter", 9),
      ],
    });

    renderFeed({ onSelectTask: vi.fn() });

    expect(await screen.findByText("当前观剧记录")).toBeInTheDocument();
    expect(screen.queryByText("未来剧透正文")).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-watch-feed-item-id="8"]'),
    ).not.toBeInTheDocument();
    expect(
      [...document.querySelectorAll("[aria-label]")].some((el) =>
        (el.getAttribute("aria-label") ?? "").includes("未来剧透"),
      ),
    ).toBe(false);
  });
});
