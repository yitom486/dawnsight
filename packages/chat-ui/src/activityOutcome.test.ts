import { describe, expect, it } from "vitest";

import {
  summarizeActivityOutcome,
} from "./activityStatus";
import type { ChatActivity } from "./types";

function tool(id: string, status?: string): ChatActivity {
  return { id, kind: "tool", title: "工具", status };
}

describe("summarizeActivityOutcome", () => {
  it("returns null without tool activities (never invents a process)", () => {
    expect(summarizeActivityOutcome([])).toBeNull();
    expect(
      summarizeActivityOutcome([
        { id: "t1", kind: "thought", title: "思路整理" },
        { id: "p1", kind: "plan", title: "处理计划" },
      ]),
    ).toBeNull();
  });

  it("reports all-completed counts honestly", () => {
    expect(summarizeActivityOutcome([tool("a", "completed")])).toBe(
      "已完成 1 步操作",
    );
    expect(
      summarizeActivityOutcome([
        tool("a", "completed"),
        tool("b", "success"),
        { id: "t", kind: "thought" },
      ]),
    ).toBe("已完成 2 步操作");
  });

  it("names failed and cancelled outcomes distinctly", () => {
    expect(summarizeActivityOutcome([tool("a", "failed")])).toBe(
      "有 1 步操作未完成",
    );
    expect(
      summarizeActivityOutcome([
        tool("a", "completed"),
        tool("b", "error"),
        tool("c", "pending"),
      ]),
    ).toBe("有 1 步未完成，1 步尚未结束（共 3 步）");
    expect(summarizeActivityOutcome([tool("a", "cancelled")])).toBe(
      "操作已取消",
    );
    expect(
      summarizeActivityOutcome([
        tool("a", "completed"),
        tool("b", "cancelled"),
      ]),
    ).toBe("有 1 步已取消（共 2 步）");
  });

  it("never labels unfinished operations completed", () => {
    for (const status of ["pending", "running", "in_progress"]) {
      const label = summarizeActivityOutcome([
        { id: "tool-a", kind: "tool", status },
      ]);
      expect(label).not.toMatch(/已完成/);
      expect(label).toBe("有 1 步操作尚未结束");
    }
    expect(
      summarizeActivityOutcome([
        { id: "a", kind: "tool", status: "completed" },
        { id: "b", kind: "tool", status: "running" },
      ]),
    ).toBe("有 1 步尚未结束（共 2 步）");
  });

  it("keeps mixed outcomes honest without hiding any category", () => {
    const tool = (id: string, status?: string) => ({ id, kind: "tool" as const, status });
    // F6：失败与取消同时存在时两边都保留，不提前返回吞信息。
    expect(
      summarizeActivityOutcome([tool("a", "failed"), tool("b", "cancelled")]),
    ).toBe("有 1 步未完成，1 步已取消（共 2 步）");
    expect(
      summarizeActivityOutcome([tool("a", "failed"), tool("b", "running")]),
    ).toBe("有 1 步未完成，1 步尚未结束（共 2 步）");
    expect(
      summarizeActivityOutcome([tool("a", "running"), tool("b", "weird")]),
    ).toBe("有 1 步尚未结束，1 步状态未知（共 2 步）");
    expect(
      summarizeActivityOutcome([tool("a", "completed"), tool("b", "weird")]),
    ).toBe("有 1 步状态未知（共 2 步）");
  });

  it("marks unknown terminal states instead of claiming progress", () => {
    expect(summarizeActivityOutcome([tool("a")])).toBe(
      "有 1 步操作状态未知",
    );
    expect(
      summarizeActivityOutcome([
        tool("a", "completed"),
        tool("b", "weird-status"),
      ]),
    ).toBe("有 1 步状态未知（共 2 步）");
  });
});
