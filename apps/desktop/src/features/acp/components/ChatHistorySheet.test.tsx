import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatHistorySheet } from "@dawnsight/chat-ui/components/ChatHistorySheet";
import type { HistoryThreadRow } from "@dawnsight/chat-ui/conversationContext";

const ROWS: HistoryThreadRow[] = [
  { sessionId: "sess-active-1", title: "猎户座大星云梳理", updatedAtMs: 1_700_000_000_000, isEmptyCandidate: false },
  { sessionId: "sess-empty-2", title: "", updatedAtMs: 0, isEmptyCandidate: true },
  { sessionId: "sess-other-3", title: "上一部剧集的提问", updatedAtMs: 1_698_000_000_000, isEmptyCandidate: false },
];

function renderSheet(props: Partial<React.ComponentProps<typeof ChatHistorySheet>> = {}) {
  const callbacks = {
    onRefresh: vi.fn(),
    onPurgeEmpty: vi.fn(),
    onClose: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <ChatHistorySheet
      open
      rows={ROWS}
      activeSessionId="sess-active-1"
      switchBlocked={false}
      loading={false}
      {...callbacks}
      {...props}
    />,
  );
  return callbacks;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatHistorySheet", () => {
  it("mounts nothing when closed", () => {
    const { container } = render(
      <ChatHistorySheet
        open={false}
        rows={ROWS}
        activeSessionId={null}
        switchBlocked={false}
        loading={false}
        onRefresh={vi.fn()}
        onPurgeEmpty={vi.fn()}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("sends header actions with exact counts", () => {
    const { onRefresh, onClose, onPurgeEmpty } = renderSheet();
    fireEvent.click(screen.getByText("刷新"));
    fireEvent.click(screen.getByText("关闭"));
    fireEvent.click(screen.getByText(/清理空对话/));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPurgeEmpty).toHaveBeenCalledTimes(1);
  });

  it("hides the purge action when nothing is empty", () => {
    renderSheet({ rows: [ROWS[0]!] });
    expect(screen.queryByText(/清理空对话/)).not.toBeInTheDocument();
  });

  it("selects and deletes with the right ids and no crossover", () => {
    const { onSelect, onDelete } = renderSheet();
    const activeRow = screen.getByRole("button", { name: /猎户座大星云梳理/ });
    fireEvent.click(activeRow);
    expect(onSelect).toHaveBeenCalledWith("sess-active-1");
    expect(onDelete).not.toHaveBeenCalled();
    const rows = screen.getAllByRole("button", { name: "删除对话" });
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[2] as Element);
    expect(onDelete).toHaveBeenCalledWith("sess-other-3");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("blocks switching actions while busy but keeps refresh", () => {
    const { onSelect, onDelete, onPurgeEmpty, onRefresh } = renderSheet({ switchBlocked: true });
    expect(screen.getAllByText("正在回答，请稍后再切换对话")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /猎户座大星云梳理/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "删除对话" })[0] as Element);
    fireEvent.click(screen.getByText(/清理空对话/));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onPurgeEmpty).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("刷新"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows loading text and disables refresh when nothing is cached", () => {
    renderSheet({ loading: true, rows: [] });
    expect(screen.getByText("正在加载历史…")).toBeInTheDocument();
    expect(screen.getByText("刷新").closest("button")).toBeDisabled();
  });

  it("keeps cached rows visible during reload", () => {
    renderSheet({ loading: true });
    expect(screen.queryByText("正在加载历史…")).not.toBeInTheDocument();
    expect(screen.getByText("猎户座大星云梳理")).toBeInTheDocument();
  });

  it("shows the honest empty state without rows", () => {
    renderSheet({ rows: [] });
    expect(screen.getByText(/暂无历史对话/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("formats time and falls back to a session prefix", () => {
    renderSheet();
    expect(screen.getByText(/11\/15/)).toBeInTheDocument();
    expect(screen.getByText("对话 sess-emp")).toBeInTheDocument();
  });

  it("marks only the active session with aria-current and a text marker", () => {
    renderSheet();
    const active = screen.getByRole("button", { name: /猎户座大星云梳理/ });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(active.textContent).toContain("（当前）");
    const other = screen.getByRole("button", { name: /上一部剧集的提问/ });
    expect(other).not.toHaveAttribute("aria-current");
    expect(other.textContent).not.toContain("（当前）");
  });

  it("keeps the given row order", () => {
    renderSheet();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("猎户座大星云梳理");
    expect(items[2]?.textContent).toContain("上一部剧集的提问");
  });

  it("renders long titles in full", () => {
    const longTitle = `超长对话标题${"长".repeat(40)}无空格Token${"x".repeat(48)}尾`;
    renderSheet({ rows: [{ sessionId: "s-long", title: longTitle, updatedAtMs: 1, isEmptyCandidate: false }] });
    expect(screen.getByText(longTitle, { exact: false })).toBeInTheDocument();
  });
});
