import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";

import { MediaInfoPanel } from "./MediaInfoPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const probeMissing = {
  code: "ProbeNotFound",
  message: "媒体分析组件未就绪",
  details: "place ffprobe.exe under native/ffmpeg/",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MediaInfoPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "media_inspect") return Promise.reject(probeMissing);
    if (cmd === "media_tool_status")
      return Promise.resolve({
        available: false,
        message: "媒体分析组件未就绪",
        hint: "安装包通常自带该组件；仍缺失时请重装应用。",
      });
    return Promise.resolve(null);
  });
  usePlayerStore.setState({
    currentFile: "C:\\videos\\a.mp4",
    status: "Paused",
    sourceKind: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("MediaInfoPanel", () => {
  it("shows business message plus install hint when ffprobe is missing", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("媒体分析组件未就绪")).toBeInTheDocument();
    });
    expect(
      await screen.findByText("安装包通常自带该组件；仍缺失时请重装应用。"),
    ).toBeInTheDocument();
  });

  it("never surfaces code enum or tool details", async () => {
    const { container } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText("媒体分析组件未就绪")).toBeInTheDocument();
    });
    expect(container.textContent).not.toContain("ProbeNotFound");
    expect(container.textContent).not.toContain("ffprobe");
  });

  it("distinguishes opening from idle without a query", () => {
    usePlayerStore.setState({
      currentFile: "C:\\videos\\a.mp4",
      status: "Loading",
      sourceKind: null,
    });
    renderPanel();
    expect(screen.getByText("正在打开媒体…")).toBeInTheDocument();
  });
});

describe("MediaInfoPanel presentation", () => {
  const LOCAL = "C:\\videos\\a.mp4";
  const SIGNED =
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx&sig=ABC123.xyz";

  function mockInspect(info: unknown) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "media_inspect") return Promise.resolve(info);
      if (cmd === "media_tool_status")
        return Promise.resolve({ available: true });
      return Promise.resolve(null);
    });
  }

  it("falls back neutrally for missing format, size and codec", async () => {
    mockInspect({
      path: LOCAL,
      formatName: null,
      formatLongName: null,
      durationMs: null,
      bitRate: null,
      streams: [
        { index: 0, kind: "Video", codecName: null, width: null, height: null },
        { index: 1, kind: "Audio", codecName: null, language: null },
      ],
      chapters: [],
    });
    usePlayerStore.setState({
      currentFile: LOCAL,
      status: "Paused",
      sourceKind: null,
    });
    const { container } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText("未知格式")).toBeInTheDocument();
    });

    expect(screen.getByText("视频：未知尺寸 · 未知编码")).toBeInTheDocument();
    expect(screen.getByText("音频：未知编码")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/unknown|video · \?|audio/);
  });

  it("names non-audiovisual kinds without backend enums", async () => {
    mockInspect({
      path: LOCAL,
      formatName: "matroska",
      durationMs: 60_000,
      streams: [
        { index: 0, kind: "Subtitle", codecName: null, language: null },
        { index: 1, kind: "Attachment", codecName: "ttf", language: null },
      ],
      chapters: [],
    });
    usePlayerStore.setState({
      currentFile: LOCAL,
      status: "Paused",
      sourceKind: null,
    });
    renderPanel();

    // Video/audio rows stay absent; nothing renders raw kind enums.
    await waitFor(() => {
      expect(screen.getByText("matroska · 1:00")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Subtitle|Attachment/)).not.toBeInTheDocument();
  });

  it("shows only the host identity for remote media", async () => {
    usePlayerStore.setState({
      currentFile: SIGNED,
      status: "Paused",
      sourceKind: "remote",
    });
    const { container } = renderPanel();
    await waitFor(() => {
      expect(screen.getByText("在线视频 · youtube.com")).toBeInTheDocument();
    });

    expect(container.textContent).not.toContain("sig=ABC123");
    expect(container.textContent).not.toContain("list=PLxxx");
    expect(container.textContent).not.toContain("dQw4w9WgXcQ");
  });

  it("falls back neutrally for unparsable remote URLs", async () => {
    usePlayerStore.setState({
      currentFile: "ht!tp:://bad url %%",
      status: "Paused",
      sourceKind: "remote",
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("在线视频 · 在线")).toBeInTheDocument();
    });
  });

  it("never probes remote media", async () => {
    usePlayerStore.setState({
      currentFile: SIGNED,
      status: "Paused",
      sourceKind: "remote",
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("在线视频 · youtube.com")).toBeInTheDocument();
    });

    expect(
      vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "media_inspect"),
    ).toHaveLength(0);
  });

  it("announces probe errors through a live region", async () => {
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("媒体分析组件未就绪");
  });
});
