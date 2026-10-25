import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatUiStore } from "@dawnsight/chat-ui/chatUiStore";
import { TooltipProvider } from "@dawnsight/ui/tooltip";
import { useUiStore } from "@/features/player";

import { AppShell } from "./AppShell";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/system", () => ({
  getStartupNotice: vi.fn(async () => null),
  revealLogDir: vi.fn(),
}));

import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  useChatUiStore.setState({
    chatMounted: false,
    chatOpen: false,
    acpResponding: false,
  });
  useUiStore.setState({
    aboutOpen: false,
  });
});

describe("AboutDialog", () => {
  it("renders the branded application title bar", () => {
    vi.mocked(getVersion).mockResolvedValue("0.3.0");
    render(
      <TooltipProvider>
        <AppShell>
          <div />
        </AppShell>
      </TooltipProvider>,
    );

    expect(screen.getByRole("banner", { name: "应用标题栏" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Dawnsight" })).toBeInTheDocument();
    expect(screen.getByText("AI Video Reader")).toBeInTheDocument();
  });

  it("shows the runtime version in the about dialog", async () => {
    vi.mocked(getVersion).mockResolvedValue("0.3.0");
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AppShell>
          <div />
        </AppShell>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("menuitem", { name: "关于 Dawnsight" }));
    await waitFor(() => {
      expect(screen.getByText("版本 0.3.0")).toBeInTheDocument();
    });
  });

  it("opens the github repo page from the about dialog", async () => {
    vi.mocked(getVersion).mockResolvedValue("0.4.0");
    vi.mocked(openUrl).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AppShell>
          <div />
        </AppShell>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("menuitem", { name: "关于 Dawnsight" }));
    await user.click(await screen.findByRole("button", { name: "GitHub 仓库" }));
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/yitom486/dawnsight",
    );
  });

  it("opens the release page from the about dialog", async () => {
    vi.mocked(getVersion).mockResolvedValue("0.3.0");
    vi.mocked(openUrl).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AppShell>
          <div />
        </AppShell>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("menuitem", { name: "关于 Dawnsight" }));
    await user.click(await screen.findByRole("button", { name: "下载更新" }));
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/yitom486/dawnsight/releases",
    );
  });

  it("closes the about dialog when clicking 知道了 or close button", async () => {
    vi.mocked(getVersion).mockResolvedValue("0.3.0");
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AppShell>
          <div />
        </AppShell>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("menuitem", { name: "关于 Dawnsight" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(useUiStore.getState().aboutOpen).toBe(true);

    await user.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(useUiStore.getState().aboutOpen).toBe(false);
  });
});

describe("AppShell AI entry", () => {
  it("toggles the AI sibling entry without changing the ordinary workspace content", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AppShell>
          <div data-testid="ordinary-workspace" />
        </AppShell>
      </TooltipProvider>,
    );

    expect(screen.getByTestId("ordinary-workspace")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "打开 AI 对话" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("ordinary-workspace")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起 AI 对话" }));
    expect(screen.getByRole("button", { name: "打开 AI 对话" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

it.todo("switches between WorkspacePanelFrame and ChatDock siblings with inert focus isolation");
