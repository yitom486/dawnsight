import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  MessagePrimitive,
  useAuiState,
  type MessageState,
  type TextMessagePartComponent,
} from "@assistant-ui/react";

import { cn } from "@dawnsight/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@dawnsight/ui/collapsible";
import {
  summarizeActivityOutcome,
  waitingLabel,
} from "../../activityStatus";
import {
  presentChatActivities,
  type ChatPresentationMode,
} from "../../presentationPolicy";
import {
  parseAssistantBlocksText,
  type AssistantAction,
} from "../../assistantBlocks";
import { blocksToPlainText } from "../../assistantBlocksText";
import type { ChatTurn } from "../../types";
import { ChatWaitingDots } from "../ChatWaitingDots";
import { RichBlockRenderer } from "../RichBlockRenderer";
import { BusinessCopyButton } from "./ChatActionBar";
import { ToolActivityView } from "./ToolViews";
import { resolveHostTurn } from "./hostTurn";

/**
 * Integrator-owned business slots. Everything app-specific (markdown entry,
 * annotation proposal UI, anchor chips, note saving) arrives here as plain
 * `ReactNode` render callbacks — this package never imports app stores,
 * Tauri APIs, or `apps/desktop` modules.
 *
 * A note on metadata: the external-store converter only preserves
 * `message.metadata.custom` (see `external-message-conversion.js` in
 * `@assistant-ui/core`), so subagent A must nest business fields
 * (turnId/errorHint/…) under `metadata.custom`. The host `ChatTurn`
 * (bound message via `getExternalStoreMessages`, else `resolveTurn`) is
 * authoritative wherever it resolves; metadata is only a fallback.
 */
export type ChatBusinessSlots = {
  /** Look up a turn by its stable id (fallback when binding yields nothing). */
  resolveTurn?: (turnId: string) => ChatTurn | undefined;
  /**
   * Render markdown through the existing Streamdown lazy entry. The
   * integrator passes e.g.
   * `(markdown, opts) => <ChatMarkdownLazy content={markdown}
   * streaming={opts?.streaming} />`. Without it, plain pre-wrap text.
   */
  renderMarkdown?: (
    markdown: string,
    opts?: { streaming?: boolean },
  ) => ReactNode;
  /** Business actions from assistant-block cards (seek / save-note / ask). */
  onAssistantAction?: (action: AssistantAction) => void;
  /** Annotation proposal UI (app owns workspace + card). */
  renderAnnotationProposal?: (turn: ChatTurn) => ReactNode;
  /** Anchor chip for the frozen question anchor of a user turn. */
  renderAnchorChip?: (anchorMs: number) => ReactNode;
  /** Extra footer controls for a done turn (e.g. 存为批注, app-owned). */
  renderMessageFooterExtra?: (turn: ChatTurn) => ReactNode;
  /**
   * Normalize the raw answer before block parsing/display/copy (e.g. restored
   * shortcut outputs whose envelope must be stripped). The integrator owns
   * the app-side normalizer; without it the raw text is used.
   */
  normalizeAnswer?: (turn: ChatTurn) => string;
};

type ChatSlotsContextValue = {
  slots: ChatBusinessSlots;
  host: ChatTurn | undefined;
  copyText: string;
  setCopyText: (text: string) => void;
};

const ChatSlotsContext = createContext<ChatSlotsContextValue | null>(null);

function useChatSlots(): ChatSlotsContextValue {
  const value = useContext(ChatSlotsContext);
  if (!value) throw new Error("ChatMessage internals must render under ChatMessage");
  return value;
}

/**
 * Route a runtime message to the Dawnsight presentation. Rendered as the
 * child function of `ThreadPrimitive.Messages`, so message-scoped
 * `useAuiState` selectors work in the whole subtree below.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  slots,
}: {
  message: MessageState;
  slots: ChatBusinessSlots;
}) {
  const host = useMemo(
    () => resolveHostTurn(message, slots.resolveTurn),
    [message, slots.resolveTurn],
  );
  const [copyText, setCopyText] = useState("");
  const contextValue = useMemo(
    () => ({ slots, host, copyText, setCopyText }),
    [slots, host, copyText],
  );

  if (message.role === "user") {
    return (
      <ChatSlotsContext.Provider value={contextValue}>
        <ChatUserMessage />
      </ChatSlotsContext.Provider>
    );
  }
  if (message.role === "assistant") {
    return (
      <ChatSlotsContext.Provider value={contextValue}>
        <ChatAssistantMessage />
      </ChatSlotsContext.Provider>
    );
  }
  // System notices stay outside the runtime (conventions §2).
  return null;
});

const UserTextPart: TextMessagePartComponent = ({ text }) => (
  <div className="whitespace-pre-wrap break-words text-[length:var(--text-chat-body)] leading-[var(--text-chat-body--line-height)]">
    {text}
  </div>
);

function ChatUserMessage() {
  const { slots, host } = useChatSlots();
  const images = host?.images ?? [];
  return (
    <MessagePrimitive.Root
      data-slot="dawnsight-chat-user-message"
      data-role="user"
      data-turn-id={host?.id}
      className="flex flex-col items-end gap-1.5"
    >
      <div className="w-fit max-w-[88%] space-y-2 rounded-lg bg-accent px-3 py-2 text-accent-foreground">
        {images.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            {images.map((image) => (
              <img
                key={image.id}
                src={image.dataUrl}
                alt="发送的图片"
                className="max-h-40 rounded-md border border-border/50 object-contain"
              />
            ))}
          </div>
        ) : null}
        <MessagePrimitive.Parts components={{ Text: UserTextPart }} />
      </div>
      {host?.anchorMs != null ? slots.renderAnchorChip?.(host.anchorMs) : null}
    </MessagePrimitive.Root>
  );
}

function ChatAssistantMessage() {
  const { host } = useChatSlots();
  return (
    <MessagePrimitive.Root
      data-slot="dawnsight-chat-assistant-message"
      data-role="assistant"
      data-turn-id={host?.id}
      className="w-full min-w-0"
    >
      <AssistantActivities />
      <MessagePrimitive.Parts
        components={{
          Text: AssistantTextPart,
          Empty: AssistantEmptyPart,
          // Tool calls never render as tool UI here: the projected
          // tool-call parts carry terminal business text only, and the
          // default fallback would leak tool names into the UI (§8).
          // Process visibility stays with the integrator via the host
          // turn's activities + the existing ChatActivityFeed.
          tools: { Override: NullToolCallPart },
        }}
      />
      <AssistantFooter />
      <AssistantAnnotationBlock />
    </MessagePrimitive.Root>
  );
}

const BUILD_PRESENTATION_MODE: ChatPresentationMode =
  import.meta.env.DEV ? "development" : "release";

/**
 * Process visibility for one assistant turn. Structure and copy mirror
 * `ChatTurnView` (dev debug trigger, release one-line outcome summary);
 * tool-kind rows render through the community `ToolActivityView`
 * (chip ↔ task row), thought/plan rows keep the `ChatActivityFeed` row
 * styling. Gated by the same `presentChatActivities` safety projection —
 * nothing unvetted reaches the screen. Waiting dots are owned by the text
 * part, not duplicated here.
 */
function AssistantActivities() {
  const { host } = useChatSlots();
  const running = useAuiState((s) => s.message.status?.type === "running");
  const [toolsOpen, setToolsOpen] = useState(false);
  if (!host) return null;
  const visibleActivities = presentChatActivities(
    host.activities,
    BUILD_PRESENTATION_MODE,
  );
  if (visibleActivities.length === 0) return null;
  const toolCount = visibleActivities.filter(
    (item) => item.kind === "tool",
  ).length;
  const showActivityFeed =
    running || (BUILD_PRESENTATION_MODE === "development" && toolsOpen);
  const doneSummary =
    !running && BUILD_PRESENTATION_MODE === "release"
      ? summarizeActivityOutcome(visibleActivities)
      : null;
  return (
    <div className="mb-2">
      <Collapsible open={showActivityFeed} onOpenChange={setToolsOpen}>
        {BUILD_PRESENTATION_MODE === "development" && !showActivityFeed ? (
          <CollapsibleTrigger className="mb-2 inline-flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {toolCount > 0
              ? `查看本轮调试记录（${toolCount} 个工具）`
              : "查看本轮调试记录"}
          </CollapsibleTrigger>
        ) : null}
        {showActivityFeed ? (
          <CollapsibleContent>
            <ActivityRows activities={visibleActivities} live={running} />
          </CollapsibleContent>
        ) : null}
      </Collapsible>
      {doneSummary ? (
        <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
          <CollapsibleTrigger className="mb-2 inline-flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {doneSummary}
            <span aria-hidden="true">{toolsOpen ? "收起" : "展开"}</span>
          </CollapsibleTrigger>
          {toolsOpen ? (
            <CollapsibleContent>
              <ActivityRows activities={visibleActivities} live={false} />
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      ) : null}
    </div>
  );
}

function ActivityRows({
  activities,
  live,
}: {
  activities: ChatTurn["activities"];
  live: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {activities.map((item) => {
        if (item.kind === "tool") {
          return (
            <ToolActivityView
              key={item.id}
              activity={item}
              defaultExpanded={live}
            />
          );
        }
        if (item.kind === "thought") {
          return (
            <div key={item.id} className="text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
                {live ? (
                  <span className="chat-tool-orbit" aria-hidden />
                ) : null}
                {item.title ?? "思考"}
              </span>
              <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap break-words">
                {item.text?.trim() || "…"}
              </p>
            </div>
          );
        }
        return (
          <div key={item.id}>
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
              {live ? <span className="chat-tool-orbit" aria-hidden /> : null}
              {item.title ?? "计划"}
            </span>
            <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-muted-foreground">
              {item.text}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function NullToolCallPart() {
  return null;
}

function AssistantEmptyPart() {
  const { host } = useChatSlots();
  const running = useAuiState((s) => s.message.status?.type === "running");
  if (!running) return null;
  return <ChatWaitingDots label={waitingLabel(host?.activities ?? [])} />;
}

const AssistantTextPart: TextMessagePartComponent = ({ text }) => {
  const { slots, host, setCopyText } = useChatSlots();
  const statusType = useAuiState((s) => s.message.status?.type);
  const customMeta = useAuiState((s) => s.message.metadata?.custom);
  const isRunning = statusType === "running";
  const isError = statusType === "incomplete" || host?.status === "error";
  const errorHint =
    host?.errorHint ??
    (typeof customMeta?.["errorHint"] === "string"
      ? customMeta["errorHint"]
      : undefined);
  const sourceText =
    host && slots.normalizeAnswer ? slots.normalizeAnswer(host) : text;

  const structured = sourceText
    ? parseAssistantBlocksText(sourceText, { streaming: isRunning })
    : null;
  const richBlocks = structured?.blocks ?? [];
  const copyableText = richBlocks.length ? blocksToPlainText(richBlocks) : sourceText;
  const displayText =
    looksLikeStructuredJson(sourceText) && richBlocks.length === 0
      ? "正在整理结构化结果…"
      : sourceText;

  useEffect(() => {
    setCopyText(isError ? "" : copyableText);
  }, [copyableText, isError, setCopyText]);

  if (!sourceText) {
    if (!isRunning) return null;
    return <ChatWaitingDots label={waitingLabel(host?.activities ?? [])} />;
  }

  return (
    <>
      <div
        className={cn(
          "w-full min-w-0 break-words text-foreground text-[length:var(--text-chat-body)] leading-[var(--text-chat-body--line-height)]",
          isError &&
            "whitespace-pre-wrap rounded-lg bg-destructive/10 px-3 py-2 text-destructive",
          !isError && isRunning && "chat-reply-streaming",
        )}
      >
        {isError ? (
          sourceText
        ) : richBlocks.length > 0 ? (
          <RichBlockRenderer
            blocks={richBlocks}
            onAction={slots.onAssistantAction}
            renderMarkdown={(markdown, opts) =>
              slots.renderMarkdown ? (
                slots.renderMarkdown(markdown, {
                  streaming: opts?.streaming ?? isRunning,
                })
              ) : (
                <span className="whitespace-pre-wrap break-words">
                  {markdown}
                </span>
              )
            }
          />
        ) : slots.renderMarkdown ? (
          slots.renderMarkdown(displayText, { streaming: isRunning })
        ) : (
          <span className="whitespace-pre-wrap break-words">
            {displayText}
          </span>
        )}
        {!isError && isRunning ? (
          <span className="chat-stream-caret ml-0.5 inline-block text-muted-foreground">
            ▍
          </span>
        ) : null}
      </div>
      {isError && errorHint ? (
        <p className="mt-1 text-[length:var(--text-chat-meta)] leading-[var(--text-chat-meta--line-height)] text-muted-foreground">
          {errorHint}
        </p>
      ) : null}
    </>
  );
};

function AssistantFooter() {
  const { slots, host, copyText } = useChatSlots();
  const statusType = useAuiState((s) => s.message.status?.type);
  const isError = statusType === "incomplete" || host?.status === "error";
  const isDone = statusType === "complete" || host?.status === "done";
  if (!isDone || isError) return null;
  const extra = host ? slots.renderMessageFooterExtra?.(host) : undefined;
  if (!copyText.trim() && !extra) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {copyText.trim() ? <BusinessCopyButton getText={() => copyText} /> : null}
      {extra}
    </div>
  );
}

function AssistantAnnotationBlock() {
  const { slots, host } = useChatSlots();
  if (!host) return null;
  if (host.annotationProposalSaved) {
    return (
      <div className="mt-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[length:var(--text-chat-meta)] leading-[var(--text-chat-meta--line-height)] text-success-foreground">
        批注已写入笔记库
      </div>
    );
  }
  if (!host.annotationProposal || !slots.renderAnnotationProposal) return null;
  return <>{slots.renderAnnotationProposal(host)}</>;
}

function looksLikeStructuredJson(value: string): boolean {
  const source = value.trimStart();
  return (
    source.startsWith("{") ||
    source.startsWith("[") ||
    /^```json\s/i.test(source)
  );
}
