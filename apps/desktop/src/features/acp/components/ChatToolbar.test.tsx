import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatToolbar } from "./ChatToolbar";

const PROFILES = [
  { id: "codex", name: "Codex（默认）", available: true },
  { id: "claude", name: "Claude", available: false },
];

function renderToolbar(props: Partial<React.ComponentProps<typeof ChatToolbar>> = {}) {
  const callbacks = {
    onSwitchProfile: vi.fn(),
    onQuickNoteOpenChange: vi.fn(),
    onQuickNoteSaved: vi.fn(),
    onNewChat: vi.fn(),
    onOpenHistory: vi.fn(),
    onReconnect: vi.fn(),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (
    <QueryClientProvider client={client}>
      <ChatToolbar
        agentLabel="Codex（默认）"
        connectionState="connected"
        profiles={PROFILES}
        activeProfileId="codex"
        {...callbacks}
        {...props}
      />
    </QueryClientProvider>
  );
  const result = render(ui);
  return { ...callbacks, ...result };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatToolbar", () => {
  it("shows the connection label as text, not just a color dot", () => {
    renderToolbar({ connectionState: "connecting" });
    expect(screen.getByText("连接中")).toBeInTheDocument();
  });

  it("prefers statusError over statusLine", () => {
    renderToolbar({ statusError: "连接失败：超时", statusLine: "回合进行中…" });
    expect(screen.getByText("连接失败：超时")).toBeInTheDocument();
    expect(screen.queryByText("回合进行中…")).not.toBeInTheDocument();
  });

  it("renders long status text in full without truncation", () => {
    const longError = `连接失败：超时${"错".repeat(40)}NoSpaces${"x".repeat(48)}尾`;
    renderToolbar({ statusError: longError });
    expect(screen.getByText(longError, { exact: false })).toBeInTheDocument();
  });

  it("renders a plain label when there is only one profile", () => {
    renderToolbar({ profiles: [PROFILES[0]!], onSwitchProfile: vi.fn() });
    expect(screen.queryByRole("button", { name: "切换 Agent" })).not.toBeInTheDocument();
    expect(screen.getByText("Codex（默认）")).toBeInTheDocument();
  });

  it("switches to another profile exactly once with its id", async () => {
    const user = userEvent.setup();
    const { onSwitchProfile } = renderToolbar({});
    await user.click(screen.getByRole("button", { name: "切换 Agent" }));
    await user.click(await screen.findByRole("menuitem", { name: /Claude/ }));
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
    expect(onSwitchProfile).toHaveBeenCalledWith("claude");
  });

  it("does not call back for the already-active profile", async () => {
    const user = userEvent.setup();
    const { onSwitchProfile } = renderToolbar({});
    await user.click(screen.getByRole("button", { name: "切换 Agent" }));
    await user.click(await screen.findByRole("menuitem", { name: /Codex/ }));
    expect(onSwitchProfile).not.toHaveBeenCalled();
  });

  it("still offers an unavailable profile (availability is a hint, not a gate)", async () => {
    const user = userEvent.setup();
    const { onSwitchProfile } = renderToolbar({});
    await user.click(screen.getByRole("button", { name: "切换 Agent" }));
    const item = await screen.findByRole("menuitem", { name: /Claude/ });
    expect(item).not.toHaveAttribute("disabled");
    await user.click(item);
    expect(onSwitchProfile).toHaveBeenCalledWith("claude");
  });

  it("disables switching while busy without calling back", async () => {
    const user = userEvent.setup();
    const { onSwitchProfile } = renderToolbar({ busy: true });
    expect(screen.getByRole("button", { name: "切换 Agent" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "切换 Agent" }));
    expect(onSwitchProfile).not.toHaveBeenCalled();
  });

  it("wires history/new/reconnect actions with exact counts", () => {
    const { onNewChat, onOpenHistory, onReconnect } = renderToolbar({
      connectionState: "error",
      historyCount: 12,
    });
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    fireEvent.click(screen.getByRole("button", { name: "历史对话" }));
    fireEvent.click(screen.getByRole("button", { name: "重连" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("caps the history badge at 9+ and hides it at zero", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ChatToolbar
          agentLabel="Codex（默认）"
          connectionState="connected"
          historyCount={0}
          onNewChat={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={client}>
        <ChatToolbar
          agentLabel="Codex（默认）"
          connectionState="connected"
          historyCount={9}
          onNewChat={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("shows reconnect only for idle/error states", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ChatToolbar
          agentLabel="Codex（默认）"
          connectionState="connected"
          onNewChat={vi.fn()}
          onReconnect={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "重连" })).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={client}>
        <ChatToolbar
          agentLabel="Codex（默认）"
          connectionState="idle"
          onNewChat={vi.fn()}
          onReconnect={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "重连" })).toBeInTheDocument();
  });

  it("opens and closes the quick note through the real trigger", async () => {
    const user = userEvent.setup();
    const onQuickNoteOpenChange = vi.fn();
    renderToolbar({ onQuickNoteOpenChange });
    const trigger = screen.getByRole("button", { name: "快速写批注" });
    expect(trigger.tagName).toBe("BUTTON");
    await user.click(trigger);
    await waitFor(() => expect(onQuickNoteOpenChange).toHaveBeenCalledWith(true));
  });

  it("disables tool actions while busy", () => {
    renderToolbar({ busy: true, connectionState: "error" });
    expect(screen.getByRole("button", { name: "新建对话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "历史对话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重连" })).toBeDisabled();
  });
});
