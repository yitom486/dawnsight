import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatMarkdownLazy } from "./ChatMarkdownLazy";

const deferred = vi.hoisted(() => {
  let release!: (value: unknown) => void;
  const gate: Promise<unknown> = new Promise((resolve) => {
    release = resolve;
  });
  return {
    gate,
    release: (value: unknown) => release(value),
  };
});

vi.mock("./ChatMarkdown", () => deferred.gate.then(() => ({
  ChatMarkdown: (props: { content: string; className?: string; streaming?: boolean }) => (
    <span
      data-testid="md"
      data-streaming={String(props.streaming ?? false)}
      className={props.className}
    >
      {props.content}
    </span>
  ),
})));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatMarkdownLazy", () => {
  it("shows the raw content while the chunk is still loading", () => {
    render(<ChatMarkdownLazy content="## 标题" />);
    expect(screen.getByText("## 标题")).toBeInTheDocument();
    expect(screen.queryByTestId("md")).not.toBeInTheDocument();
  });

  it("keeps a custom fallback while loading", () => {
    render(
      <ChatMarkdownLazy
        content="正文"
        streaming
        fallback={<p>等 markdown 组件…</p>}
      />,
    );
    expect(screen.getByText("等 markdown 组件…")).toBeInTheDocument();
    expect(screen.queryByTestId("md")).not.toBeInTheDocument();
  });

  it("aligns the default fallback and forwards className once loaded", async () => {
    render(<ChatMarkdownLazy content="## 标题" className="answer-body" />);
    const fallback = screen.getByText("## 标题");
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback.className).toContain("whitespace-pre-wrap");
    expect(fallback.className).toContain("answer-body");
    deferred.release(null);
    const inner = await screen.findByTestId("md");
    expect(inner).toHaveTextContent("## 标题");
    expect(inner.className).toContain("answer-body");
    expect(inner).toHaveAttribute("data-streaming", "false");
  });

  it("passes streaming through after load", async () => {
    render(<ChatMarkdownLazy content="正文" streaming />);
    const inner = await screen.findByTestId("md");
    expect(inner).toHaveAttribute("data-streaming", "true");
  });

  it("never hides content while waiting", async () => {
    const { unmount } = render(<ChatMarkdownLazy content="可见正文" />);
    expect(
      screen.queryByTestId("md") ?? screen.getByText("可见正文"),
    ).toBeInTheDocument();
    unmount();
  });
});
