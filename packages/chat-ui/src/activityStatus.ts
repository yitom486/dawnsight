import type { ChatActivity } from "./types";

export function isToolRunning(status?: string): boolean {
  switch (status) {
    case "in_progress":
    case "running":
    case "pending":
      return true;
    default:
      return false;
  }
}

export function hasActiveToolActivity(activities: ChatActivity[]): boolean {
  return activities.some(
    (item) => item.kind === "tool" && isToolRunning(item.status),
  );
}

export function waitingLabel(activities: ChatActivity[]): string {
  if (hasActiveToolActivity(activities)) return "Agent 正在调用工具…";
  if (activities.some((item) => item.kind === "thought")) return "Agent 正在思考…";
  if (activities.some((item) => item.kind === "plan")) return "Agent 正在规划…";
  return "Agent 正在回复…";
}

/**
 * 正式模式完成后保留的可信业务过程摘要（一行）。
 * 只数真实存在的 tool 活动：仅 completed/success 计成功；失败/取消/
 * 未结束/未知同时存在时合并保留，一个都不隐去（F6：取消分支不得吞掉
 * 失败信息）。绝不编造百分比、耗时或结果数量，更不能把未结束状态伪装
 * 成成功。没有 tool 活动时返回 null（不伪造过程）。
 */
export function summarizeActivityOutcome(
  activities: ChatActivity[],
): string | null {
  const tools = activities.filter((item) => item.kind === "tool");
  const total = tools.length;
  if (total === 0) return null;
  const count = (...statuses: string[]): number =>
    tools.filter((item) => statuses.includes(item.status ?? "")).length;
  const failed = count("failed", "error");
  const cancelled = count("cancelled");
  // finished 事件保留原 activities，不保证每个工具都收到完成更新：
  // pending/running/in_progress 是“尚未结束”，绝不能落进“已完成”。
  const unfinished = count("pending", "running", "in_progress");
  const done = count("completed", "success");
  const unknown = total - failed - cancelled - unfinished - done;
  if (total === 1) {
    if (failed > 0) return "有 1 步操作未完成";
    if (cancelled > 0) return "操作已取消";
    if (unfinished > 0) return "有 1 步操作尚未结束";
    if (unknown > 0) return "有 1 步操作状态未知";
    return "已完成 1 步操作";
  }
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} 步未完成`);
  if (cancelled > 0) parts.push(`${cancelled} 步已取消`);
  if (unfinished > 0) parts.push(`${unfinished} 步尚未结束`);
  if (unknown > 0) parts.push(`${unknown} 步状态未知`);
  if (parts.length === 0) return `已完成 ${total} 步操作`;
  return `有 ${parts.join("，")}（共 ${total} 步）`;
}
