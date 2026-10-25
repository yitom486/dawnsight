import type { LucideIcon } from "lucide-react";

import { useChatUiStore } from "@dawnsight/chat-ui/chatUiStore";
import { Button } from "@dawnsight/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@dawnsight/ui/tooltip";
import { cn } from "@dawnsight/ui/utils";

import type { SidebarTab } from "@/features/player";

export type WorkspaceRailItem = {
  id: SidebarTab;
  label: string;
  icon: LucideIcon;
};

type WorkspaceRailProps = {
  items: readonly WorkspaceRailItem[];
  activeTab: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
};

/**
 * Narrow navigation rail for the sibling workspaces around the native player.
 * It only changes which existing panel is rendered; it never enters the HWND
 * rectangle or creates a transparent overlay above it. The AI dock toggle
 * lives only in the title bar; picking a workspace here closes the dock.
 */
export function WorkspaceRail({
  items,
  activeTab,
  onSelect,
}: WorkspaceRailProps) {
  const closeChat = useChatUiStore((state) => state.closeChat);

  return (
    <nav
      aria-label="工作区导航"
      className="relative z-10 flex w-[5.75rem] shrink-0 flex-col items-center border-r border-border bg-surface-elevated px-[var(--space-ui-2)] py-[var(--space-ui-3)] max-[700px]:w-14 max-[700px]:px-1.5"
    >
      <div className="flex w-full flex-col items-center gap-[var(--space-ui-2)]">
        {items.map(({ id, label, icon: Icon }) => {
          const selected = activeTab === id;
          return (
            <Tooltip key={id}>
              <TooltipTrigger
                render={
                  <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  className={cn(
                    "flex h-14 w-full flex-col gap-[var(--space-ui-1)] rounded-[var(--radius-ui-control)] px-[var(--space-ui-1)] py-[var(--space-ui-2)] text-[length:var(--text-ui-label)] leading-[var(--text-ui-label--line-height)] font-medium transition-[background-color,color,border-color] duration-[var(--duration-ui-feedback)] motion-reduce:transition-none max-[700px]:size-10 max-[700px]:gap-0",
                    selected
                      ? "border-l-2 border-foreground/60 bg-surface-subtle text-foreground hover:bg-surface-subtle"
                      : "border-l-2 border-transparent text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
                  )}
                  aria-label={label}
                  aria-pressed={selected}
                  aria-current={selected ? "page" : undefined}
                  data-active={selected ? "true" : "false"}
                  onClick={() => {
                    closeChat();
                    onSelect(id);
                  }}
                  >
                    <Icon className="size-5 shrink-0 max-[700px]:size-4" />
                    <span className="max-[700px]:sr-only">{label}</span>
                  </Button>
                }
              />
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
