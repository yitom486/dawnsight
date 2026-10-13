import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useUiStore } from "@/features/player/uiStore";

import { PlaybackInterfaceSettingsPanel } from "./PlaybackInterfaceSettingsPanel";

const { invoke, windowSetFullscreen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  windowSetFullscreen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: windowSetFullscreen,
  }),
}));

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlaybackInterfaceSettingsPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "player_list_playback_formats")
      return Promise.resolve({
        formats: [
          { formatId: "hd", label: "1080p 高清" },
          { formatId: "uhd", label: "4K 超高清" },
        ],
        currentFormatId: "hd",
      });
    return Promise.resolve(null);
  });
  windowSetFullscreen.mockReset();
  windowSetFullscreen.mockResolvedValue(undefined);
  usePlayerStore.setState({
    currentFile: null,
    sourceKind: null,
    status: "Idle",
    busy: false,
    playbackFormatId: null,
  } as never);
  useUiStore.setState({ fullscreen: false } as never);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PlaybackInterfaceSettingsPanel", () => {
  it.each([
    "https:example.com/watch?token=PRIVATE_QUERY#PRIVATE_FRAGMENT",
    "  https://PRIVATE_USER:PRIVATE_PASS@example.com/watch?token=PRIVATE_QUERY",
  ])("hides URL signatures before sourceKind synchronizes: %s", (url) => {
    usePlayerStore.setState({ currentFile: url, sourceKind: null });
    const { container } = renderPanel();
    expect(screen.getByText("当前媒体：example.com")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/PRIVATE_QUERY|PRIVATE_FRAGMENT|PRIVATE_USER|PRIVATE_PASS/);
  });
  it("renders a single category title without duplicating the frame heading", () => {
    renderPanel();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("当前媒体：未打开")).toBeInTheDocument();
  });

  it("reflects the real fullscreen store state on the switch", () => {
    useUiStore.setState({ fullscreen: true } as never);
    renderPanel();
    expect(screen.getByRole("switch", { name: "全屏播放" })).toBeChecked();
  });

  it("calls setFullscreen with the accurate boolean on keyboard toggle", async () => {
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "全屏播放" });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: " ", code: "Space" });
    fireEvent.keyUp(toggle, { key: " ", code: "Space" });
    await waitFor(() => {
      expect(windowSetFullscreen).toHaveBeenCalledTimes(1);
    });
    expect(windowSetFullscreen).toHaveBeenCalledWith(true);
  });

  it("renders a long local path in full", () => {
    const longPath = `D:/媒体/超长本地路径不断尾LocalPathWithoutSpaces${"径".repeat(40)}尾.mkv`;
    usePlayerStore.setState({ currentFile: longPath, sourceKind: "local" } as never);
    renderPanel();
    expect(screen.getByText(longPath, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("清晰度")).not.toBeInTheDocument();
  });

  it("shows only the hostname for a signed remote URL", () => {
    usePlayerStore.setState({
      currentFile:
        "https://user:pass@video.example.com:8443/watch/abc?token=secret123&sig=abcdef#frag",
      sourceKind: "remote",
    } as never);
    const { container } = renderPanel();
    expect(screen.getByText("video.example.com", { exact: false })).toBeInTheDocument();
    const dom = container.ownerDocument.documentElement.innerHTML;
    expect(dom).not.toContain("token=secret123");
    expect(dom).not.toContain("sig=abcdef");
    expect(dom).not.toContain("#frag");
    expect(dom).not.toContain("user:pass");
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const attr of ["title", "aria-label"]) {
        expect(el.getAttribute(attr) ?? "").not.toContain("secret123");
      }
    }
  });

  it("falls back to a fixed label for an illegal remote URL", () => {
    usePlayerStore.setState({ currentFile: "http://[::1", sourceKind: "remote" } as never);
    const { container } = renderPanel();
    expect(screen.getByText("当前媒体：在线视频")).toBeInTheDocument();
    expect(container.ownerDocument.documentElement.innerHTML).not.toContain("http://[::1");
  });

  it("treats an http string as remote even before sourceKind syncs", () => {
    usePlayerStore.setState({
      currentFile: "https://www.example.com/watch?v=x&sig=y",
      sourceKind: null,
    } as never);
    const { container } = renderPanel();
    expect(screen.getByText("example.com", { exact: false })).toBeInTheDocument();
    expect(container.ownerDocument.documentElement.innerHTML).not.toContain("sig=y");
  });

  it("offers real formats when remote and disables the picker while busy", async () => {
    usePlayerStore.setState({
      currentFile: "https://www.example.com/watch?v=x",
      sourceKind: "remote",
      busy: true,
    } as never);
    renderPanel();
    const picker = await screen.findByRole("combobox", { name: "选择清晰度" });
    expect(picker).toBeDisabled();
    expect(invoke).toHaveBeenCalledWith("player_list_playback_formats");
  });

  it("renders nothing for quality when formats are unavailable", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "player_list_playback_formats")
        return Promise.resolve({ formats: [], currentFormatId: null });
      return Promise.resolve(null);
    });
    usePlayerStore.setState({
      currentFile: "https://www.example.com/watch?v=x",
      sourceKind: "remote",
    } as never);
    renderPanel();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("player_list_playback_formats");
    });
    expect(screen.queryByRole("combobox", { name: "选择清晰度" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "在线视频清晰度" })).toBeInTheDocument();
  });

  it("issues no format query when not remote", async () => {
    usePlayerStore.setState({ currentFile: "D:/a.mkv", sourceKind: "local" } as never);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/D:\/a\.mkv/)).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("player_list_playback_formats");
  });
});
