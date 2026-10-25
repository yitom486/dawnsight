import {
  Check,
  ChevronDown,
  History,
  MoreHorizontal,
  Plus,
  StickyNote,
} from "lucide-react";
import { useRef } from "react";

import { Button } from "@dawnsight/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dawnsight/ui/dropdown-menu";
import { QuickNoteDialog } from "@/features/notes/components/QuickNoteDialog";
import { cn } from "@dawnsight/ui/utils";

import type { AcpConnectionState } from "../types";
import { ChatColumn } from "@dawnsight/chat-ui/components/ChatShell";

type Props = {
  agentLabel: string;
  chatTitle?: string | null;
  connectionState: AcpConnectionState;
  statusLine?: string | null;
  statusError?: string | null;
  loading?: boolean;
  busy?: boolean;
  historyCount?: number;
  quickNoteDisabled?: boolean;
  quickNoteOpen?: boolean;
  /** 多 Agent 一键切换：有且仅当 profiles > 1 且给了 onSwitchProfile 才渲染下拉。 */
  profiles?: { id: string; name: string; available: boolean }[];
  activeProfileId?: string;
  switchDisabled?: boolean;
  onSwitchProfile?: (id: string) => void;
  onQuickNoteOpenChange?: (open: boolean) => void;
  onQuickNoteSaved?: () => void;
  onNewChat: () => void;
  onOpenHistory?: () => void;
  onReconnect?: () => void;
};

const CONNECTION_LABEL: Record<AcpConnectionState, string> = {
  unavailable: "未配置",
  idle: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接失败",
};

/** Only failures need words; connected/connecting read from the dot (plus the
 * composer placeholder while connecting), so the header stays one line. */
const QUIET_STATES: ReadonlySet<AcpConnectionState> = new Set([
  "connected",
  "connecting",
]);

/** Header — one row: status dot + agent, then history / new chat / ⋯. */
export function ChatToolbar({
  agentLabel,
  chatTitle,
  connectionState,
  statusLine,
  statusError,
  loading,
  busy,
  historyCount = 0,
  quickNoteDisabled,
  quickNoteOpen = false,
  profiles,
  activeProfileId,
  switchDisabled,
  onSwitchProfile,
  onQuickNoteOpenChange,
  onQuickNoteSaved,
  onNewChat,
  onOpenHistory,
  onReconnect,
}: Props) {
  const quickNoteAnchorRef = useRef<HTMLDivElement>(null);
  const quickNoteButtonRef = useRef<HTMLButtonElement>(null);
  const canSwitchAgent =
    onSwitchProfile && (profiles?.length ?? 0) > 1 && activeProfileId;

  return (
    <ChatColumn className="shrink-0 space-y-1 border-b border-border py-2">
      <div className="relative">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              title={CONNECTION_LABEL[connectionState]}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                connectionState === "connected" && "bg-success",
                connectionState === "connecting" &&
                  "bg-warning animate-pulse motion-reduce:animate-none",
                connectionState === "error" && "bg-destructive",
                (connectionState === "idle" ||
                  connectionState === "unavailable") &&
                  "bg-muted-foreground/50",
              )}
            />
            {canSwitchAgent ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 max-w-[11rem] cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1 text-[length:var(--text-ui-meta)] font-medium text-foreground outline-none hover:bg-transparent hover:border-border focus-visible:border-border focus-visible:ring-0 disabled:cursor-default disabled:opacity-60"
                      disabled={busy || switchDisabled}
                      aria-label="切换 Agent"
                      title={`切换 Agent：${agentLabel}（各家会话记忆独立保留）`}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        {agentLabel}
                      </span>
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </Button>
                  }
                />
                <DropdownMenuContent
                  align="start"
                  side="bottom"
                  className="z-[100] min-w-[12rem]"
                >
                  {profiles?.map((profile) => {
                    const isActive = profile.id === activeProfileId;
                    return (
                      <DropdownMenuItem
                        key={profile.id}
                        disabled={busy || switchDisabled}
                        aria-current={isActive ? "true" : undefined}
                        className={cn("cursor-pointer gap-2")}
                        onClick={() => {
                          if (!isActive) {
                            onSwitchProfile(profile.id);
                          }
                        }}
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            profile.available
                              ? "bg-success"
                              : "bg-muted-foreground/50",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate" title={profile.name}>
                          {profile.name}
                        </span>
                        {isActive ? (
                          <Check className="size-3.5 shrink-0" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="min-w-0 truncate text-[length:var(--text-ui-meta)] font-medium text-foreground">
                {agentLabel}
              </span>
            )}
            <span
              className={cn(
                "shrink-0 text-[length:var(--text-ui-label)] text-muted-foreground",
                connectionState === "error" && "text-destructive",
                QUIET_STATES.has(connectionState) && "sr-only",
              )}
            >
              {CONNECTION_LABEL[connectionState]}
            </span>
          </div>
          {chatTitle ? (
            <p className="mt-1 break-words text-[length:var(--text-ui-label)] text-muted-foreground">
              {chatTitle}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {connectionState === "error" || connectionState === "idle" ? (
            onReconnect ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[length:var(--text-ui-label)]"
                disabled={busy || loading}
                onClick={onReconnect}
              >
                重连
              </Button>
            ) : null
          ) : null}
          {onOpenHistory ? (
            <Button
              size="icon"
              variant="ghost"
              className="relative size-7"
              disabled={busy}
              aria-label="历史对话"
              title="历史对话"
              onClick={onOpenHistory}
            >
              <History className="size-3.5" />
              {historyCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[length:var(--text-ui-label)] leading-none text-primary-foreground">
                  {historyCount > 9 ? "9+" : historyCount}
                </span>
              ) : null}
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={busy}
            aria-label="新建对话"
            title="新建对话"
            onClick={onNewChat}
          >
            <Plus className="size-3.5" />
          </Button>
          {onQuickNoteOpenChange ? (
            <div ref={quickNoteAnchorRef}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      ref={quickNoteButtonRef}
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="更多对话操作"
                      title="更多"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  side="bottom"
                  className="z-[100] min-w-[10rem]"
                >
                  <DropdownMenuItem
                    className="cursor-pointer gap-2"
                    disabled={busy || quickNoteDisabled}
                    onClick={() => onQuickNoteOpenChange(!quickNoteOpen)}
                  >
                    <StickyNote className="size-3.5 text-muted-foreground" />
                    快速写批注
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </div>

      {onQuickNoteOpenChange ? (
        <QuickNoteDialog
          open={quickNoteOpen}
          onOpenChange={onQuickNoteOpenChange}
          onSaved={onQuickNoteSaved}
          anchorRef={quickNoteAnchorRef}
          triggerRef={quickNoteButtonRef}
        />
      ) : null}
      </div>

      {statusError ? (
        <p className="break-words text-[length:var(--text-ui-label)] text-destructive">{statusError}</p>
      ) : statusLine ? (
        <p className="break-words text-[length:var(--text-ui-label)] text-muted-foreground">{statusLine}</p>
      ) : null}
    </ChatColumn>
  );
}
