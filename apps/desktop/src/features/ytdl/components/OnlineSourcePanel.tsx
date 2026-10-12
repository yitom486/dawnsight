/** Online URL open + cookie settings — lives in sidebar (never over HWND). */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Alert } from "@dawnsight/ui/alert";
import { Button } from "@dawnsight/ui/button";
import { Input } from "@dawnsight/ui/input";
import { ytdlResolveKey } from "@dawnsight/query-keys";
import { OnlineSourceSettings } from "@/features/ytdl/components/OnlineSourceSettings";
import { playerStatusText, usePlayerStore } from "@/features/player";
import { errorMessage, formatPlayerError } from "@/lib/format";
import { getCachedYtdlResolve } from "../api";

export type OnlineSourcePanelView = "workspace" | "settings";

export type OnlineSourcePanelProps = {
  view?: OnlineSourcePanelView;
  /**
   * Composition-layer callback to the existing online settings category.
   * Only the app shell knows the settings navigation; the feature never
   * imports settings or owns cross-domain navigation state.
   */
  onOpenSettings?: () => void;
};

export function OnlineSourcePanel({
  view = "workspace",
  onOpenSettings,
}: OnlineSourcePanelProps) {
  return view === "settings" ? (
    <OnlineSettingsContent />
  ) : (
    <OnlineWorkspaceContent onOpenSettings={onOpenSettings} />
  );
}

/** Host part of a trusted webpage URL; signed stream params never surface. */
function sourceHost(webpageUrl?: string | null): string | null {
  if (!webpageUrl) return null;
  try {
    const host = new URL(webpageUrl).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function OnlineWorkspaceContent({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const busy = usePlayerStore((s) => s.busy);
  const status = usePlayerStore((s) => s.status);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const sourceKind = usePlayerStore((s) => s.sourceKind);
  const error = usePlayerStore((s) => s.error);

  const playingRemote =
    sourceKind === "remote" && Boolean(currentFile) && status !== "Error";
  const mediaQuery = useQuery({
    queryKey: ytdlResolveKey(currentFile),
    queryFn: () => getCachedYtdlResolve(currentFile as string),
    enabled: playingRemote,
    staleTime: Infinity,
  });

  const isRemote = sourceKind === "remote" && currentFile != null;
  const failed = status === "Error";
  const cached = mediaQuery.data ?? null;
  const statusText = playerStatusText(status, { hasMedia: currentFile != null });

  // Title prefers the cached trusted title; never fabricate one and never
  // pour the raw input URL (with its signed params) into the heading.
  const title =
    cached?.title?.trim() && cached.title.trim().length > 0
      ? cached.title.trim()
      : "在线视频";
  const extractor = cached?.extractor?.trim() || null;
  const host = sourceHost(cached?.webpageUrl ?? (isRemote ? currentFile : null));
  const sourceText =
    extractor && host && extractor !== host
      ? `${extractor} · ${host}`
      : (extractor ?? host ?? "在线");
  const countsText = cached
    ? ` · ${cached.chapters.length} 个章节 · ${cached.subtitles.length} 条字幕`
    : null;
  const pendingText =
    !cached && !failed
      ? busy || mediaQuery.isPending
        ? "正在读取在线媒体信息…"
        : "暂无缓存信息"
      : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 text-xs">
      <p className="text-muted-foreground">
        在线 URL、下载和解析配置已集中到设置；此处只显示当前真实在线媒体状态。
      </p>
      {isRemote ? (
        <div className="mt-3 space-y-1.5">
          <p
            className="truncate text-[length:var(--text-ui-body)] leading-[var(--text-ui-body--line-height)] font-medium text-foreground"
            title={title}
          >
            {title}
          </p>
          <p
            className="truncate text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground"
            title={sourceText}
          >
            来源：{sourceText}
          </p>
          <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground">
            {statusText}
            {countsText}
          </p>
          {failed && error ? (
            <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-destructive">
              {formatPlayerError(error)}
            </p>
          ) : null}
          {!failed && !cached ? (
            mediaQuery.isError ? (
              <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-destructive">
                {errorMessage(mediaQuery.error)}
              </p>
            ) : (
              <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground">
                {pendingText}
              </p>
            )
          ) : null}
        </div>
      ) : currentFile ? (
        <div className="mt-3 space-y-1.5">
          <p
            className="truncate text-[length:var(--text-ui-body)] leading-[var(--text-ui-body--line-height)] font-medium text-foreground"
            title={currentFile}
          >
            当前为本地媒体：{currentFile}
          </p>
          <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground">
            {statusText}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-muted-foreground">尚未打开在线媒体。</p>
      )}
      <div className="mt-3 border-t border-border pt-3">
        {onOpenSettings ? (
          <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
            打开在线资源设置
          </Button>
        ) : (
          <p className="text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground">
            在线 URL 与登录配置请前往设置「在线资源」。
          </p>
        )}
      </div>
    </section>
  );
}

function OnlineSettingsContent() {
  const busy = usePlayerStore((s) => s.busy);
  const openUrl = usePlayerStore((s) => s.openUrl);
  const statusMessage = usePlayerStore((s) => s.statusMessage);
  const error = usePlayerStore((s) => s.error);
  const status = usePlayerStore((s) => s.status);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const sourceKind = usePlayerStore((s) => s.sourceKind);
  const [url, setUrl] = useState("");

  const canSubmit =
    /^https?:\/\//i.test(url.trim()) && url.trim().length > 10;

  const submit = async () => {
    if (!canSubmit || busy) return;
    const submitted = url.trim();
    await openUrl(submitted);
    if (usePlayerStore.getState().status !== "Error") {
      setUrl("");
    }
  };

  const openFailed = status === "Error" && Boolean(error?.message);
  const playingRemote =
    sourceKind === "remote" && Boolean(currentFile) && status !== "Error";
  const mediaQuery = useQuery({
    queryKey: ytdlResolveKey(currentFile),
    queryFn: () => getCachedYtdlResolve(currentFile as string),
    enabled: playingRemote,
    staleTime: Infinity,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="space-y-2">
        <h2 className="text-sm font-medium">打开在线视频</h2>
        <p className="text-xs text-muted-foreground">
          粘贴完整链接后点「打开链接」。公开视频通常可直接播；若提示需要登录，请用下方「导入
          cookies.txt」（不是 Google 一键授权）。
        </p>
        <Input
          aria-label="在线视频 URL"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="h-auto w-full rounded-md px-3 py-2 text-sm"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit || busy}
            onClick={() => void submit()}
          >
            {busy ? "解析打开中…" : "打开链接"}
          </Button>
          {busy ? (
            <span className="text-[11px] text-muted-foreground">
              正在解析在线视频，可能需要十几秒…
            </span>
          ) : null}
        </div>
        {openFailed ? (
          <Alert
            variant="destructive"
            className="rounded-md border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <p className="font-medium">未能打开在线视频</p>
            <p className="mt-1 leading-relaxed">{error?.message}</p>
            <p className="mt-1 text-muted-foreground">
              若提示登录或登录态失败：用浏览器扩展导出 cookies.txt → 下方导入 →
              测试可读 → 再打开链接。失败时左侧可能仍显示上一段画面。
            </p>
          </Alert>
        ) : null}
        {playingRemote ? (
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>当前在线源：{currentFile}</p>
            {mediaQuery.data ? (
              <p>
                {mediaQuery.data.title ?? "在线视频"} ·{" "}
                {mediaQuery.data.chapters.length} 个章节 ·{" "}
                {mediaQuery.data.subtitles.length} 条字幕轨道
              </p>
            ) : null}
          </div>
        ) : null}
        {!openFailed && statusMessage ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {statusMessage}
          </p>
        ) : null}
      </div>

      <OnlineSourceSettings />
    </div>
  );
}
