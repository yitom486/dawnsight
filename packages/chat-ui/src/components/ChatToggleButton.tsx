import { Sparkles } from "lucide-react";

import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@dawnsight/ui";

import { useChatUiStore } from "../chatUiStore";

/** The only AI entry — opens the parallel ChatDock (not a sidebar tab). */
export function ChatToggleButton({ className }: { className?: string }) {
  const chatOpen = useChatUiStore((s) => s.chatOpen);
  const toggleChat = useChatUiStore((s) => s.toggleChat);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
          type="button"
          variant={chatOpen ? "secondary" : "ghost"}
          size="icon"
          className={cn("size-8", className)}
          aria-label={chatOpen ? "收起 AI 对话" : "打开 AI 对话"}
          aria-pressed={chatOpen}
          onClick={toggleChat}
          >
            <Sparkles className="size-4 text-ai" />
          </Button>
        }
      />
      <TooltipContent>
        {chatOpen ? "收起对话 (Esc)" : "AI 对话"}
      </TooltipContent>
    </Tooltip>
  );
}
