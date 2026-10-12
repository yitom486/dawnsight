import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/features/player";
import { useUiStore } from "@/features/player/uiStore";

import App from "./App";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.0.0-test"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    isFullscreen: vi.fn(async () => false),
    onResized: vi.fn(async () => () => undefined),
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "player_get_state") {
      return {
        status: "Idle",
        currentTimeMs: 0,
        durationMs: 0,
        volume: 100,
        rate: 1,
        currentFile: null,
        error: null,
      };
    }
    return null;
  }),
  Channel: vi.fn().mockImplementation(() => ({ onmessage: null })),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

vi.mock("@/lib/system", () => ({
  getStartupNotice: vi.fn(async () => null),
  revealLogDir: vi.fn(async () => undefined),
}));

import { invoke } from "@tauri-apps/api/core";

function cachedResolveCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "ytdl_cached_resolve");
}

function acpCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => String(cmd).startsWith("acp_"));
}

function resetStores() {
  usePlayerStore.setState({
    currentFile: null,
    sourceKind: "local",
    status: "Idle",
    statusMessage: "",
    error: null,
    busy: false,
  });
  useUiStore.setState({ sidebarTab: "transcript", fullscreen: false });
  localStorage.clear();
}

// NOTE: the tree mounts exactly once for the whole file. Full unmount would
// run a production effect cleanup that calls import.meta.hot.off, which the
// vitest SSR runtime does not provide (production hooks are out of scope and
// stay untouched). Store resets in beforeEach keep the tests independent.
beforeAll(() => {
  resetStores();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
});

beforeEach(() => {
  resetStores();
});

describe("App online media mount", () => {
  it("opens the online workspace from the rail without queries or agents", async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "在线媒体" }));
    expect(
      await screen.findByText("尚未打开在线媒体。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "在线媒体" }),
    ).toHaveAttribute("aria-current", "page");
    // No media: the mount itself must not fire cached-resolve queries or
    // spawn any agent session.
    expect(cachedResolveCalls()).toHaveLength(0);
    expect(acpCalls()).toHaveLength(0);
  });

  it("routes to the existing online settings category and back", async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "在线媒体" }));
    await screen.findByText("尚未打开在线媒体。");
    await user.click(
      screen.getByRole("button", { name: "打开在线资源设置" }),
    );

    // Settings replaces the player workspace; online is the single mount.
    // The native surface stays mounted inside a hidden host (deterministic
    // 0x0 HWND rect) while the reading panel is gone.
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("https://www.youtube.com/watch?v=…"),
      ).toBeInTheDocument();
    });
    const surface = screen.getByLabelText("Native video surface");
    expect(surface.closest("div.hidden")).not.toBeNull();
    expect(cachedResolveCalls()).toHaveLength(0);
    expect(acpCalls()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "在线媒体" }));
    expect(
      await screen.findByText("尚未打开在线媒体。"),
    ).toBeInTheDocument();
  });

  it("keeps chat and sidebar mutually exclusive on the new tab", async () => {
    const user = userEvent.setup();
    const { useChatUiStore } = await import(
      "@dawnsight/chat-ui/chatUiStore"
    );
    useChatUiStore.setState({ chatOpen: false });

    const rail = screen.getByRole("navigation", { name: "工作区导航" });
    await user.click(within(rail).getByRole("button", { name: "打开 AI 对话" }));
    expect(useChatUiStore.getState().chatOpen).toBe(true);

    await user.click(within(rail).getByRole("button", { name: "在线媒体" }));
    expect(useChatUiStore.getState().chatOpen).toBe(false);
    expect(
      await screen.findByText("尚未打开在线媒体。"),
    ).toBeInTheDocument();
  });
});
