import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { ArrowUp, ListPlus, Loader2, Zap } from "lucide-react";

import { Button } from "@lumina/ui/button";
import { Checkbox } from "@lumina/ui/checkbox";
import { cn } from "@lumina/ui/utils";
import { Input } from "@lumina/ui/input";
import { Label } from "@lumina/ui/label";
import { NativeSelect, NativeSelectOption } from "@lumina/ui/native-select";
import { Textarea } from "@lumina/ui/textarea";

import type { AcpStatus, ChatImageAttachment, PermissionMode } from "../types";
import { previewQueuedText, type QueuedPrompt } from "@lumina/chat-ui/promptQueue";
import { useAgentModelControls } from "../useAgentModelControls";
import { useCursorConfigControls } from "../useCursorConfigControls";
import {
  currentBooleanValue,
  currentSelectValue,
} from "@lumina/chat-ui/modelConfig";
import type { SessionConfigOption } from "@lumina/chat-ui/types";
import { focusComposerTextarea } from "@lumina/chat-ui/components/composerFocus";
import { ChatColumn } from "@lumina/chat-ui/components/ChatShell";

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

const compactSelectClassName =
  "max-w-[9.5rem] [&_[data-slot=native-select]]:h-7 [&_[data-slot=native-select]]:truncate [&_[data-slot=native-select]]:bg-background [&_[data-slot=native-select]]:px-2 [&_[data-slot=native-select]]:text-[11px] [&_[data-slot=native-select]]:focus-visible:ring-1";

/**
 * 参数化 Agent（cursor）的一个 select 维度。值绑定 agent 下发的 current，
 * 空位表示“不动、沿用 agent 默认”（空值从不下发，listed 门槛在 hook 里卡）。
 */
function CursorDimSelect({
  option,
  emptyLabel,
  disabled,
  onPick,
}: {
  option: SessionConfigOption;
  emptyLabel: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  if (option.kind.kind !== "select") return null;
  const values = option.kind.options;
  return (
    <NativeSelect
      size="sm"
      className={compactSelectClassName}
      value={currentSelectValue(option)}
      disabled={disabled}
      aria-label={emptyLabel}
      title={option.description ?? option.name}
      onChange={(e) => {
        const next = e.target.value;
        if (!next) return;
        onPick(next);
      }}
    >
      <NativeSelectOption value="">{emptyLabel}</NativeSelectOption>
      {values.map((item) => (
        <NativeSelectOption key={item.value} value={item.value} title={item.description ?? undefined}>
          {item.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

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
    const {
      permissionMode,
      modelId,
      reasoningEffort,
      modelOptions,
      reasoningOptions,
      controlsDisabled,
      controlError,
      hasModelOptions,
      hasReasoningOptions,
      patchSettings,
      applyModelSelection,
    } = useAgentModelControls({
      status,
      busy,
      sessionConnected,
    });
    const cursor = useCursorConfigControls({
      status,
      busy,
      sessionConnected,
    });

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
              <p className="text-[11px] text-muted-foreground">
                排队 {queue.length} 条 · 当前回合结束后自动发送
              </p>
              {onClearQueue ? (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={onClearQueue}
                >
                  清空
                </button>
              ) : null}
            </div>
            <ul className="space-y-1">
              {queue.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 text-[11px] text-foreground"
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
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
                      aria-label="移除排队"
                      onClick={() => onRemoveQueued(item.id)}
                    >
                      移除
                    </button>
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
                    <button
                      type="button"
                      aria-label="移除图片"
                      className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-muted text-[10px] leading-none text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveAttachment(attachment.id)}
                    >
                      ×
                    </button>
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
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              if ((e.ctrlKey || e.metaKey) && canBargeIn) {
                onBargeIn?.();
                return;
              }
              if (canPrimarySend) onSend();
            }}
          />

          <div className="flex items-center gap-1.5 border-t border-border/70 px-2 py-1.5">
            <NativeSelect
              size="sm"
              className={cn(compactSelectClassName, "max-w-[7.5rem]")}
              value={permissionMode}
              disabled={controlsDisabled}
              aria-label="权限模式"
              onChange={(e) =>
                patchSettings({
                  permissionMode: e.target.value as PermissionMode,
                })
              }
            >
              <NativeSelectOption value="auto">自动批准</NativeSelectOption>
              <NativeSelectOption value="ask">每次询问</NativeSelectOption>
            </NativeSelect>

            {cursor.hasCursorDims ? (
              <>
                {cursor.dims.mode ? (
                  <CursorDimSelect
                    option={cursor.dims.mode}
                    emptyLabel="模式"
                    disabled={cursor.controlsDisabled}
                    onPick={(value) =>
                      void cursor.applyConfigOption(cursor.dims.mode?.id ?? "", value)
                    }
                  />
                ) : null}
                {cursor.dims.model ? (
                  <CursorDimSelect
                    option={cursor.dims.model}
                    emptyLabel="模型"
                    disabled={cursor.controlsDisabled}
                    onPick={(value) =>
                      void cursor.applyConfigOption(cursor.dims.model?.id ?? "", value)
                    }
                  />
                ) : null}
                {cursor.dims.effort ? (
                  <CursorDimSelect
                    option={cursor.dims.effort}
                    emptyLabel="思考"
                    disabled={cursor.controlsDisabled}
                    onPick={(value) =>
                      void cursor.applyConfigOption(cursor.dims.effort?.id ?? "", value)
                    }
                  />
                ) : null}
                {cursor.dims.context ? (
                  <CursorDimSelect
                    option={cursor.dims.context}
                    emptyLabel="上下文"
                    disabled={cursor.controlsDisabled}
                    onPick={(value) =>
                      void cursor.applyConfigOption(cursor.dims.context?.id ?? "", value)
                    }
                  />
                ) : null}
                {cursor.dims.fastToggle &&
                cursor.dims.fastToggle.kind.kind === "boolean" ? (
                  <Label
                    className="flex shrink-0 cursor-pointer items-center gap-1 px-1 text-[11px] text-muted-foreground hover:text-foreground"
                    title={cursor.dims.fastToggle.description ?? "Fast 模式"}
                  >
                    <Checkbox
                      checked={currentBooleanValue(cursor.dims.fastToggle)}
                      disabled={cursor.controlsDisabled}
                      aria-label="Fast"
                      onCheckedChange={(checked) => {
                        const id = cursor.dims.fastToggle?.id ?? "";
                        void cursor.applyConfigOption(
                          id,
                          checked === true ? "true" : "false",
                        );
                      }}
                    />
                    Fast
                  </Label>
                ) : null}
                {cursor.dims.fastSelect ? (
                  <CursorDimSelect
                    option={cursor.dims.fastSelect}
                    emptyLabel={cursor.dims.fastSelect.name || "更多设置"}
                    disabled={cursor.controlsDisabled}
                    onPick={(value) =>
                      void cursor.applyConfigOption(
                        cursor.dims.fastSelect?.id ?? "",
                        value,
                      )
                    }
                  />
                ) : null}
              </>
            ) : (
              <>
                {hasModelOptions ? (
                  <NativeSelect
                    size="sm"
                    className={compactSelectClassName}
                    value={modelId}
                    disabled={controlsDisabled}
                    aria-label="模型"
                    onChange={(e) => {
                      void applyModelSelection({ modelId: e.target.value });
                    }}
                  >
                    <NativeSelectOption value="">Agent 默认</NativeSelectOption>
                    {modelOptions.map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    className="h-7 min-w-[7rem] max-w-[9.5rem] rounded-md px-2 text-[11px]"
                    value={modelId}
                    disabled={controlsDisabled}
                    placeholder="模型 ID"
                    aria-label="模型 ID"
                    onChange={(e) => patchSettings({ modelId: e.target.value })}
                    onBlur={() => {
                      if (modelId.trim()) {
                        void applyModelSelection({ modelId });
                      }
                    }}
                  />
                )}

                {hasReasoningOptions ? (
                  <NativeSelect
                    size="sm"
                    className={compactSelectClassName}
                    value={reasoningEffort}
                    disabled={controlsDisabled}
                    aria-label="思考程度"
                    onChange={(e) => {
                      void applyModelSelection({ reasoningEffort: e.target.value });
                    }}
                  >
                    <NativeSelectOption value="">默认</NativeSelectOption>
                    {reasoningOptions.map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : null}
              </>
            )}

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
                  <span className="text-[11px]">取消</span>
                </Button>
              ) : null}
              {busy && onBargeIn ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2 text-[11px]"
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

        {controlError ?? cursor.controlError ? (
          <p className="mt-1 text-[10px] leading-relaxed text-destructive">
            {controlError ?? cursor.controlError}
          </p>
        ) : cursor.applying ? (
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            正在应用 Agent 配置…（cursor 切换模型需要几秒，请稍候）
          </p>
        ) : null}
      </ChatColumn>
    );
  },
);
