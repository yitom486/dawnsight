import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useHistoryConversation } from "./useHistoryConversation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const input = {
    queryClient,
    sessionCwd: "C:\\w",
    activeProfileId: "codex",
    sessionActive: false,
    connected: false,
    composerBusy: false,
    promptBusy: false,
    newChatPending: false,
    switchingSession: false,
    switchSessionAsync: vi.fn(async () => {}),
    resumeExpectedSessionIdRef: { current: null as string | null },
    resumeNoticePendingRef: { current: false },
    transcriptLoadSeqRef: { current: 0 },
    idSeq: { n: 0 },
    turnListRef: { current: null as HTMLDivElement | null },
    pushSystem: vi.fn(),
    setTurns: vi.fn(),
    setNotices: vi.fn(),
    clearDraft: vi.fn(),
    clearPromptQueue: vi.fn(),
    setPendingPermission: vi.fn(),
    seedHandledProposals: vi.fn(),
    setProgress: vi.fn(),
    setLastSessionResolution: vi.fn(),
    setSessionBanner: vi.fn(),
    titleOverrides: {},
    setTitleOverrides: vi.fn(),
    stopScroll: vi.fn(),
  };
  const hook = renderHook(() => useHistoryConversation(input), { wrapper });
  return { hook, input };
}

/**
 * F2：历史装载是 scope 替换——换内容 + 滚顶之前必须先停滚动 hook，
 * 否则正文增高时 hook 按旧锁定状态把阅读位置拉回底部（真实布局竞态）。
 * 本用例锁定接线（stopScroll 被调用），真实布局行为仍需浏览器证据。
 */
describe("useHistoryConversation scope replacement", () => {
  it("stops the scroll hook before replacing turns on history load", async () => {
    const { hook, input } = setup();
    expect(hook.result.current.stickToEnd).toBe(true);

    await act(async () => {
      await hook.result.current.loadConversation("s1");
    });

    // 先停 hook，再换内容：调用顺序即防竞态的实质。
    expect(input.stopScroll).toHaveBeenCalledTimes(1);
    const stopOrder = input.stopScroll.mock.invocationCallOrder[0];
    const setTurnsOrder = input.setTurns.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(setTurnsOrder);
    expect(input.setTurns).toHaveBeenCalledWith([]);
    expect(hook.result.current.stickToEnd).toBe(false);
    // 远端无记忆时说实话，不编假存档。
    expect(input.pushSystem).toHaveBeenCalledWith(
      "该对话的 AI 记忆已不存在，无文本可载入",
    );
  });
});
