import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "../store";
import { StatusLine } from "./StatusLine";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  usePlayerStore.setState({
    status: "Idle",
    statusMessage: "",
    currentFile: null,
    error: null,
  });
});

describe("StatusLine", () => {
  it("shows mapped Chinese status with the store message", () => {
    usePlayerStore.setState({ status: "Playing", statusMessage: "a.mkv" });
    render(<StatusLine />);

    expect(screen.getByText("正在播放 · a.mkv")).toBeInTheDocument();
    expect(screen.queryByText(/Playing/)).not.toBeInTheDocument();
  });

  it("omits the separator when there is no store message", () => {
    usePlayerStore.setState({ status: "Idle", statusMessage: "" });
    render(<StatusLine />);

    expect(screen.getByText("未打开媒体")).toBeInTheDocument();
  });

  it("falls back neutrally for unknown engine values", () => {
    usePlayerStore.setState({ status: "Buffering", statusMessage: "" });
    render(<StatusLine />);

    expect(screen.getByText("状态未知")).toBeInTheDocument();
    expect(screen.queryByText("Buffering")).not.toBeInTheDocument();
  });

  it("renders the error through formatPlayerError without technical details", () => {
    usePlayerStore.setState({
      status: "Error",
      statusMessage: "无法打开该媒体文件",
      error: {
        code: "LoadError",
        message: "无法打开该媒体文件",
        details: "ffprobe exit 1: /tmp/x.mkv",
      },
    });
    render(<StatusLine />);

    // statusMessage mirrors the error text: shown once, on the error line.
    expect(screen.getByText("播放失败")).toBeInTheDocument();
    expect(screen.getAllByText("无法打开该媒体文件")).toHaveLength(1);
    expect(screen.queryByText(/ffprobe/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LoadError/)).not.toBeInTheDocument();
  });

  it("keeps a differing store message alongside the error line", () => {
    usePlayerStore.setState({
      status: "Error",
      statusMessage: "重试第 2 次后仍失败",
      error: { code: "LoadError", message: "无法打开该媒体文件" },
    });
    render(<StatusLine />);

    expect(
      screen.getByText("播放失败 · 重试第 2 次后仍失败"),
    ).toBeInTheDocument();
    expect(screen.getByText("无法打开该媒体文件")).toBeInTheDocument();
  });

  it("shows 已停止 after the real stop chain, not 未打开媒体", async () => {
    // Production chain: Rust player_stop returns Idle while keeping the
    // file; the store applies that snapshot, then writes 已停止.
    usePlayerStore.setState({
      status: "Playing",
      statusMessage: "D:/媒体/a.mkv",
      currentFile: "D:/媒体/a.mkv",
      error: null,
    });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "player_stop") {
        return Promise.resolve({
          status: "Idle",
          currentTimeMs: 0,
          durationMs: 0,
          volume: 100,
          rate: 1,
          currentFile: "D:/媒体/a.mkv",
          mediaId: null,
          sourceKind: "local",
          playbackFormatId: null,
          durationHintMs: null,
          error: null,
        });
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
    });

    await usePlayerStore.getState().stop();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("player_stop");
    expect(usePlayerStore.getState().status).toBe("Idle");
    expect(usePlayerStore.getState().currentFile).toBe("D:/媒体/a.mkv");

    render(<StatusLine />);
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.queryByText("未打开媒体")).not.toBeInTheDocument();
    expect(screen.queryByText(/Idle/)).not.toBeInTheDocument();
  });

  it("still shows 未打开媒体 for initial Idle with no file", () => {
    usePlayerStore.setState({
      status: "Idle",
      statusMessage: "",
      currentFile: null,
      error: null,
    });
    render(<StatusLine />);

    expect(screen.getByText("未打开媒体")).toBeInTheDocument();
    expect(screen.queryByText("已停止")).not.toBeInTheDocument();
  });

  it("exposes status and error through live regions without nesting", () => {
    const { rerender } = render(<StatusLine />);
    const statusNode = screen.getByRole("status");
    expect(statusNode.textContent).toMatch(/未打开媒体/);

    // Idle -> Playing: same live node updates, no focus move, no new region.
    usePlayerStore.setState({
      status: "Playing",
      statusMessage: "D:/媒体/a.mkv",
      currentFile: "D:/媒体/a.mkv",
      error: null,
    });
    rerender(<StatusLine />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toMatch(/正在播放/);
    expect(document.activeElement?.getAttribute("role")).not.toBe("status");

    // Failure: error line is its own alert, not nested inside status.
    usePlayerStore.setState({
      status: "Error",
      statusMessage: "无法打开该媒体文件",
      currentFile: "D:/媒体/a.mkv",
      error: {
        code: "LoadError",
        message: "无法打开该媒体文件",
        details: "ffprobe exit 1",
      },
    });
    rerender(<StatusLine />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("无法打开该媒体文件");
    expect(alert.closest('[role="status"]')).toBeNull();
    expect(screen.queryByText(/ffprobe/)).not.toBeInTheDocument();
  });
});
