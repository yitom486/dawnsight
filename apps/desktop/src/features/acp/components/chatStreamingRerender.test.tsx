import { createElement, useCallback } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatTurn } from "../types";
import { ChatTurnList } from "./ChatTurnList";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// 渲染计数：ChatTurnView 的 memo 挡住旧 turn 时，它的 children
//（ChatMarkdownLazy）也不会重渲染——在 children 外包计数即等价于
// 度量 memo 是否生效。注意不能在 ChatTurnView 外再包一层计数：
// 那层每次父渲染都会执行，量到的是父渲染不是 memo 跳过。
const mdCounts = new Map<string, number>();

vi.mock("./ChatMarkdownLazy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ChatMarkdownLazy")>();
  return {
    ...actual,
    ChatMarkdownLazy: (props: { content: string }) => {
      mdCounts.set(
        props.content,
        (mdCounts.get(props.content) ?? 0) + 1,
      );
      return createElement(actual.ChatMarkdownLazy, props);
    },
  };
});

const { ChatTurnView: _counted } = await import("./ChatTurnView");
void _counted;

function makeDoneTurn(index: number): ChatTurn {
  return {
    id: `done-${index}`,
    userText: `第 ${index} 个问题：这段剧情讲了什么？`,
    answer:
      `这是第 ${index} 个已完成回答，包含中文标点，` +
      `以及一个表格：\n\n| 列 A | 列 B |\n| --- | --- |\n| 甲 | 乙 |\n`,
    status: "done",
    activities: [],
    showActivities: false,
  };
}

function makeStreamingTurn(answer: string): ChatTurn {
  return {
    id: "live",
    userText: "正在问的那个问题",
    answer,
    status: "streaming",
    activities: [],
    showActivities: true,
  };
}

const PIECES = Array.from(
  { length: 200 },
  (_, i) =>
    i === 50
      ? "\n\n```text\n未闭合的代码块开始"
      : `这是第${i}片，含中文逗号，`,
);

/**
 * C1/C3 流式基线 fixture（仅测试，不进生产）：
 * 100 个完成 turns + 1 个活动 turn；200 次同步文本增量模拟 token 流。
 * C1 基线：每次增量全列表重渲染（maxOld=201，elapsedMs≈1.5s happy-dom）。
 * C3 目标：稳定回调 + memo 后旧消息只渲染 1 次；不稳定闭包仍全量重渲染
 *（对照组，锁定“生产回调必须稳定”的约定，见 AcpPanel 注释）。
 * happy-dom 无真实布局：只计渲染次数与耗时，不 claiming 滚动/布局结论。
 */
describe("chat streaming rerender baseline", () => {
  beforeEach(() => {
    mdCounts.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it(
    "stable callbacks: old turns render once across 200 increments",
    { timeout: 60_000 },
    () => {
      const doneTurns = Array.from({ length: 100 }, (_, index) =>
        makeDoneTurn(index),
      );
      let liveAnswer = "开头。";
      const notices: { id: string; content: string }[] = [];

      function Harness({ answer }: { answer: string }) {
        // 生产侧的稳定回调对等物（AcpPanel 用 useCallback 钉住这三个）。
        const onAssistantAction = useCallback(() => {}, []);
        return (
          <ChatTurnList
            turns={[...doneTurns, makeStreamingTurn(answer)]}
            notices={notices}
            onAssistantAction={onAssistantAction}
          />
        );
      }

      const started = performance.now();
      const rendered = render(<Harness answer={liveAnswer} />);
      for (const piece of PIECES) {
        liveAnswer += piece;
        // doneTurns 对象身份保持（生产 setTurns 只替换目标 turn），
        // 只有数组与活动 turn 是新的。
        rendered.rerender(<Harness answer={liveAnswer} />);
      }
      const elapsedMs = performance.now() - started;

      expect(screen.getByText(/这是第199片/)).toBeInTheDocument();

      const oldCounts = doneTurns.map(
        (turn) => mdCounts.get(turn.answer) ?? 0,
      );
      const maxOld = Math.max(...oldCounts);
      const totalRenders = [...mdCounts.values()].reduce((a, b) => a + b, 0);

      // eslint-disable-next-line no-console
      console.log(
        `[chat-c3] 200 increments stable-cb: maxOldTurnRenders=${maxOld} ` +
          `totalMdRenders=${totalRenders} ` +
          `elapsedMs=${Math.round(elapsedMs)}`,
      );

      expect(maxOld).toBeLessThanOrEqual(2);
    },
  );

  it(
    "unstable callbacks defeat memo: documents why production callbacks must stay stable",
    { timeout: 60_000 },
    () => {
      const doneTurns = Array.from({ length: 100 }, (_, index) =>
        makeDoneTurn(index),
      );
      let liveAnswer = "开头。";
      const notices: { id: string; content: string }[] = [];
      const rendered = render(
        <ChatTurnList
          turns={[...doneTurns, makeStreamingTurn(liveAnswer)]}
          notices={notices}
          onAssistantAction={() => {}}
        />,
      );

      for (const piece of PIECES) {
        liveAnswer += piece;
        // 每次都换新闭包：memo 挡不住，旧消息跟着全量重渲染。
        rendered.rerender(
          <ChatTurnList
            turns={[...doneTurns, makeStreamingTurn(liveAnswer)]}
            notices={notices}
            onAssistantAction={() => {}}
          />,
        );
      }

      expect(screen.getByText(/这是第199片/)).toBeInTheDocument();
      const maxOld = Math.max(
        ...doneTurns.map((turn) => mdCounts.get(turn.answer) ?? 0),
      );
      // eslint-disable-next-line no-console
      console.log(`[chat-c3] 200 increments unstable-cb: maxOldTurnRenders=${maxOld}`);
      expect(maxOld).toBeGreaterThan(100);
    },
  );
});
