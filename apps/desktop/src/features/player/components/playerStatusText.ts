/**
 * Map the raw engine status string to fixed Chinese business copy.
 * The snapshot status comes from Rust as an open string; unknown values
 * fall back to a neutral label instead of leaking engine internals.
 * Never invent progress, timing, or results here — this is a label only.
 *
 * Idle is ambiguous: the real backend stop returns Idle while keeping
 * currentFile, but a fresh launch is also Idle with no media. Callers pass
 * the trusted snapshot media context (currentFile presence) so the initial
 * empty state and the post-stop state render distinctly. The context is a
 * fact from the snapshot — never a parse of Chinese message strings.
 */
export type PlayerStatusContext = {
  hasMedia: boolean;
};

export function playerStatusText(
  status: string,
  context?: PlayerStatusContext,
): string {
  if (status === "Idle") {
    return context?.hasMedia ? "已停止" : "未打开媒体";
  }
  switch (status) {
    case "Loading":
      return "正在打开";
    case "Playing":
      return "正在播放";
    case "Paused":
      return "已暂停";
    case "Ready":
      return "已就绪";
    case "Stopped":
      // Defensive only: the real backend stop yields Idle, never this.
      return "已停止";
    case "Ended":
      return "已结束";
    case "Error":
      return "播放失败";
    default:
      return "状态未知";
  }
}
