import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@dawnsight/ui/tooltip";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    async function checkState() {
      try {
        const appWindow = getCurrentWindow();
        if (typeof appWindow?.isMaximized === "function") {
          const max = await appWindow.isMaximized();
          if (mounted) setIsMaximized(max);

          if (typeof appWindow.onResized === "function") {
            unlisten = await appWindow.onResized(async () => {
              if (mounted) {
                const current = await appWindow.isMaximized();
                setIsMaximized(current);
              }
            });
          }
        }
      } catch {
        // Ignored in non-Tauri / test environments
      }
    }

    void checkState();

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      // Ignored in non-Tauri / test environments
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      if (typeof appWindow.isMaximized === "function") {
        const max = await appWindow.isMaximized();
        setIsMaximized(max);
      }
    } catch {
      // Ignored in non-Tauri / test environments
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      // Ignored in non-Tauri / test environments
    }
  };

  return (
    <div
      className="flex h-full items-stretch shrink-0"
      data-tauri-drag-region="none"
      role="group"
      aria-label="窗口控制"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => void handleMinimize()}
              aria-label="最小化窗口"
              className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:bg-muted/80 active:bg-muted"
            >
              <Minus className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>最小化</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => void handleToggleMaximize()}
              aria-label={isMaximized ? "向下还原窗口" : "最大化窗口"}
              className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:bg-muted/80 active:bg-muted"
            >
              {isMaximized ? (
                <Copy className="size-3 -scale-y-100" />
              ) : (
                <Square className="size-3" />
              )}
            </button>
          }
        />
        <TooltipContent>{isMaximized ? "向下还原" : "最大化"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => void handleClose()}
              aria-label="关闭窗口"
              className="inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-[#e81123] hover:text-white focus-visible:outline-none focus-visible:bg-[#e81123] focus-visible:text-white active:bg-[#c42b1c]"
            >
              <X className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>关闭</TooltipContent>
      </Tooltip>
    </div>
  );
}
