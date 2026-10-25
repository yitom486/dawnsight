import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcpRuntimeProvider } from "@dawnsight/chat-ui/runtime/AcpRuntimeProvider";
import type { ChatTurn } from "../types";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatThread, type ChatBusinessSlots } from "@dawnsight/chat-ui/components/assistant-ui/ChatThread";

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let clock = 0;
const slots: ChatBusinessSlots = {
  renderMarkdown: (text, options) => (
    <div data-testid="prose" data-streaming={options?.streaming}>{text}</div>
  ),
};
const noop = () => {};
function turn(answer: string, status: ChatTurn["status"] = "streaming", id = "live"): ChatTurn {
  return { id, answer, status, userText: "Question", activities: [], showActivities: false };
}
function Harness({ value, businessSlots = slots }: { value: ChatTurn; businessSlots?: ChatBusinessSlots }) {
  return (
    <AcpRuntimeProvider turns={[value]} busy={value.status === "streaming"}
      isDisabled={false} thinkingLevel="hidden" onSendText={noop} onCancelRun={noop}>
      <ChatThread composer={null} components={businessSlots} />
    </AcpRuntimeProvider>
  );
}
function paint(ms = 16) {
  act(() => {
    clock += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(clock);
  });
}
function prose() { return screen.queryByTestId("prose")?.textContent ?? ""; }

beforeEach(() => {
  frames.clear();
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("assistant-ui smooth prose integration", () => {
  it("paces bursts, keeps rendered prefixes intact, and flushes full text on completion", () => {
    const first = "中文流式输出，".repeat(12);
    const view = render(<Harness value={turn(first)} />);
    expect(prose()).toBe("");
    paint();
    expect(prose().length).toBeGreaterThan(0);
    expect(prose().length).toBeLessThan(first.length);
    expect(first.startsWith(prose())).toBe(true);
    const before = prose();
    paint();
    expect(prose()).toBe(before); // 32ms commit limit avoids a parse on every frame.
    const full = first + "尾部完整。";
    view.rerender(<Harness value={turn(full)} />);
    paint(48);
    expect(prose().length).toBeGreaterThan(before.length);
    expect(full.startsWith(prose())).toBe(true);
    view.rerender(<Harness value={turn(full, "done")} />);
    expect(prose()).toBe(full);
    expect(screen.getByTestId("prose")).toHaveAttribute("data-streaming", "false");
    paint(500);
    expect(prose()).toBe(full);
  });

  it("finishes through the real Markdown renderer without losing headings or fenced code", () => {
    const markdownSlots: ChatBusinessSlots = {
      renderMarkdown: (content, options) => <ChatMarkdown content={content} streaming={options?.streaming} />,
    };
    const partial = "## Answer\n\nPartial text\n\n```text\nopen";
    const view = render(<Harness value={turn(partial)} businessSlots={markdownSlots} />);
    paint(48);
    const full = partial + " code\n```\n\nFinal paragraph.";
    view.rerender(<Harness value={turn(full, "done")} businessSlots={markdownSlots} />);
    expect(screen.getByRole("heading", { name: "Answer" })).toBeInTheDocument();
    expect(screen.getByText("open code")).toBeInTheDocument();
    expect(screen.getByText("Final paragraph.")).toBeInTheDocument();
  });

  it("resets replaced streaming text without revealing the old prefix", () => {
    const view = render(<Harness value={turn("Old text ".repeat(20))} />);
    paint(48);
    view.rerender(<Harness value={turn("Revised answer ".repeat(20))} />);
    paint(48);
    expect(prose()).not.toContain("Old");
    expect("Revised answer ".repeat(20).startsWith(prose())).toBe(true);
  });

  it("renders completed history and errors immediately", () => {
    const view = render(<Harness value={turn("History text", "done")} />);
    expect(prose()).toBe("History text");
    view.rerender(<Harness value={turn("回复暂时不可用，请重试。", "error")} />);
    expect(screen.getByText("回复暂时不可用，请重试。")).toBeInTheDocument();
    expect(prose()).toBe("");
  });

  it("keeps partial structured output behind an immediate business placeholder", () => {
    render(<Harness value={turn('{"contract":"chapter_recap.v1","recap":"pending')} />);
    expect(prose()).toBe("正在整理结构化结果…");
    expect(document.body.textContent).not.toContain("chapter_recap.v1");
  });

  it("bypasses pacing under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
      media, matches: media === "(prefers-reduced-motion: reduce)", onchange: null,
      addListener: noop, removeListener: noop, addEventListener: noop,
      removeEventListener: noop, dispatchEvent: () => true,
    }));
    const full = "立即展示完整文本。";
    render(<Harness value={turn(full)} />);
    expect(prose()).toBe(full);
  });

  it("never paints a dangling emoji surrogate during reveal", () => {
    const full = "😀中文".repeat(10);
    render(<Harness value={turn(full)} />);
    for (let i = 0; i < 20; i++) {
      paint(17);
      expect(prose()).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(full.startsWith(prose())).toBe(true);
    }
  });

  it("replaces the message without old text and cancels pending frames on unmount", () => {
    const view = render(<Harness value={turn("Old text ".repeat(30))} />);
    paint();
    expect(prose().length).toBeGreaterThan(0);
    view.rerender(<Harness value={turn("New history", "done", "other-session")} />);
    expect(prose()).toBe("New history");
    paint(100);
    expect(prose()).toBe("New history");
    view.rerender(<Harness value={turn("Next output ".repeat(30), "streaming", "new-live")} />);
    expect(frames.size).toBeGreaterThan(0);
    view.unmount();
    expect(frames.size).toBe(0);
  });
});
