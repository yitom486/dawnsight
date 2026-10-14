import { useQueryClient } from "@tanstack/react-query";
import { memo, useState } from "react";

import { Button } from "@dawnsight/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@dawnsight/ui/collapsible";
import { cn } from "@dawnsight/ui/utils";
import { errorMessage, formatTime } from "@/lib/format";

import { AnnotationProposalCard } from "@/features/notes/components/AnnotationProposalCard";
import { createNote } from "@/features/notes/api";
import { notesKey } from "@dawnsight/query-keys";
import { usePlayerStore } from "@/features/player";

import { waitingLabel } from "@dawnsight/chat-ui/activityStatus";
import { summarizeActivityOutcome } from "@dawnsight/chat-ui/activityStatus";
import {
  presentChatActivities,
  type ChatPresentationMode,
} from "@dawnsight/chat-ui/presentationPolicy";
import type { AssistantAction } from "@dawnsight/chat-ui/assistantBlocks";
import { parseAssistantBlocksText } from "@dawnsight/chat-ui/assistantBlocks";
import { RichBlockRenderer } from "@dawnsight/chat-ui/components/RichBlockRenderer";
import { blocksToPlainText } from "@dawnsight/chat-ui/assistantBlocksText";
import type { ChatTurn } from "../types";
import { normalizeRestoredShortcutOutput } from "../shortcutOutput";
import { ChatActivityFeed } from "@dawnsight/chat-ui/components/ChatActivityFeed";
import { ChatColumn } from "@dawnsight/chat-ui/components/ChatShell";
import { ChatWaitingDots } from "@dawnsight/chat-ui/components/ChatWaitingDots";
import { ChatMarkdownLazy } from "./ChatMarkdownLazy";

type Props = {
  turn: ChatTurn;
  annotationWorkspace?: string | null;
  onDismissAnnotation?: (turnId: string) => void;
  onSaveAnnotation?: (turnId: string, proposalId?: string) => void;
  onAssistantAction?: (action: AssistantAction) => void;
  /** Tests may choose a mode; production derives it once from the Vite build. */
  presentationMode?: ChatPresentationMode;
};

const BUILD_PRESENTATION_MODE: ChatPresentationMode = import.meta.env.DEV
  ? "development"
  : "release";

/**
 * Done-turn message action: copy the VISIBLE text, never the internal JSON.
 * Rich answers export their verified blocks as plain text (same data the
 * renderer shows); plain answers copy as-is. Clipboard denial gets a short
 * business note — never silence, never technical details.
 */
function CopyAnswerButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [denied, setDenied] = useState(false);

  if (!text.trim()) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-none px-1 py-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        aria-label="复制回答"
        onClick={() => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDenied(false);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              setDenied(true);
            }
          })();
        }}
      >
        {copied ? "已复制" : "复制"}
      </Button>
      {denied ? (
        <span className="text-[11px] text-muted-foreground">复制失败，请重试</span>
      ) : null}
    </span>
  );
}

/**
 * P6-M3: save any done answer as a note (two-step inline confirm, no dialog
 * over video). Reuses the confirm-before-write chain; QuickNoteDialog keeps
 * its live-position semantics untouched.
 *
 * QueryClient is only touched inside the mounted confirm step, so turns
 * rendered without a query context (tests, history previews) keep working.
 */
export function SaveAnswerNote({ turn }: { turn: ChatTurn }) {
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  if (turn.status !== "done" || !turn.answer.trim()) return null;
  if (saved) {
    return (
      <p className="text-[11px] text-success">
        已保存为批注
      </p>
    );
  }
  if (!confirming) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-none px-1 py-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setConfirming(true)}
      >
        存为批注
      </Button>
    );
  }
  return (
    <ConfirmSaveNote
      turn={turn}
      onSaved={() => {
        setConfirming(false);
        setSaved(true);
      }}
      onCancel={() => setConfirming(false)}
    />
  );
}

function ConfirmSaveNote({  turn,
  onSaved,
  onCancel,
}: {
  turn: ChatTurn;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const store = usePlayerStore.getState();
  const anchorMs = turn.anchorMs ?? store.currentTimeMs;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">
        保存到 {formatTime(anchorMs)} 的批注？
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-none px-1 py-0 font-medium text-info hover:bg-transparent hover:text-info-foreground disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          void (async () => {
            const live = usePlayerStore.getState();
            const mediaPath = live.currentFile;
            if (!mediaPath) {
              setError("请先打开视频");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await createNote({
                mediaPath,
                positionMs: turn.anchorMs ?? live.currentTimeMs,
                body: turn.answer.trim(),
                includeQuotes: false,
              });
              await queryClient.invalidateQueries({
                queryKey: notesKey(mediaPath),
              });
              onSaved();
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        {busy ? "保存中…" : "保存"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-none px-1 py-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        disabled={busy}
        onClick={onCancel}
      >
        取消
      </Button>
      {error ? <span className="text-destructive">{error}</span> : null}
    </span>
  );
}

export const ChatTurnView = memo(function ChatTurnView({
  turn,
  annotationWorkspace,
  onDismissAnnotation,
  onSaveAnnotation,
  onAssistantAction,
  presentationMode = BUILD_PRESENTATION_MODE,
}: Props) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const isError = turn.status === "error";
  const isStreaming = turn.status === "streaming";
  // 工具执行不再清空已展示的安全正文：过程 feed 在上、正文在下并行展示，
  // thought/半截 JSON/未校验结构化数据仍由各自环节隐藏（见下）。
  const visibleAnswer = turn.answer;
  const waitingForText = isStreaming && !visibleAnswer.trim();
  const showWaitingDots =
    waitingForText && !(turn.showActivities && turn.activities.length > 0);
  const visibleActivities = presentChatActivities(
    turn.activities,
    presentationMode,
  );
  const toolCount = visibleActivities.filter((item) => item.kind === "tool").length;
  const showActivityFeed =
    visibleActivities.length > 0 &&
    (isStreaming || (presentationMode === "development" && toolsOpen));
  // 正式模式完成后保留一行可展开的可信业务过程摘要（无活动记录的历史
  // 回答不编造）。展开内容继续经 presentChatActivities 安全投影。
  const doneSummary =
    !isStreaming && !isError && presentationMode === "release"
      ? summarizeActivityOutcome(visibleActivities)
      : null;
  const restoredShortcut =
    !isError && !isStreaming && visibleAnswer
      ? normalizeRestoredShortcutOutput(visibleAnswer)
      : null;
  const normalizedAnswer = restoredShortcut?.answer ?? visibleAnswer;
  const structuredAnswer =
    !isError && normalizedAnswer
      ? parseAssistantBlocksText(normalizedAnswer, { streaming: isStreaming })
      : null;
  const richBlocks = structuredAnswer?.blocks ?? [];
  // 复制永远拿用户看到的文字：富回答导出已验证 blocks 的纯文本，
  // 纯文本回答沿用原文。绝不复制内部 JSON 信封（F4）。
  const copyableAnswerText = richBlocks.length
    ? blocksToPlainText(richBlocks)
    : normalizedAnswer;
  const answerText =
    (looksLikeStructuredJson(normalizedAnswer) && !richBlocks.length
      ? "正在整理结构化结果…"
      : normalizedAnswer);
  const releaseLiveLabel =
    presentationMode === "release"
      ? visibleActivities.find((item) => item.kind === "tool")?.title
      : undefined;

  return (
    <ChatColumn className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[88%] space-y-2 rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground whitespace-pre-wrap break-words">
          {turn.images && turn.images.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {turn.images.map((image) => (
                <img
                  key={image.id}
                  src={image.dataUrl}
                  alt="发送的图片"
                  className="max-h-40 rounded-md border border-border/50 object-contain"
                />
              ))}
            </div>
          ) : null}
          {turn.userText}
        </div>
      </div>

      <div className="w-full">
        {visibleActivities.length > 0 ? (
          <Collapsible open={showActivityFeed} onOpenChange={setToolsOpen}>
            {presentationMode === "development" && !showActivityFeed ? (
              <CollapsibleTrigger className="mb-2 inline-flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {toolCount > 0
                  ? `查看本轮调试记录（${toolCount} 个工具）`
                  : "查看本轮调试记录"}
              </CollapsibleTrigger>
            ) : null}

            {showActivityFeed ? (
              <CollapsibleContent>
                <ChatActivityFeed
                  activities={visibleActivities}
                  streaming={isStreaming}
                  collapsible={!isStreaming}
                  liveLabel={releaseLiveLabel}
                  onRequestCollapse={
                    !isStreaming ? () => setToolsOpen(false) : undefined
                  }
                />
              </CollapsibleContent>
            ) : null}
          </Collapsible>
        ) : null}

        {doneSummary ? (
          <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
            <CollapsibleTrigger className="mb-2 inline-flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {doneSummary}
              <span aria-hidden="true">{toolsOpen ? "收起" : "展开"}</span>
            </CollapsibleTrigger>
            {toolsOpen ? (
              <CollapsibleContent>
                <ChatActivityFeed
                  activities={visibleActivities}
                  collapsible={false}
                />
              </CollapsibleContent>
            ) : null}
          </Collapsible>
        ) : null}

        <div
          className={cn(
            "w-full px-0 py-1 text-sm break-words text-foreground",
            isError && "rounded-lg bg-destructive/10 px-3 py-2 text-destructive whitespace-pre-wrap",
            isStreaming && !isError && "chat-reply-streaming",
          )}
          data-turn-id={turn.id}
        >
          {answerText ? (
            isError ? (
              answerText
            ) : richBlocks.length ? (
              <RichBlockRenderer
                blocks={richBlocks}
                onAction={onAssistantAction}
                renderMarkdown={(markdown, opts) => (
                  <ChatMarkdownLazy
                    content={markdown}
                    streaming={opts?.streaming ?? isStreaming}
                  />
                )}
              />
            ) : (
              <ChatMarkdownLazy content={answerText} streaming={isStreaming} />
            )
          ) : showWaitingDots ? (
            <ChatWaitingDots label={waitingLabel(turn.activities)} />
          ) : waitingForText ? null : (
            ""
          )}
          {answerText && isStreaming ? (
            <span className="chat-stream-caret ml-0.5 inline-block text-muted-foreground">
              ▍
            </span>
          ) : null}
        </div>
        {isError && turn.errorHint ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {turn.errorHint}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SaveAnswerNote turn={turn} />
          {!isError && turn.status === "done" ? (
            <CopyAnswerButton text={copyableAnswerText} />
          ) : null}
        </div>
        {turn.annotationProposalSaved ? (
          <div className="mt-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[12px] text-success-foreground">
            批注已写入笔记库
          </div>
        ) : turn.annotationProposal && annotationWorkspace ? (
          <AnnotationProposalCard
            className="mt-2"
            proposal={turn.annotationProposal}
            workspace={annotationWorkspace}
            onDismiss={() => onDismissAnnotation?.(turn.id)}
            onSaved={() =>
              onSaveAnnotation?.(
                turn.id,
                turn.annotationProposal?.proposalId,
              )
            }
          />
        ) : null}
      </div>
    </ChatColumn>
  );
});

function looksLikeStructuredJson(value: string): boolean {
  const source = value.trimStart();
  return source.startsWith("{") || source.startsWith("[") || /^```json\s/i.test(source);
}
