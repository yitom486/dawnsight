import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatUiStore } from "@dawnsight/chat-ui/chatUiStore";
import { ChatDock } from "@/features/acp/components/ChatDock";
import { usePlayerStore } from "@/features/player";
import { useTrackStore } from "@/features/player/trackStore";
import { QuickNoteDialog } from "./QuickNoteDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
// Retain the real dock and quick-note wiring without starting an ACP session.
vi.mock("@/features/acp/components/AcpPanel", () => ({ AcpPanel: () => <QuickNoteHarness /> }));

function QuickNoteHarness() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div ref={anchorRef}>
        <button ref={triggerRef} onClick={() => setOpen(true)}>写批注</button>
      </div>
      <QuickNoteDialog open={open} onOpenChange={setOpen} anchorRef={anchorRef} triggerRef={triggerRef} />
      <input aria-label="其他控件" onKeyDown={(event) => {
        if (event.key === "Escape") event.preventDefault();
      }} />
    </div>
  );
}

beforeEach(() => {
  useChatUiStore.setState({ chatMounted: true, chatOpen: true });
  usePlayerStore.setState({ currentFile: "C:/video.mp4" });
  useTrackStore.setState({ subtitleChoiceId: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ChatDock /></QueryClientProvider>);
  fireEvent.click(screen.getByText("写批注"));
});

afterEach(() => {
  cleanup();
  useChatUiStore.setState({ chatMounted: false, chatOpen: false });
  vi.clearAllMocks();
});

describe("QuickNote and ChatDock Escape ownership", () => {
  it.each(["trigger", "panel"])("closes only the quick note from %s", (origin) => {
    const trigger = screen.getByText("写批注");
    const target = origin === "trigger" ? trigger : screen.getByRole("dialog");
    target.focus();
    fireEvent.keyDown(target, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useChatUiStore.getState().chatOpen).toBe(true);
    expect(document.activeElement).toBe(trigger);
    // With the quick note closed, the dock's normal Escape behavior remains.
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(useChatUiStore.getState().chatOpen).toBe(false);
  });

  it.each(["composing", "229", "handled"])("preserves both layers and the draft for %s Escape", (kind) => {
    const box = screen.getByPlaceholderText("记录此刻的观感或要点…");
    fireEvent.change(box, { target: { value: "正在输入的草稿" } });
    box.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
      isComposing: kind === "composing", keyCode: kind === "229" ? 229 : 27,
    });
    if (kind === "handled") event.preventDefault();
    fireEvent(box, event);
    expect(useChatUiStore.getState().chatOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(box).toHaveValue("正在输入的草稿");
    expect(document.activeElement).toBe(box);
  });

  it("respects an external control's handled Escape", () => {
    const outside = screen.getByRole("textbox", { name: "其他控件" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(useChatUiStore.getState().chatOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(outside);
  });

  it("does not let an inert quick note steal the next Escape", () => {
    act(() => useChatUiStore.getState().closeChat());
    const dialog = screen.getByRole("dialog", { hidden: true });
    fireEvent.keyDown(dialog, { key: "Escape" });
    act(() => useChatUiStore.getState().openChat());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
