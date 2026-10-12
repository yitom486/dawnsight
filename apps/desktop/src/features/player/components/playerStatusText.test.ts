import { describe, expect, it } from "vitest";

import { playerStatusText } from "./playerStatusText";

describe("playerStatusText", () => {
  it.each([
    ["Loading", "正在打开"],
    ["Playing", "正在播放"],
    ["Paused", "已暂停"],
    ["Ready", "已就绪"],
    ["Ended", "已结束"],
    ["Error", "播放失败"],
  ] as const)("maps %s to fixed business copy %s", (status, expected) => {
    const text = playerStatusText(status);
    expect(text).toBe(expected);
    // Business copy is Chinese; raw engine tokens must not leak.
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(text).not.toBe(status);
  });

  it("distinguishes initial Idle from post-stop Idle via media context", () => {
    // Fresh launch: no media held by the snapshot.
    expect(playerStatusText("Idle", { hasMedia: false })).toBe("未打开媒体");
    expect(playerStatusText("Idle")).toBe("未打开媒体");
    // Real backend stop returns Idle while keeping currentFile.
    expect(playerStatusText("Idle", { hasMedia: true })).toBe("已停止");
  });

  it("ignores media context for non-Idle states", () => {
    expect(playerStatusText("Playing", { hasMedia: true })).toBe("正在播放");
    expect(playerStatusText("Error", { hasMedia: false })).toBe("播放失败");
  });

  it("keeps a defensive mapping for values the backend never sends", () => {
    // The real backend stop yields Idle, never "Stopped"; this branch only
    // prevents engine English from leaking if such a value ever arrives.
    // It does not cover the production stop chain (see StatusLine test).
    expect(playerStatusText("Stopped")).toBe("已停止");
  });

  it.each(["Weird", "", "playing", "PLAYING", "Buffering 42%"])(
    "falls back neutrally for unknown status %s",
    (status) => {
      expect(playerStatusText(status)).toBe("状态未知");
    },
  );
});
