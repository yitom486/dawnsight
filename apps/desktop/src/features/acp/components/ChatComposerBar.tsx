import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { ArrowUp, ListPlus, Loader2, Zap } from "lucide-react";

import { Button } from "@dawnsight/ui/button";
import { cn } from "@dawnsight/ui/utils";
import { Textarea } from "@dawnsight/ui/textarea";

import type { AcpStatus, ChatImageAttachment } from "../types";
import { previewQueuedText, type QueuedPrompt } from "@dawnsight/chat-ui/promptQueue";
import { focusComposerTextarea } from "@dawnsight/chat-ui/components/composerFocus";
import { ChatColumn } from "@dawnsight/chat-ui/components/ChatShell";
import { ComposerModelControls } from "./ComposerModelControls";

type Props = {
  value: string;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  status: AcpStatus | undefined;
  sessionConnected?: boolean;
  queue?: QueuedPrompt[];
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  onBargeIn?: () => void;
  onRemoveQueued?: (id: string) => void;
  onClearQueue?: () => void;
  attachments?: ChatImageAttachment[];
  onPasteImages?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
};

export type ChatComposerBarHandle = {
  focusInput: () => void;
};

export const ChatComposerBar = forwardRef<ChatComposerBarHandle, Props>(
  function ChatComposerBar(
    {
      value,
      disabled,
      busy,
      placeholder = "输入问题…",
      status,
      sessionConnected,
      queue = [],
      onChange,
      onSend,
      onCancel,
      onBargeIn,
      onRemoveQueued,
      onClearQueue,
      attachments = [],
      onPasteImages,
      onRemoveAttachment,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const wasBusyRef = useRef(false);

    const focusInput = useCallback(() => {
      focusComposerTextarea(textareaRef.current);
    }, []);

    useImperativeHandle(ref, () => ({ focusInput }), [focusInput]);

    useEffect(() => {
      if (wasBusyRef.current && !busy && !disabled) {
        focusInput();
      }
      wasBusyRef.current = Boolean(busy);
    }, [busy, disabled, focusInput]);

    const hasText = value.trim().length > 0;
    const hasImages = attachments.length > 0;
    const canSendIdle = !disabled && !busy && (hasText || hasImages);
    const canEnqueue = !disabled && Boolean(busy) && (hasText || hasImages);
    const canBargeIn = canEnqueue && Boolean(onBargeIn);
    const canPrimarySend = busy ? canEnqueue : canSendIdle;

    return (
      <ChatColumn className="shrink-0 border-t border-border py-3">
        {queue.length > 0 ? (
          <div className="mb-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[length:var(--text-ui-label)] text-muted-foreground">
                排队 {queue.length} 条 · 当前回合结束后自动发送
              </p>
              {onClearQueue ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 rounded-none px-1 py-0 text-[length:var(--text-ui-label)] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
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
                  className="flex items-center gap-2 text-[length:var(--text-ui-label)] text-foreground"
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
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 rounded-none px-1 py-0 text-[length:var(--text-ui-label)] font-normal text-muted-foreground hover:bg-transparent hover:text-destructive"
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

        <div
          className={cn(
            "rounded-lg border border-border bg-background",
            busy && "chat-composer-active p-px",
          )}
        >
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative shrink-0">
                  <img
                    src={attachment.dataUrl}
                    alt="粘贴的图片"
                    className="size-14 rounded-md border border-border object-cover"
                  />
                  {onRemoveAttachment ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="移除图片"
                      className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-muted p-0 text-[length:var(--text-ui-label)] font-normal leading-none text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={() => onRemoveAttachment(attachment.id)}
                    >
                      ×
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <Textarea
            ref={textareaRef}
            className={cn(
              "min-h-[72px] w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm",
              "outline-none focus-visible:ring-0",
              "disabled:opacity-60",
              busy && "bg-muted/20",
            )}
            placeholder={
              busy
                ? "回复进行中：Enter 排队，Ctrl+Enter 插队发送…"
                : placeholder
            }
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter(
                (file) => file.type.startsWith("image/"),
              );
              if (files.length === 0 || !onPasteImages) return;
              e.preventDefault();
              onPasteImages(files);
            }}
            onKeyDown={(e) => {
              if (
                e.key !== "Enter" || e.shiftKey || e.defaultPrevented ||
                e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
              ) return;
              e.preventDefault();
              if ((e.ctrlKey || e.metaKey) && canBargeIn) {
                onBargeIn?.();
                return;
              }
              if (canPrimarySend) onSend();
            }}
          />

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border/70 px-2 py-1.5">
            <ComposerModelControls status={status} busy={busy} sessionConnected={sessionConnected} />
            <div className="ml-auto flex items-center gap-1">
              {busy ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label="取消当前回合"
                  title="取消当前回合（队列保留）"
                  onClick={() => onCancel?.()}
                >
                  <span className="text-[length:var(--text-ui-label)]">取消</span>
                </Button>
              ) : null}
              {busy && onBargeIn ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2 text-[length:var(--text-ui-label)]"
                  disabled={!canBargeIn}
                  aria-label="插队发送"
                  title="打断当前回合并优先发送（Ctrl+Enter）"
                  onClick={() => onBargeIn()}
                >
                  <Zap className="size-3.5" />
                  插队
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon"
                className="size-8 shrink-0 rounded-full"
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
      </ChatColumn>
    );
  },
);
