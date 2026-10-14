import type { ReactNode, Ref } from "react";
import { ArrowDown } from "lucide-react";
import {
  AuiIf,
  ThreadPrimitive,
} from "@assistant-ui/react";

import { cn } from "@dawnsight/ui";
import { ChatMessage, type ChatBusinessSlots } from "./ChatMessage";

export type { ChatBusinessSlots };

export type ChatThreadProps = {
  /**
   * Forwarded straight to the `ThreadPrimitive.Viewport` element.
   * Verified: `ThreadPrimitive.Viewport` is a `ForwardRefExoticComponent`
   * with `RefAttributes<HTMLDivElement>` (ThreadViewport.d.ts), so the ref
   * lands on the scroll container. The integrator uses it for mount-follow
   * and send-time scrolls (instant). Fallback handle, if ever needed:
   * `root.querySelector('[data-slot="dawnsight-chat-viewport"]')`.
   */
  viewportRef?: Ref<HTMLDivElement>;
  autoScroll?: boolean;
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Integrator-owned composer (D's Composer), rendered in the footer. */
  composer: ReactNode;
  /** Empty-state slot (no messages). Defaults to a quiet product welcome. */
  welcome?: ReactNode;
  /** Optional banner row above the messages (session / profile state). */
  sessionBanner?: ReactNode;
  /** Business slots + callbacks, passed through to every message. */
  components?: ChatBusinessSlots;
};

/**
 * Dawnsight chat thread: assistant-ui structure, product visuals.
 *
 * Composes `ThreadPrimitive.Root/Viewport/Messages` + `ViewportFooter`
 * (NOT the stock registry Thread). `Viewport` is the ONLY scroll controller
 * here. Rendered primitives: `ScrollToBottom` (replaces the old 回到最新
 * button — the primitive hides itself at the bottom), message-scoped copy
 * via `BusinessCopyButton`. Deliberately absent: edit / reload /
 * branch-picker / feedback / voice / suggestion primitives, and
 * `MessagePrimitive.Error` (it renders runtime error text, not our business
 * `errorHint` — error turns use the custom block in `ChatMessage`).
 */
export function ChatThread({
  viewportRef,
  autoScroll = true,
  onAtBottomChange,
  composer,
  welcome,
  sessionBanner,
  components,
}: ChatThreadProps) {
  const slots = components ?? {};
  return (
    <ThreadPrimitive.Root
      data-slot="dawnsight-chat-thread"
      className="flex h-full min-h-0 flex-col"
    >
      <ThreadPrimitive.Viewport
        ref={viewportRef}
        autoScroll={autoScroll}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
        scrollToBottomOnRunStart={false}
        onScroll={(event) => {
          const element = event.currentTarget;
          onAtBottomChange?.(element.scrollHeight - element.scrollTop - element.clientHeight <= 16);
        }}
        data-slot="dawnsight-chat-viewport"
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
          {sessionBanner}
          <AuiIf condition={(s) => s.thread.messages.length === 0}>
            {welcome ?? <ChatDefaultWelcome />}
          </AuiIf>
          <div
            data-slot="dawnsight-chat-messages"
            className="flex flex-col gap-6 py-4 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <ChatMessage message={message} slots={slots} />
              )}
            </ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter
            className={cn(
              "sticky bottom-0 mt-auto flex flex-col gap-2 bg-background pt-2 pb-4",
            )}
          >
            <ThreadPrimitive.ScrollToBottom
              aria-label="回到最新"
              title="回到最新"
              className="absolute -top-12 z-10 inline-flex size-8 items-center justify-center self-center rounded-full border border-border bg-background text-muted-foreground shadow-md transition-colors hover:border-ai/40 hover:text-foreground disabled:invisible [&_svg]:size-4"
            >
              <ArrowDown />
            </ThreadPrimitive.ScrollToBottom>
            {composer}
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function ChatDefaultWelcome() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-[length:var(--text-chat-body)] leading-[var(--text-chat-body--line-height)] font-medium text-foreground">
        开始新的观影对话
      </p>
      <p className="text-[length:var(--text-chat-meta)] leading-[var(--text-chat-meta--line-height)] text-muted-foreground">
        在下方输入问题，AI 会结合当前视频回答
      </p>
    </div>
  );
}
