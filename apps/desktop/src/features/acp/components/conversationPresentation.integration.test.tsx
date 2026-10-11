import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { applyAcpEventToTurn, createTurn } from "@dawnsight/chat-ui/chatTurns";

import type { LoadedTranscriptEvent } from "../api";
import { mapLoadedTranscript } from "../conversationTranscript";
import { ChatTurnView } from "./ChatTurnView";

afterEach(cleanup);

// 见 ChatTurnView.test.tsx：预热 React.lazy 的 ChatMarkdown 分包。
beforeAll(async () => {
  await import("./ChatMarkdown");
});

describe("conversation presentation integration", () => {
  it("projects an original-shaped restored transcript into a safe rich card", async () => {
    const originalReplay: LoadedTranscriptEvent[] = [
      {
        role: "user",
        text: [
          "台词上下文窗口建议：当前播放点前后各 30 秒；读取当前台词时优先使用该范围。",
          "请梳理目前剧情。",
        ].join("\n"),
      },
      { role: "agent", text: "Designing JSON schema for plot summary" },
      { role: "tool", text: "dawnsight_get_transcript_window { path: 'D:/private.mkv' }" },
      { role: "agent", text: "Confirming timestamp boundaries for summary" },
      {
        role: "agent",
        text: JSON.stringify({
          version: "plot_summary.v1",
          scope: { label: "截至当前播放位置" },
          summary: "两位主角在争执后重新确认了彼此的心意。",
          evidence: [
            { source: "transcript_window", text: "字幕提到两人决定一起回去。" },
          ],
        }),
      },
    ];

    const [turn] = mapLoadedTranscript(originalReplay);
    expect(turn?.shortcutTaskId).toBe("plot_summary");
    expect(turn?.activities).toEqual([]);

    render(<ChatTurnView turn={turn!} presentationMode="release" />);

    expect(
      await screen.findByRole("heading", { name: "剧情梳理" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("两位主角在争执后重新确认了彼此的心意。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/plot_summary\.v1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Designing JSON schema/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirming timestamp/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dawnsight_get_transcript_window/)).not.toBeInTheDocument();
    expect(screen.queryByText(/台词上下文窗口建议/)).not.toBeInTheDocument();
  });

  it("keeps development diagnostics separate and release status business-facing", () => {
    const sequence = { n: 0 };
    let turn = createTurn(sequence, "这段在讲什么？");
    turn = applyAcpEventToTurn(
      turn,
      { type: "agentThought", text: "Planning with C:\\private\\prompt.md" },
      "verbose",
    );
    turn = applyAcpEventToTurn(
      turn,
      { type: "plan", text: "Read transcript then return JSON" },
      "verbose",
    );
    turn = applyAcpEventToTurn(
      turn,
      {
        type: "toolCall",
        toolCallId: "call-1",
        title: "dawnsight_get_transcript_window",
        status: "running",
        detail: '{"path":"C:\\\\private\\\\video.mkv","stderr":"no"}',
      },
      "verbose",
    );

    const development = render(
      <ChatTurnView turn={turn} presentationMode="development" />,
    );
    expect(screen.getByText("工具：dawnsight_get_transcript_window")).toBeInTheDocument();
    expect(screen.getByText("思路整理")).toBeInTheDocument();
    expect(screen.queryByText(/private\\\\video|prompt\.md|stderr/)).not.toBeInTheDocument();
    development.unmount();

    const release = render(<ChatTurnView turn={turn} presentationMode="release" />);
    expect(screen.getByText("正在读取该段台词")).toBeInTheDocument();
    expect(screen.queryByText(/dawnsight_get_transcript_window/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private\\\\video|prompt\.md|stderr/)).not.toBeInTheDocument();
    release.unmount();

    const done = applyAcpEventToTurn(
      turn,
      { type: "finished", text: "最终回答只保留这句话。" },
      "verbose",
    );
    const completedRelease = render(
      <ChatTurnView turn={done} presentationMode="release" />,
    );
    expect(screen.getByText("最终回答只保留这句话。")).toBeInTheDocument();
    expect(screen.queryByText("正在读取该段台词")).not.toBeInTheDocument();
    expect(screen.queryByText(/dawnsight_get_transcript_window/)).not.toBeInTheDocument();
    completedRelease.unmount();

    render(<ChatTurnView turn={done} presentationMode="development" />);
    expect(screen.getByText("最终回答只保留这句话。")).toBeInTheDocument();
    expect(screen.getByText(/查看本轮调试记录/)).toBeInTheDocument();
  });

  it("retains already-visible safe prose through the real toolCall reducer", async () => {
    let turn = createTurn({ n: 0 }, "解释这一段");
    turn = applyAcpEventToTurn(
      turn,
      { type: "agentMessage", text: "这段双方已经达成共识。" },
      "minimal",
    );
    const view = render(
      <ChatTurnView turn={turn} presentationMode="release" />,
    );
    expect(
      await screen.findByText("这段双方已经达成共识。"),
    ).toBeInTheDocument();
    // 真实事件链：工具启动（经 sealAgentSegment）+ 工具期追消息，正文不消失。
    turn = applyAcpEventToTurn(
      turn,
      {
        type: "toolCall",
        toolCallId: "a",
        title: "dawnsight_get_transcript_window",
        status: "running",
      },
      "minimal",
    );
    view.rerender(<ChatTurnView turn={turn} presentationMode="release" />);
    expect(screen.queryByText("这段双方已经达成共识。")).toBeInTheDocument();
    turn = applyAcpEventToTurn(
      turn,
      { type: "agentMessage", text: "正在整理台词细节。" },
      "minimal",
    );
    view.rerender(<ChatTurnView turn={turn} presentationMode="release" />);
    expect(screen.queryByText("这段双方已经达成共识。")).toBeInTheDocument();
    view.unmount();
  });

  it("retains an honest expandable process summary after release completion", async () => {
    const { fireEvent } = await import("@testing-library/react");
    let turn = createTurn({ n: 0 }, "这段在讲什么？");
    turn = applyAcpEventToTurn(
      turn,
      {
        type: "toolCall",
        toolCallId: "call-1",
        title: "dawnsight_get_transcript_window",
        status: "running",
      },
      "verbose",
    );
    turn = applyAcpEventToTurn(
      turn,
      { type: "toolCallUpdate", toolCallId: "call-1", status: "completed" },
      "verbose",
    );
    turn = applyAcpEventToTurn(
      turn,
      { type: "finished", text: "最终回答。" },
      "verbose",
    );

    const completed = render(
      <ChatTurnView turn={turn} presentationMode="release" />,
    );
    // 完成后仍有一行可信摘要，而不是过程直接消失。
    expect(screen.getByText("已完成 1 步操作")).toBeInTheDocument();
    expect(screen.queryByText("正在读取该段台词")).not.toBeInTheDocument();
    // 展开后是安全投影的步骤行，不泄漏原始参数。
    fireEvent.click(screen.getByText("已完成 1 步操作"));
    expect(await screen.findByText("已读取该段台词")).toBeInTheDocument();
    expect(screen.queryByText(/dawnsight_get_transcript_window/)).not.toBeInTheDocument();
    completed.unmount();

    // 没有活动记录的历史回答不编造过程。
    let bare = createTurn({ n: 0 }, "旧问题");
    bare = applyAcpEventToTurn(
      bare,
      { type: "finished", text: "旧回答。" },
      "verbose",
    );
    render(<ChatTurnView turn={bare} presentationMode="release" />);
    expect(screen.queryByText(/步操作/)).not.toBeInTheDocument();
  });

  it("labels cancelled and failed tools distinctly in release mode", () => {
    let turn = createTurn({ n: 0 }, "这段在讲什么？");
    turn = applyAcpEventToTurn(
      turn,
      {
        type: "toolCall",
        toolCallId: "call-1",
        title: "dawnsight_get_transcript_window",
        status: "running",
      },
      "verbose",
    );
    turn = applyAcpEventToTurn(
      turn,
      { type: "toolCallUpdate", toolCallId: "call-1", status: "cancelled" },
      "verbose",
    );
    const cancelled = render(
      <ChatTurnView turn={turn} presentationMode="release" />,
    );
    // 取消不能显示“失败”，也不显示“正在”。
    expect(screen.getByText("已取消读取该段台词")).toBeInTheDocument();
    expect(screen.queryByText("正在读取该段台词")).not.toBeInTheDocument();
    // F5：取消行不用失败样式，不承诺未经保证的自动继续。
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(
      screen.queryByText("工具执行未成功，Agent 将尝试其他方式继续"),
    ).not.toBeInTheDocument();
    expect(cancelled.container.querySelector(".bg-destructive\\/5")).toBeNull();
    expect(cancelled.container.querySelector(".text-destructive")).toBeNull();
    cancelled.unmount();

    let failed = createTurn({ n: 0 }, "这段在讲什么？");
    failed = applyAcpEventToTurn(
      failed,
      {
        type: "toolCall",
        toolCallId: "call-2",
        title: "dawnsight_get_transcript_window",
        status: "running",
      },
      "verbose",
    );
    failed = applyAcpEventToTurn(
      failed,
      { type: "toolCallUpdate", toolCallId: "call-2", status: "failed" },
      "verbose",
    );
    failed = applyAcpEventToTurn(
      failed,
      { type: "finished", text: "换个方式回答。" },
      "verbose",
    );
    render(<ChatTurnView turn={failed} presentationMode="release" />);
    expect(screen.getByText("有 1 步操作未完成")).toBeInTheDocument();
    expect(screen.queryByText("已完成 1 步操作")).not.toBeInTheDocument();
  });

  it("distinguishes running, pending and unknown tool states in release titles", () => {
    const turnWith = (status?: string) => {
      let turn = createTurn({ n: 0 }, "这段在讲什么？");
      turn = applyAcpEventToTurn(
        turn,
        {
          type: "toolCall",
          toolCallId: "call-x",
          title: "dawnsight_get_transcript_window",
          status: "running",
        },
        "verbose",
      );
      if (status !== "running") {
        turn = applyAcpEventToTurn(
          turn,
          { type: "toolCallUpdate", toolCallId: "call-x", status },
          "verbose",
        );
      }
      return turn;
    };

    const running = render(
      <ChatTurnView turn={turnWith("running")} presentationMode="release" />,
    );
    expect(screen.getByText("正在读取该段台词")).toBeInTheDocument();
    running.unmount();

    const pending = render(
      <ChatTurnView turn={turnWith("pending")} presentationMode="release" />,
    );
    expect(screen.getByText("等待读取该段台词")).toBeInTheDocument();
    expect(screen.queryByText("正在读取该段台词")).not.toBeInTheDocument();
    pending.unmount();

    // F7：未知状态绝不能声称正在执行，给中文业务提示。
    const unknown = render(
      <ChatTurnView turn={turnWith("weird-status")} presentationMode="release" />,
    );
    expect(screen.getByText("读取该段台词（状态未知）")).toBeInTheDocument();
    expect(screen.queryByText("正在读取该段台词")).not.toBeInTheDocument();
    unknown.unmount();
  });

  it("copies the visible rich answer rather than its internal JSON contract", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const writeText = vi.fn(async (_text: string) => {});
    const restoreClipboard = mockClipboard(writeText);
    try {
      let turn = createTurn({ n: 0 }, "总结");
      turn = {
        ...turn,
        status: "done",
        answer: JSON.stringify({
          blocks: [
            {
              id: "narrative-a",
              kind: "narrative",
              markdown: "这是用户看到的结论。",
            },
          ],
        }),
      };
      render(<ChatTurnView turn={turn} presentationMode="release" />);
      expect(await screen.findByText("这是用户看到的结论。")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "复制回答" }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      expect(writeText.mock.calls[0]?.[0]).toBe("这是用户看到的结论。");
    } finally {
      restoreClipboard();
    }
  });

  it("offers a copy action on plain done turns and reports clipboard denial", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const writeText = vi.fn(async (_text: string) => {
      throw new Error("denied");
    });
    const restoreClipboard = mockClipboard(writeText);
    try {
      let turn = createTurn({ n: 0 }, "复制我");
      turn = applyAcpEventToTurn(
        turn,
        { type: "finished", text: "可复制的回答。" },
        "verbose",
      );
      render(<ChatTurnView turn={turn} presentationMode="release" />);
      fireEvent.click(screen.getByRole("button", { name: "复制回答" }));
      expect(writeText).toHaveBeenCalledWith("可复制的回答。");
      expect(await screen.findByText("复制失败，请重试")).toBeInTheDocument();
    } finally {
      restoreClipboard();
    }
  });
});

/** happy-dom 不保证 navigator.clipboard 存在：有则暂代，无则补上。 */
function mockClipboard(writeText: (text: string) => Promise<void>): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(navigator, "clipboard", descriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  };
}
