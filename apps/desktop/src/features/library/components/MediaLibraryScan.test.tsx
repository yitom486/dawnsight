import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useLibrarySettingsStore } from "../settingsStore";
import { LibrarySettingsPanel } from "./LibrarySettingsPanel";

const channels: { onmessage: ((event: unknown) => void) | null }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn().mockImplementation(function (this: unknown) {
    channels.push(this as { onmessage: ((event: unknown) => void) | null });
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const LONG_ROOT = `D:/媒体/超长目录路径不断尾VeryLongRootPathWithoutSpaces${"径".repeat(32)}尾`;

const IDLE_STATUS = {
  running: false,
  roots: [],
  pollIntervalSecs: 30,
  lastScanAtMs: null,
  lastScanError: null,
  indexedFiles: 0,
  pendingGroups: 0,
};

function mockBackend(
  overrides: Record<string, (cmd: string, args?: unknown) => Promise<unknown>> = {},
) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](cmd, args);
    if (cmd === "library_status") return Promise.resolve({ ...IDLE_STATUS });
    if (cmd === "library_credential_status")
      return Promise.resolve({ modelApiKeySaved: false, tmdbAccessTokenSaved: false });
    return Promise.resolve(null);
  });
}

function renderPanel(onClient?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onClient?.(client);
  return render(
    <QueryClientProvider client={client}>
      <LibrarySettingsPanel />
    </QueryClientProvider>,
  );
}

const watchCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_watch_start");

beforeEach(() => {
  channels.length = 0;
  mockBackend();
  vi.mocked(open).mockResolvedValue(null);
  usePlayerStore.setState({
    currentFile: null,
    status: "Idle",
  } as never);
  useLibrarySettingsStore.setState({
    roots: [],
    rootsFollowPlayback: true,
    pollIntervalSecs: 30,
    privacyAcknowledged: false,
    resolverProvider: "directApi",
    agentProfileId: "",
    agentModelId: "",
    agentReasoningEffort: "",
    modelBaseUrl: "",
    modelId: "",
    tmdbLanguage: "zh-CN",
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("MediaLibraryPanel scan area", () => {
  it("shows a pending status until the library query resolves", async () => {
    mockBackend({ library_status: () => new Promise(() => {}) });
    renderPanel();
    expect(await screen.findByText("正在读取状态…")).toBeInTheDocument();
    expect(screen.queryByText("未启动", { exact: true })).not.toBeInTheDocument();
  });

  it("shows an honest status-query failure without starting any scan", async () => {
    mockBackend({ library_status: () => Promise.reject(new TypeError("PRIVATE_STATUS_FAILURE")) });
    renderPanel();
    expect(await screen.findByText("状态未知")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败，请重试");
    expect(screen.queryByText("未启动", { exact: true })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("PRIVATE_STATUS_FAILURE");
    expect(watchCalls()).toHaveLength(0);
  });

  it("keeps the last trusted running status when a refresh fails", async () => {
    let client!: QueryClient;
    let fail = false;
    mockBackend({
      library_status: () => fail ? Promise.reject(new TypeError("PRIVATE_REFRESH_FAILURE")) : Promise.resolve({ ...IDLE_STATUS, running: true, roots: ["D:/媒体"] }),
      library_pending_groups: () => Promise.resolve([]),
      library_groups: () => Promise.resolve([]),
    });
    renderPanel((value) => { client = value; });
    await screen.findByText("运行中", { exact: true });
    fail = true;
    await act(async () => { await client.refetchQueries({ predicate: (query) => query.queryKey[0] === "library-status" }); });
    expect(screen.getByText("运行中", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
    expect(screen.queryByText("状态未知")).not.toBeInTheDocument();
  });

  it("handles a directory-picker rejection and still allows a successful retry", async () => {
    vi.mocked(open).mockRejectedValueOnce(new TypeError("PRIVATE_DIALOG_FAILURE")).mockResolvedValueOnce("D:/重试目录");
    renderPanel();
    const picker = await screen.findByRole("button", { name: "选择目录" });
    fireEvent.click(picker);
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败，请重试");
    expect(document.body.textContent).not.toContain("PRIVATE_DIALOG_FAILURE");
    expect(useLibrarySettingsStore.getState().roots).toEqual([]);
    expect(watchCalls()).toHaveLength(0);
    fireEvent.click(picker);
    await waitFor(() => expect(useLibrarySettingsStore.getState().roots).toEqual(["D:/重试目录"]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("renders a long root directory in full", async () => {
    useLibrarySettingsStore.setState({ roots: [LONG_ROOT] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(LONG_ROOT, { exact: false })).toBeInTheDocument();
    });
  });

  it("writes nothing when the directory dialog is cancelled", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "选择目录" }));
    await waitFor(() => {
      expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(useLibrarySettingsStore.getState().roots).toEqual([]);
    expect(
      useLibrarySettingsStore.getState().rootsFollowPlayback,
    ).toBe(true);
    expect(watchCalls()).toHaveLength(0);
  });

  it("pins the chosen directory and stops following playback", async () => {
    vi.mocked(open).mockResolvedValue(["D:/新媒体", "E:/更多"]);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "选择目录" }));
    await waitFor(() => {
      expect(useLibrarySettingsStore.getState().roots).toEqual([
        "D:/新媒体",
        "E:/更多",
      ]);
    });
    expect(
      useLibrarySettingsStore.getState().rootsFollowPlayback,
    ).toBe(false);
  });

  it("gates follow-playback on a playable path and restores following", async () => {
    useLibrarySettingsStore.setState({
      roots: [],
      rootsFollowPlayback: false,
    });
    renderPanel();
    expect(
      await screen.findByRole("button", { name: "跟随播放目录" }),
    ).toBeDisabled();
    usePlayerStore.setState({ currentFile: "D:\\v\\a.mkv" } as never);
    const follow = await screen.findByRole("button", { name: "跟随播放目录" });
    await waitFor(() => {
      expect(follow).toBeEnabled();
    });
    fireEvent.click(follow);
    await waitFor(() => {
      expect(
        useLibrarySettingsStore.getState().rootsFollowPlayback,
      ).toBe(true);
    });
  });

  it("starts the watch once with roots and interval, ignoring busy repeats", async () => {
    useLibrarySettingsStore.setState({ roots: ["D:/媒体"] });
    mockBackend({
      library_watch_start: () =>
        new Promise(() => {
          /* stays pending: keeps the start mutation busy */
        }),
    });
    renderPanel();
    const start = await screen.findByRole("button", { name: "启动扫描" });
    fireEvent.click(start);
    await waitFor(() => {
      expect(watchCalls()).toHaveLength(1);
    });
    expect(watchCalls()[0]?.[1]).toEqual({
      config: { roots: ["D:/媒体"], pollIntervalSecs: 30 },
      onEvent: expect.anything(),
    });
    fireEvent.click(screen.getByRole("button", { name: "正在扫描" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(watchCalls()).toHaveLength(1);
  });

  it("drives progress, failure and completion through the real Channel seam", async () => {
    useLibrarySettingsStore.setState({ roots: ["D:/媒体"] });
    mockBackend({
      library_watch_start: () => Promise.resolve({ ...IDLE_STATUS, running: true }),
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "启动扫描" }));
    await waitFor(() => {
      expect(watchCalls()).toHaveLength(1);
    });
    const channel = channels[channels.length - 1];
    expect(channel).toBeDefined();
    await act(async () => {
      channel?.onmessage?.({
        type: "Progress",
        payload: { rootsCompleted: 1, rootCount: 2, indexedFiles: 5 },
      });
    });
    expect(await screen.findByText(/目录进度：1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/已发现 5 个视频文件/)).toBeInTheDocument();
    await act(async () => {
      channel?.onmessage?.({
        type: "Failed",
        payload: { code: "ScanFailed", message: "演示扫描失败原因" },
      });
    });
    expect(await screen.findByText(/演示扫描失败原因/)).toBeInTheDocument();    await act(async () => {
      channel?.onmessage?.({ type: "Failed", payload: { code: "ScanFailed", message: "PRIVATE_STDERR", details: "PRIVATE_DETAILS" } });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("媒体目录扫描失败，请重试");
    expect(document.body.textContent).not.toMatch(/PRIVATE_STDERR|PRIVATE_DETAILS/);
    await act(async () => {
      channel?.onmessage?.({
        type: "Finished",
        payload: { indexedFiles: 9, pendingGroups: 2 },
      });
    });
    expect(
      await screen.findByText(/首次扫描完成：已索引 9 个文件/),
    ).toBeInTheDocument();
  });

  it("stops the running watch exactly once", async () => {
    mockBackend({
      library_status: () =>
        Promise.resolve({ ...IDLE_STATUS, running: true, roots: ["D:/媒体"] }),
      library_watch_stop: () => Promise.resolve({ ...IDLE_STATUS, running: false }),
      library_pending_groups: () => Promise.resolve([]),
      library_groups: () => Promise.resolve([]),
    });
    renderPanel();
    const stop = await screen.findByRole("button", { name: "停止" });
    await waitFor(() => {
      expect(stop).toBeEnabled();
    });
    fireEvent.click(stop);
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_watch_stop"),
      ).toHaveLength(1);
    });
  });

  it("clamps the scan interval to a minimum of five seconds", async () => {
    renderPanel();
    const input = (await screen.findByLabelText(
      "扫描周期（秒）",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    await waitFor(() => {
      expect(useLibrarySettingsStore.getState().pollIntervalSecs).toBe(5);
    });
    fireEvent.change(input, { target: { value: "120" } });
    await waitFor(() => {
      expect(useLibrarySettingsStore.getState().pollIntervalSecs).toBe(120);
    });
  });

  it("maps the persisted scan error to business copy and retries once", async () => {
    mockBackend({
      library_status: () =>
        Promise.resolve({
          ...IDLE_STATUS,
          roots: ["D:/媒体"],
          lastScanError: { code: "ScanFailed", message: "演示用扫描失败原因：目录不可读。" },
        }),
      library_scan_now: () => Promise.resolve([]),
    });
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByText(/演示用扫描失败原因：目录不可读/),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "立即重试" }));
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "library_scan_now"),
      ).toHaveLength(1);
    });
  });
});
