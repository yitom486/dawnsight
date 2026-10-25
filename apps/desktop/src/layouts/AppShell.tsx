import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Info,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  X,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@dawnsight/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dawnsight/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@dawnsight/ui/tooltip";
import { ChatToggleButton } from "@dawnsight/chat-ui/components/ChatToggleButton";
import { usePlayerStore, useUiStore } from "@/features/player";
import { errorMessage } from "@/lib/format";
import { getStartupNotice, revealLogDir, type SystemStartupNotice } from "@/lib/system";
import dawnsightLogo from "../../src-tauri/icons/dawnsight-cat-source.png";

// Source and installers share one repo: release.yml publishes to its Releases.
const RELEASES_URL = "https://github.com/yitom486/dawnsight/releases";
const REPO_URL = "https://github.com/yitom486/dawnsight";

type AppShellProps = {
  children: ReactNode;
};

import { WindowControls } from "./WindowControls";

export { WindowControls };

export function FullscreenToggleButton() {
  const fullscreen = useUiStore((s) => s.fullscreen);
  const toggleFullscreen = useUiStore((s) => s.toggleFullscreen);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
          type="button"
          variant="ghost"
          size="icon" className="size-8"
          onClick={() => void toggleFullscreen()}
          aria-label={fullscreen ? "退出全屏" : "全屏"}
          >
            {fullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        }
      />
      <TooltipContent>
        {fullscreen ? "退出全屏 (Esc / F)" : "全屏 (F)"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Low-frequency app actions (log export, about) live behind one ⋯ trigger. */
function AppMenu() {
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);

  // Crash/log export: reveal the file-log directory in the OS file manager.
  const openLogDir = () => {
    void revealLogDir().catch((error: unknown) => {
      usePlayerStore.getState().setStatusMessage(errorMessage(error));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="更多"
            title="更多"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" side="bottom" className="z-[100] min-w-[12rem]">
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={openLogDir}>
          <FileText className="size-4 text-muted-foreground" />
          打开日志目录
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onClick={() => setAboutOpen(true)}
        >
          <Info className="size-4 text-muted-foreground" />
          关于 Dawnsight
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** About dialog: product intro + runtime version + update entry. */
function AboutDialog() {
  const [version, setVersion] = useState("…");
  const aboutOpen = useUiStore((s) => s.aboutOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        if (!cancelled) setVersion("未知");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on Escape key press
  useEffect(() => {
    if (!aboutOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAboutOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen, setAboutOpen]);

  const openRepo = () => {
    void openUrl(REPO_URL).catch((error: unknown) => {
      usePlayerStore.getState().setStatusMessage(errorMessage(error));
    });
  };

  const openReleases = () => {
    void openUrl(RELEASES_URL).catch((error: unknown) => {
      usePlayerStore.getState().setStatusMessage(errorMessage(error));
    });
  };

  return (
    <>
      {aboutOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="about-dialog-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setAboutOpen(false);
                }
              }}
            >
              <div
                className="relative flex flex-col gap-4 border border-border bg-card text-foreground max-w-md w-full rounded-[var(--radius-ui-container)] p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setAboutOpen(false)}
                  className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                  aria-label="关闭"
                >
                  <X className="size-4" />
                </button>

                <div className="flex items-center gap-[var(--space-ui-4)] pr-6">
                  <img
                    src={dawnsightLogo}
                    alt="Dawnsight Logo"
                    className="size-11 rounded-xl border border-border object-cover shadow-sm pointer-events-none shrink-0"
                  />
                  <div className="flex flex-col text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <h2
                        id="about-dialog-title"
                        className="text-base font-semibold text-foreground tracking-tight"
                      >
                        Dawnsight
                      </h2>
                      <span className="rounded-full bg-ai/10 border border-ai/30 px-2 py-0.5 text-[length:var(--text-ui-label)] leading-[var(--text-ui-label--line-height)] font-medium text-ai">
                        AI Video Reader
                      </span>
                    </div>
                    <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground mt-0.5">
                      版本 {version}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                  桌面端 AI 观影阅读器：用原生播放器播放本地视频，把字幕文稿、章节、笔记与可选的
                  AI 对话放在同一个阅读工作流里。
                </p>

                <div className="mt-2 flex flex-row items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openRepo}
                  >
                    GitHub 仓库
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openReleases}
                  >
                    下载更新
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setAboutOpen(false)}
                  >
                    知道了
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Desktop app chrome: slim title bar + main content. */
export function AppShell({ children }: AppShellProps) {
  const [startupNotice, setStartupNotice] = useState<SystemStartupNotice | null>(null);
  const fullscreen = useUiStore((s) => s.fullscreen);
  const fileLabel = usePlayerStore((s) => {
    if (!s.currentFile) return null;
    const parts = s.currentFile.split(/[/\\]/);
    return parts[parts.length - 1] || s.currentFile;
  });
  const fileFormat = fileLabel?.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ?? null;
  const playlist = usePlayerStore((s) => s.playlist);
  const playlistIndex = usePlayerStore((s) => s.playlistIndex);

  useEffect(() => {
    let cancelled = false;
    void getStartupNotice()
      .then((notice) => {
        if (!cancelled) setStartupNotice(notice);
      })
      .catch(() => {
        if (!cancelled) setStartupNotice(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-background text-foreground">
      {startupNotice ? (
        <div
          role="status"
          className="absolute inset-x-3 top-3 z-50 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
        >
          <span className="text-muted-foreground">{startupNotice.message}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setStartupNotice(null)}
          >
            知道了
          </Button>
        </div>
      ) : null}
      {!fullscreen ? (
        <header
          aria-label="应用标题栏"
          data-tauri-drag-region
          onDoubleClick={async (e) => {
            if ((e.target as HTMLElement).closest("button, a, input, [role='button'], [data-tauri-drag-region='none']")) return;
            try {
              await getCurrentWindow().toggleMaximize();
            } catch {
              // Ignored in non-Tauri / test environments
            }
          }}
          className="flex h-11 shrink-0 select-none items-center justify-between border-b border-border bg-surface-elevated pl-3 pr-0 shadow-sm"
        >
          <div
            className="flex min-w-0 shrink-0 items-center gap-2.5 cursor-default"
            data-tauri-drag-region
          >
            <img
              src={dawnsightLogo}
              alt="Dawnsight"
              className="size-7 rounded-lg border border-ai/40 object-cover shadow-sm pointer-events-none"
            />
            <div className="flex min-w-0 items-baseline gap-2" data-tauri-drag-region>
              <p className="text-sm font-semibold tracking-tight text-surface-foreground">
                Dawnsight
              </p>
              <p className="hidden text-xs text-muted-foreground sm:inline">
                AI Video Reader
              </p>
            </div>
          </div>
          <div aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-border/80 min-[1100px]:block" />
          <div
            className="flex min-w-0 flex-1 items-center justify-center gap-[var(--space-ui-2)] px-3 cursor-default"
            data-tauri-drag-region
          >
            <span className="truncate text-[length:var(--text-ui-body)] leading-[var(--text-ui-body--line-height)] font-medium text-foreground" title={fileLabel ?? undefined} data-tauri-drag-region>
              {fileLabel ?? "未打开文件"}
            </span>
            {fileFormat ? (
              <span className="shrink-0 rounded border border-border/80 bg-muted px-1.5 py-0.5 text-[length:var(--text-ui-label)] leading-[var(--text-ui-label--line-height)] font-medium tracking-wide text-muted-foreground">
                {fileFormat}
              </span>
            ) : null}
            {playlist.length > 1 && playlistIndex >= 0 ? (
              <span className="shrink-0 text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground tabular-nums">
                {playlistIndex + 1}/{playlist.length}
              </span>
            ) : null}
          </div>
          <div className="flex h-full shrink-0 items-center gap-0.5" data-tauri-drag-region="none">
            <ChatToggleButton />
            <FullscreenToggleButton />
            <AppMenu />
            <div aria-hidden="true" className="mx-1 h-4 w-px bg-border/80" />
            <WindowControls />
          </div>
        </header>
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <AboutDialog />
    </div>
  );
}
