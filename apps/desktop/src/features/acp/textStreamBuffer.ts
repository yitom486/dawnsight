import type { AcpEvent } from "./types";

/** One buffer per prompt: batch only adjacent text, never cross tool boundaries. */
export function createTextStreamBuffer(consume: (event: AcpEvent) => void) {
  let pending: string[] = [];
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function flush() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    frame = undefined;
    timer = undefined;
    if (pending.length === 0) return;
    const text = pending.join("");
    pending = [];
    consume({ type: "agentMessage", text });
  }

  return {
    push(event: AcpEvent) {
      if (closed) return;
      if (event.type !== "agentMessage") {
        flush();
        if (event.type === "finished" || event.type === "failed") closed = true;
        consume(event);
        return;
      }
      pending.push(event.text);
      if (frame !== undefined) return;
      frame = requestAnimationFrame(flush);
      // WebView may pause animation frames while hidden. Never strand text.
      timer = setTimeout(flush, 50);
    },
    close() {
      closed = true;
      flush();
    },
  };
}
