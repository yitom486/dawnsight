import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useChapterProgressStore } from "../progressStore";
import { useAcpProfilesStore } from "@dawnsight/chat-ui/acpProfilesStore";
import { useAcpSettingsStore } from "@dawnsight/chat-ui/acpSettingsStore";
import { useChatUiStore } from "@dawnsight/chat-ui/chatUiStore";
import { useModelCatalogStore } from "@dawnsight/chat-ui/modelCatalogStore";
import { useChapterAgentSettingsStore } from "@dawnsight/chat-ui/chapterAgentSettingsStore";

import { ChaptersPanel, type ChaptersPanelProps } from "./ChaptersPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const BASE_SNAPSHOT = {
  id: 1,
  taskKey: "chapter-segmentation:C:\\v\\a.mp4:C:\\v\\a.mp4",
  taskType: "chapter_segmentation",
  episodeId: null,
  chapterId: null,
  episodeIdentity: { kind: "legacy", reason: "metadata_unavailable" },
  status: "pending",
  sessionId: null,
  promptVersion: "1.0",
  outputContractVersion: "chapter_tool_workflow.v1",
  attemptCount: 0,
  retryCount: 0,
  maxAttempts: 3,
  failureCode: null,
  failureMessage: null,
  validationSummary: null,
  canRetry: false,
  retryAction: null,
  agentConfigured: true,
  outputJson: null,
  draftChapters: [],
  createdAtMs: 1,
  updatedAtMs: 1,
};

function renderPanel(props: ChaptersPanelProps = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChaptersPanel {...props} />
    </QueryClientProvider>,
  );
}

function mockInspectEmpty(statusImpl?: (cmd: string) => Promise<unknown>) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "media_inspect")
      return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
    if (cmd === "library_context_for_media") return Promise.resolve(null);
    if (statusImpl) return statusImpl(cmd);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  useChapterProgressStore.setState({ byTaskKey: {} });
  useAcpProfilesStore.setState({ activeProfileId: "codex", profiles: [] });
  useChapterAgentSettingsStore.setState({ profileId: null, selections: {}, defaultsInitializedByProfile: {} });
  useAcpSettingsStore.getState().patchSettings({ modelId: "", reasoningEffort: "" });
  useModelCatalogStore.getState().resetModelCatalog();
  useChatUiStore.setState({});
  mockInspectEmpty((cmd) =>
    cmd === "chapter_segmentation_status"
      ? Promise.reject({ code: "NotFound", message: "尚未开始" })
      : Promise.resolve(null),
  );
  usePlayerStore.setState({
    currentFile: "C:\\v\\a.mp4",
    sourceKind: null,
    status: "Paused",
    currentTimeMs: 500,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  useChapterProgressStore.setState({ byTaskKey: {} });
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ChaptersPanel empty/progress presentation", () => {
  it.each([
    ["preparing_evidence", "取证"],
    ["agent_running", "Agent"],
    ["checking_result", "校验落库"],
  ])("marks only the current step for %s", async (phase, label) => {
    useChapterProgressStore.setState({ byTaskKey: {
      [BASE_SNAPSHOT.taskKey]: {
        taskKey: BASE_SNAPSHOT.taskKey, taskId: 1, attemptId: 1, phase,
        message: "正在分析章节", attemptCount: 1, maxAttempts: 3,
        sequence: 1, committed: false, updatedAtMs: 10,
      },
    } });
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "media_inspect") return Promise.resolve({
        path: "C:\\v\\a.mp4", streams: [],
        chapters: [{ id: 1, startMs: 0, endMs: 10_000, title: "正片" }],
      });
      if (cmd === "library_context_for_media") return Promise.resolve(null);
      if (cmd === "chapter_segmentation_status") {
        const resegment = (args as { request?: { resegment?: boolean } })?.request?.resegment;
        return resegment
          ? Promise.resolve({ ...BASE_SNAPSHOT, status: "running" })
          : Promise.reject({ code: "NotFound", message: "尚未开始" });
      }
      return Promise.resolve(null);
    });
    renderPanel();
    const progress = await screen.findByLabelText("重分段进度");
    await waitFor(() => {
      const current = progress.querySelectorAll('[aria-current="step"]');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(label);
    });
  });
  it("renders long failure and validation text in full", async () => {
    const longFailure = `章节分段结果未通过校验：缺少画面证据FailureMessageWithoutSpaces${"错".repeat(40)}尾`;
    const longSummary = `校验摘要：时间轴不符ValidationSummaryWithoutSpaces${"摘".repeat(40)}尾`;
    mockInspectEmpty((cmd) => {
      if (cmd === "chapter_segmentation_status")
        return Promise.resolve({
          ...BASE_SNAPSHOT,
          status: "validation_failure",
          attemptCount: 1,
          failureMessage: longFailure,
          validationSummary: longSummary,
          canRetry: true,
          retryAction: "retry",
        });
      return Promise.resolve(null);
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "再次尝试" })).toBeEnabled();
    });
    expect(screen.getByText(longFailure, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(longSummary, { exact: false })).toBeInTheDocument();
  });

  it("keeps the purpose runtime controls mounted with an honest fallback note", async () => {
    const { container } = renderPanel({ aiSegmentationStatus: "ready", onStartAiSegmentation: vi.fn() });
    await waitFor(() => {
      expect(screen.getByText("该文件暂无容器章节。")).toBeInTheDocument();
    });
    expect(container.querySelector('section[aria-label="重分段运行时"]')).toBeInTheDocument();
    expect(container.querySelectorAll("section[aria-label='重分段运行时'] select")).toHaveLength(2);
    expect(screen.getByLabelText("重分段模型")).toBeInTheDocument();
    expect(screen.getByLabelText("重分段思考档")).toBeInTheDocument();
    expect(screen.getByText("修改下次启动/重试生效；章节配置独立保存。")).toBeInTheDocument();
  });

  it("shows the running state without a fake success and keeps start out of the way", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "media_inspect")
        return Promise.resolve({
          path: "C:\\v\\a.mp4",
          streams: [],
          chapters: [{ id: 1, startMs: 0, endMs: 10_000, title: "正片" }],
        });
      if (cmd === "library_context_for_media") return Promise.resolve(null);
      if (cmd === "chapter_segmentation_status") {
        const resegment = Boolean(
          (args as { request?: { resegment?: boolean } } | undefined)?.request?.resegment,
        );
        if (resegment)
          return Promise.resolve({ ...BASE_SNAPSHOT, status: "running", attemptCount: 1 });
        return Promise.reject({ code: "NotFound", message: "尚未开始" });
      }
      return Promise.resolve(null);
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("运行中暂不支持取消，请等待本轮结束。")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("重分段进度")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始 AI 分段" })).not.toBeInTheDocument();
    expect(screen.queryByText(/已完成/)).not.toBeInTheDocument();
  });

  it("shows the completed wait-projection text instead of a fabricated list", async () => {
    renderPanel({ aiSegmentationStatus: "completed", onStartAiSegmentation: vi.fn() });
    await waitFor(() => {
      expect(
        screen.getByText("结果已通过校验并保存，章节列表将在任务投影完成后显示。"),
      ).toBeInTheDocument();
    });
  });

  it("disables start while the status is pending and records no start call", async () => {
    const onStartAiSegmentation = vi.fn();
    renderPanel({ aiSegmentationStatus: "pending", onStartAiSegmentation });
    const button = await screen.findByRole("button", { name: "已排队，等待执行…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onStartAiSegmentation).not.toHaveBeenCalled();
  });
});

function invokeCmds(cmd: string) {
  return vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd);
}

describe("ChaptersPanel list and detail reading", () => {
  const LONG_TITLE = `超长真实章节标题不断尾RealChapterTitleWithoutSpaces${"长".repeat(40)}尾`;
  function mockRealList() {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect")
        return Promise.resolve({
          path: "C:\\v\\a.mp4",
          streams: [],
          chapters: [
            { id: 1, startMs: 0, endMs: 10_000, title: LONG_TITLE },
            { id: 2, startMs: 30_000, endMs: null, title: "" },
          ],
        });
      if (cmd === "library_context_for_media") return Promise.resolve(null);
      if (cmd === "chapter_segmentation_status")
        return Promise.reject({ code: "NotFound", message: "尚未开始" });
      if (cmd === "player_seek")
        return Promise.resolve({ status: "Paused", currentTimeMs: 0 });
      return Promise.resolve(null);
    });
  }

  it("marks only the current chapter without claiming paused media is playing", async () => {
    mockRealList();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(LONG_TITLE, { exact: false })).toBeInTheDocument();
    });
    const current = screen.getAllByText("（当前章节）");
    expect(current).toHaveLength(1);
    expect(screen.queryByText(/播放中/)).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: /超长真实章节标题/ });
    expect(row).toHaveAttribute("aria-current", "true");
    const other = screen.getByRole("button", { name: /章节 2/ });
    expect(other).not.toHaveAttribute("aria-current");
    expect(other.textContent).not.toContain("当前章节");
  });

  it("seeks with the exact startMs when a row is activated", async () => {
    mockRealList();
    renderPanel();
    const other = await screen.findByRole("button", { name: /章节 2/ });
    fireEvent.click(other);
    await waitFor(() => {
      expect(invokeCmds("player_seek")).toHaveLength(1);
    });
    expect(invokeCmds("player_seek")[0]?.[1]).toEqual({ positionMs: 30_000 });
  });

  it("keeps draft selection and playing position as separate states", async () => {
    const drafts = [
      { id: 12, stableId: "a", startMs: 0, endMs: 30_000, title: "AI开场", mainline: null, status: "generated", updatedAtMs: 2 },
      { id: 13, stableId: "b", startMs: 30_000, endMs: 60_000, title: "AI发展", mainline: null, status: "validation_failed", updatedAtMs: 2 },
    ];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect")
        return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
      if (cmd === "library_context_for_media") return Promise.resolve(null);
      if (cmd === "chapter_segmentation_status")
        return Promise.resolve({ ...BASE_SNAPSHOT, status: "running", draftChapters: drafts });
      if (cmd === "player_seek")
        return Promise.resolve({ status: "Paused", currentTimeMs: 0 });
      return Promise.resolve(null);
    });
    usePlayerStore.setState({ currentFile: "C:\\v\\a.mp4", currentTimeMs: 35_000 });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("AI开场")).toBeInTheDocument();
    });
    // Default selection is the first draft; playing position is the second.
    expect(screen.getByRole("button", { name: /AI开场/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /AI发展/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("校验失败")).toBeInTheDocument();
  });

  it("shows the cover image when the opaque asset resolves", async () => {
    const drafts = [
      {
        id: 12, stableId: "a", startMs: 0, endMs: 30_000, title: "AI开场", mainline: null,
        status: "generated", updatedAtMs: 2,
        detail: {
          recap: "前情提要", watchPoints: [], mainline: null, outlook: null, questions: [],
          draftKey: "draft-1", evidenceAssetRefs: ["chapter-asset:11"], coverAssetRef: "chapter-asset:11",
          assets: [], revisionNumber: 1, revisionStatus: "accepted", source: "chapter_agent",
          promptVersion: "1.0", contentVersion: "v1",
        },
      },
    ];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect")
        return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
      if (cmd === "chapter_segmentation_status")
        return Promise.resolve({ ...BASE_SNAPSHOT, status: "running", draftChapters: drafts });
      if (cmd === "chapter_asset_get")
        return Promise.resolve({ mime: "image/png", data: "iVBORw0KGgo=" });
      return Promise.resolve(null);
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByAltText("章节代表画面")).toBeInTheDocument();
    });
    expect(screen.getByText("代表画面")).toBeInTheDocument();
    expect(invokeCmds("chapter_asset_get")).toHaveLength(1);
  });

  it("keeps an honest placeholder when the cover cannot load", async () => {
    const drafts = [
      {
        id: 12, stableId: "a", startMs: 0, endMs: 30_000, title: "AI开场", mainline: null,
        status: "generated", updatedAtMs: 2,
        detail: {
          recap: null, watchPoints: [], mainline: null, outlook: null, questions: [],
          draftKey: null, evidenceAssetRefs: ["chapter-asset:404"], coverAssetRef: "chapter-asset:404",
          assets: [], revisionNumber: 1, revisionStatus: "accepted", source: "chapter_agent",
          promptVersion: "1.0", contentVersion: "v1",
        },
      },
    ];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect")
        return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
      if (cmd === "chapter_segmentation_status")
        return Promise.resolve({ ...BASE_SNAPSHOT, status: "running", draftChapters: drafts });
      if (cmd === "chapter_asset_get") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("代表画面暂不可用")).toBeInTheDocument();
    });
    expect(screen.queryByAltText("章节代表画面")).not.toBeInTheDocument();
  });

  it("renders long detail values in full without leaking internals", async () => {
    const longRecap = `超长前情提要不断尾RecapWithoutSpaces${"要".repeat(40)}尾`;
    const longQuestion = `超长问题不断尾QuestionWithoutSpaces${"问".repeat(40)}尾`;
    const drafts = [
      {
        id: 12, stableId: "a", startMs: 0, endMs: 30_000, title: "AI开场", mainline: null,
        status: "generated", updatedAtMs: 2,
        detail: {
          recap: longRecap, watchPoints: [], mainline: null, outlook: null,
          questions: [longQuestion], draftKey: "draft-1", evidenceAssetRefs: [],
          coverAssetRef: null, assets: [], revisionNumber: 2, revisionStatus: "accepted",
          source: "chapter_agent", promptVersion: "1.0", contentVersion: "v1",
        },
      },
    ];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect")
        return Promise.resolve({ path: "C:\\v\\a.mp4", streams: [], chapters: [] });
      if (cmd === "chapter_segmentation_status")
        return Promise.resolve({ ...BASE_SNAPSHOT, status: "running", draftChapters: drafts });
      return Promise.resolve(null);
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(longRecap, { exact: false })).toBeInTheDocument();
    });
    expect(screen.getByText(longQuestion, { exact: false })).toBeInTheDocument();
    expect(screen.getByText("第 2 版 · 已通过校验")).toBeInTheDocument();
    expect(screen.queryByText(/draft-1|chapter_agent|contentVersion/i)).not.toBeInTheDocument();
  });
});
