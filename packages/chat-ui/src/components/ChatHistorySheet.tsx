import { History, RefreshCw, Trash2 } from "lucide-react";

import { Button, cn } from "@dawnsight/ui";

import type { HistoryThreadRow } from "../conversationContext";

type Props = {
  open: boolean;
  rows: HistoryThreadRow[];
  activeSessionId: string | null;
  switchBlocked: boolean;
  loading: boolean;
  onRefresh: () => void;
  onPurgeEmpty: () => void;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
};

export function formatConversationTime(updatedAtMs: number): string {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(updatedAtMs));
}

/**
 * 展示上层传入的历史行，不自行判定会话是否存在或可恢复。删除按钮直通 onDelete
 *（本组件不做二次确认、不记账、不恢复）；无本地/Agent 双行制、无存档态——
 * 跨 scope 隔离、存在性校验与恢复策略由上层保证。
 */
export function ChatHistorySheet({
  open,
  rows,
  activeSessionId,
  switchBlocked,
  loading,
  onRefresh,
  onPurgeEmpty,
  onClose,
  onSelect,
  onDelete,
}: Props) {
  if (!open) return null;

  const emptyCount = rows.filter((row) => row.isEmptyCandidate).length;

  return (
    <div className="border-b border-border bg-popover shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 py-1.5">
        <div className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium">
          <History className="size-3.5 shrink-0" />
          <span className="truncate">历史对话</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {emptyCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[length:var(--text-ui-label)] text-muted-foreground hover:text-destructive"
              disabled={loading || switchBlocked}
              onClick={onPurgeEmpty}
            >
              清理空对话（{emptyCount}）
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[length:var(--text-ui-label)]"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn("size-3", loading && "animate-spin")}
            />
            刷新
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[length:var(--text-ui-label)]"
            onClick={onClose}
          >
            关闭
          </Button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <p className="px-3 pb-4 pt-1 text-center text-[11px] text-muted-foreground">
          正在加载历史…
        </p>
      ) : rows.length === 0 ? (
        <p className="px-3 pb-4 pt-1 text-center text-[11px] text-muted-foreground">
          暂无历史对话，在本目录开始新对话后会出现在列表中
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto pb-1">
          {rows.map((row) => {
            const disabled = switchBlocked;
            const time = formatConversationTime(row.updatedAtMs);
            return (
              <li key={row.sessionId}>
                <div
                  className={cn(
                    "flex items-start gap-2 px-2 py-2 hover:bg-muted/60",
                    row.sessionId === activeSessionId && "bg-muted/40",
                  )}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "h-auto min-h-7 min-w-0 flex-1 flex-col items-stretch justify-start gap-0 whitespace-normal rounded-none px-0 py-0 text-left font-normal hover:bg-transparent focus-visible:ring-offset-0",
                      disabled && "cursor-not-allowed opacity-70",
                    )}
                    disabled={disabled}
                    aria-current={row.sessionId === activeSessionId ? true : undefined}
                    onClick={() => onSelect(row.sessionId)}
                  >
                    <p className="break-words text-[length:var(--text-ui-body)] font-medium text-foreground">
                      {row.title}
                      {row.sessionId === activeSessionId ? (
                        <span className="font-normal text-muted-foreground">（当前）</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 break-words text-[length:var(--text-ui-label)] text-muted-foreground">
                      {time ? time : `对话 ${row.sessionId.slice(0, 8)}`}
                    </p>
                    {disabled ? (
                      <p className="mt-1 text-[length:var(--text-ui-label)] leading-4 text-muted-foreground">
                        正在回答，请稍后再切换对话
                      </p>
                    ) : null}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="删除对话"
                    disabled={disabled}
                    onClick={() => onDelete(row.sessionId)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
