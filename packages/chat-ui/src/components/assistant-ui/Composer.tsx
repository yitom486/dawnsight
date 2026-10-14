import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import { ComposerPrimitive, useAui } from "@assistant-ui/react";
import { ArrowUp, ListPlus, Loader2, Zap } from "lucide-react";
import { Button } from "@dawnsight/ui/button";

import { focusComposerTextarea } from "../composerFocus";
import { previewQueuedText, type QueuedPrompt } from "../../promptQueue";
import type { ChatImageAttachment } from "../../types";
import { ComposerAttachmentStrip } from "./Attachments";

export type AssistantComposerHandle = {
  focusInput: () => void;
};

export type AssistantComposerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  queue?: QueuedPrompt[];
  onRemoveQueued?: (id: string) => void;
  onClearQueue?: () => void;
  attachments?: ChatImageAttachment[];
  onPasteImages?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onSend: () => void;
  onBargeIn?: () => void;
  onCancel?: () => void;
  /** App-owned model/permission controls row slot. */
  controls?: ReactNode;
};

const BUSY_PLACEHOLDER = "回复进行中：Enter 排队，Ctrl+Enter 插队发送…";

/**
 * Assistant-ui composer binding. Owns the draft textarea plus the queue panel
 * and attachment strip; the integrator owns the draft state, the prompt queue
 * machine, model/permission controls (via `controls`), and send/enqueue/
 * barge-in/cancel routing (via `onSend`/`onBargeIn`/`onCancel`).
 *
 * Controlled-input note (verified against the installed
 * `@assistant-ui/react@0.15.28` typings + implementation):
 * `ComposerPrimitive.Input` props are `TextareaAutosizeProps & BaseProps &
 * SubmitModeProps` (`primitives/composer/ComposerInput.d.ts`), so standard
 * textarea props (`value`, `onChange`, `onKeyDownCapture`, `onPasteCapture`,
 * `disabled`, `placeholder`, `className`) pass through. In the implementation
 * (`ComposerInput.js`) user `onChange`/`onKeyDown`/`onPaste` are composed
 * *before* the internal handlers via `composeEventHandlers`, and a user-passed
 * `value` (spread via `...rest` after the internal `value`) wins for display
 * while the internal composer store mirrors each keystroke through the
 * composed `onChange`. So a controlled `value`/`onChange` pair is truthful
 * here. `submitMode="none"` keeps the runtime's own Enter-to-submit path
 * (including its steer/queue branch in `handleKeyPress`) inert, and
 * `addAttachmentOnPaste={false}` keeps the runtime attachment path off —
 * image paste is ours, text send is the integrator's `onSend` (runtime `onNew`
 * is text-only by contract; sending attachments travels with `onSend`).
 */
export const AssistantComposer = forwardRef<
  AssistantComposerHandle,
  AssistantComposerProps
>(function AssistantComposer(
  {
    value,
    onChange,
    placeholder = "输入问题…",
    disabled,
    busy,
    queue = [],
    onRemoveQueued,
    onClearQueue,
    attachments = [],
    onPasteImages,
    onRemoveAttachment,
    onSend,
    onBargeIn,
    onCancel,
    controls,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const aui = useAui();
  // Host draft is authoritative, including clear/restore/scope changes.
  // The primitive's internal mirror otherwise retains the last typed value.
  useLayoutEffect(() => {
    if (aui.composer.getState().text !== value) aui.composer.setText(value);
  }, [aui, value]);

  const focusInput = useCallback(() => {
    focusComposerTextarea(textareaRef.current);
  }, []);

  useImperativeHandle(ref, () => ({ focusInput }), [focusInput]);

  // Enablement rules ported from ChatComposerBar (same names, same gates).
  const hasText = value.trim().length > 0;
  const hasImages = attachments.length > 0;
  const canSendIdle = !disabled && !busy && (hasText || hasImages);
  const canEnqueue = !disabled && Boolean(busy) && (hasText || hasImages);
  const canBargeIn = canEnqueue && Boolean(onBargeIn);
  const canPrimarySend = busy ? canEnqueue : canSendIdle;

  // onKeyDown/onPaste semantics ported byte-for-byte from ChatComposerBar,
  // hoisted to CAPTURE handlers so the runtime's composed bubble handlers can
  // never swallow queue-by-Enter (capture fires first; stopPropagation keeps
  // the runtime's handleKeyPress/handlePaste out entirely).
  const handleKeyDownCapture = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key !== "Enter" ||
        e.shiftKey ||
        e.defaultPrevented ||
        e.nativeEvent.isComposing ||
        e.nativeEvent.keyCode === 229
      )
        return;
      if ((e.ctrlKey || e.metaKey) && canBargeIn) {
        onBargeIn?.();
      } else if (canPrimarySend) {
        onSend();
      }
      e.preventDefault();
      e.stopPropagation();
    },
    [canBargeIn, canPrimarySend, onBargeIn, onSend],
  );

  const handlePasteCapture = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0 || !onPasteImages) return;
      e.preventDefault();
      e.stopPropagation();
      onPasteImages(files);
    },
    [onPasteImages],
  );

  const handleSubmit = useCallback((e: ReactFormEvent) => {
    // The form never submits: actions are plain type="button" controls and
    // Enter is owned by the capture handler above. Belt-and-braces so a
    // runtime requestSubmit can never dispatch a text-only onNew behind us.
    e.preventDefault();
  }, []);

  return (
    <div className="w-full">
      {queue.length > 0 ? (
        <div className="mb-2 rounded-xl border border-border/70 bg-muted/30 px-2.5 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[length:var(--text-chat-meta)] text-muted-foreground">
              排队 {queue.length} 条 · 当前回合结束后自动发送
            </p>
            {onClearQueue ? (
              <Button variant="ghost" size="sm"
                type="button"
                className="h-7 shrink-0 rounded-md px-1 py-0 text-[length:var(--text-chat-meta)] font-normal text-muted-foreground hover:text-foreground"
                onClick={onClearQueue}
              >
                清空
              </Button>
            ) : null}
          </div>
          <ul className="space-y-1">
            {queue.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-2 text-[length:var(--text-chat-meta)] text-foreground"
              >
                <span className="shrink-0 text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {item.images && item.images.length > 0
                    ? `图片×${item.images.length} ${previewQueuedText(item.text)}`
                    : previewQueuedText(item.text)}
                </span>
                {onRemoveQueued ? (
                  <Button variant="ghost" size="sm"
                    type="button"
                    className="h-7 shrink-0 rounded-md px-1 py-0 text-[length:var(--text-chat-meta)] font-normal text-muted-foreground hover:text-destructive"
                    aria-label="移除排队"
                    onClick={() => onRemoveQueued(item.id)}
                  >
                    移除
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ComposerPrimitive.Root onSubmit={handleSubmit}>
        <div
          className={
            busy
              ? "rounded-xl border border-ai/60 bg-background transition-colors"
              : "rounded-xl border border-border bg-background transition-colors focus-within:border-ai/60"
          }
        >
          <ComposerAttachmentStrip
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
          />
          <ComposerPrimitive.Input
            ref={textareaRef}
            value={value}
            disabled={disabled}
            placeholder={busy ? BUSY_PLACEHOLDER : placeholder}
            submitMode="none"
            addAttachmentOnPaste={false}
            cancelOnEscape={false}
            unstable_focusOnRunStart={false}
            unstable_focusOnScrollToBottom={false}
            unstable_focusOnThreadSwitched={false}
            minRows={2}
            maxRows={8}
            onChange={(e) => onChange(e.target.value)}
            onKeyDownCapture={handleKeyDownCapture}
            onPasteCapture={handlePasteCapture}
            className="min-h-[64px] w-full resize-none bg-transparent px-3 py-2 text-[length:var(--text-chat-body)] leading-[1.7] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border/70 px-2 py-1.5">
            {controls ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                {controls}
              </div>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              {busy ? (
                <Button variant="ghost" size="sm"
                  type="button"
                  className="h-8 shrink-0 rounded-md px-2 text-[length:var(--text-chat-meta)] text-muted-foreground hover:text-foreground"
                  aria-label="取消当前回合"
                  title="取消当前回合（队列保留）"
                  onClick={() => onCancel?.()}
                >
                  取消
                </Button>
              ) : null}
              {busy && onBargeIn ? (
                <Button variant="ghost" size="sm"
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-[length:var(--text-chat-meta)] text-foreground disabled:opacity-50"
                  disabled={!canBargeIn}
                  aria-label="插队发送"
                  title="打断当前回合并优先发送（Ctrl+Enter）"
                  onClick={() => onBargeIn()}
                >
                  <Zap className="size-3.5" />
                  插队
                </Button>
              ) : null}
              <Button variant="default" size="icon"
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
                disabled={!canPrimarySend}
                aria-label={busy ? "加入排队" : "发送"}
                title={busy ? "加入排队（Enter）" : "发送（Enter）"}
                onClick={onSend}
              >
                {busy ? (
                  canEnqueue ? (
                    <ListPlus className="size-4" />
                  ) : (
                    <Loader2 className="size-4 animate-spin" />
                  )
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
});
