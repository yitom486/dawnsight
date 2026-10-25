import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpEvent } from "./types";
import { createTextStreamBuffer } from "./textStreamBuffer";

let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
function paint() {
  for (const callback of [...frames.values()]) callback(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("prompt text stream buffering", () => {
  it("coalesces a 200-chunk burst without dropping Unicode text", () => {
    const consume = vi.fn();
    const buffer = createTextStreamBuffer(consume);
    const pieces = Array.from({ length: 200 }, (_, i) => `第${i}段😀`);
    for (const text of pieces) buffer.push({ type: "agentMessage", text });
    expect(consume).not.toHaveBeenCalled();
    paint();
    expect(consume.mock.calls).toEqual([[{ type: "agentMessage", text: pieces.join("") }]]);
    vi.advanceTimersByTime(100);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("preserves text/tool/terminal order through the production reducer", async () => {
    const { applyAcpEventToTurn, createTurn } = await import("@dawnsight/chat-ui/chatTurns");
    let actual = createTurn({ n: 0 }, "question");
    let expected = actual;
    const events: AcpEvent[] = [
      { type: "agentMessage", text: "Before " },
      { type: "agentMessage", text: "tool." },
      { type: "toolCall", toolCallId: "tool-1", status: "in_progress" },
      { type: "toolCallUpdate", toolCallId: "tool-1", status: "completed" },
      { type: "agentMessage", text: "Final " },
      { type: "agentMessage", text: "answer." },
      { type: "finished", text: "Final answer." },
    ];
    const consume = vi.fn((event: AcpEvent) => {
      actual = applyAcpEventToTurn(actual, event, "hidden");
    });
    const buffer = createTextStreamBuffer(consume);
    for (const event of events) {
      expected = applyAcpEventToTurn(expected, event, "hidden");
      buffer.push(event);
    }
    expect(actual).toEqual(expected);
    expect(consume.mock.calls.map(([e]) => e.type)).toEqual([
      "agentMessage", "toolCall", "toolCallUpdate", "agentMessage", "finished",
    ]);
    expect(frames.size).toBe(0);
  });

  it("flushes in hidden windows even without animation frames", () => {
    const consume = vi.fn();
    const buffer = createTextStreamBuffer(consume);
    buffer.push({ type: "agentMessage", text: "tail" });
    vi.advanceTimersByTime(50);
    expect(consume).toHaveBeenCalledWith({ type: "agentMessage", text: "tail" });
    expect(frames.size).toBe(0);
  });

  it("flushes before failure and closes idempotently without late writes", () => {
    const consume = vi.fn();
    const buffer = createTextStreamBuffer(consume);
    buffer.push({ type: "agentMessage", text: "partial" });
    buffer.push({ type: "failed", code: "Error", message: "Unavailable" });
    buffer.push({ type: "agentMessage", text: "late terminal chunk" });
    buffer.close();
    buffer.close();
    buffer.push({ type: "agentMessage", text: "late" });
    paint();
    vi.advanceTimersByTime(100);
    expect(consume.mock.calls.map(([e]) => e.type)).toEqual(["agentMessage", "failed"]);
  });

  it("flushes trailing text on close and keeps prompts isolated", () => {
    const a = vi.fn();
    const b = vi.fn();
    const first = createTextStreamBuffer(a);
    const second = createTextStreamBuffer(b);
    first.push({ type: "agentMessage", text: "A" });
    second.push({ type: "agentMessage", text: "B" });
    first.close();
    expect(a).toHaveBeenCalledWith({ type: "agentMessage", text: "A" });
    expect(b).not.toHaveBeenCalled();
    paint();
    expect(b).toHaveBeenCalledWith({ type: "agentMessage", text: "B" });
    expect(a).toHaveBeenCalledTimes(1);
  });
});
