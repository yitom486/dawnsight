import { errorMessage, formatTime } from "@/lib/format";
import { Separator } from "@dawnsight/ui/separator";
import { usePlayerStore } from "@/features/player";

import { useMediaToolStatus } from "../hooks/useMediaToolStatus";
import { useMediaInfoQuery } from "../hooks/useMediaInfoQuery";
import type { MediaStream, StreamKind } from "../types";

function formatBitrate(bps?: number | null): string | null {
  if (bps == null || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps} bps`;
}

const UNKNOWN_CODEC = "未知编码";

/** Neutral kind names; raw backend enums never render as pretty data. */
function kindLabel(kind: StreamKind): string {
  switch (kind) {
    case "Subtitle":
      return "字幕";
    case "Data":
      return "数据";
    case "Attachment":
      return "附件";
    default:
      return "未知";
  }
}

/** Host identity of a remote URL; signed stream params never surface. */
function remoteHostLabel(currentFile: string | null): string {
  if (!currentFile) return "在线";
  try {
    const host = new URL(currentFile).hostname.replace(/^www\./, "");
    return host || "在线";
  } catch {
    return "在线";
  }
}

function shortStream(stream: MediaStream): string {
  if (stream.kind === "Video") {
    const size =
      stream.width && stream.height
        ? `${stream.width}×${stream.height}`
        : "未知尺寸";
    return `${size} · ${stream.codecName ?? UNKNOWN_CODEC}`;
  }
  if (stream.kind === "Audio") {
    return `${stream.codecName ?? UNKNOWN_CODEC}${stream.language ? ` · ${stream.language}` : ""}`;
  }
  return `${kindLabel(stream.kind)}${stream.codecName ? ` · ${stream.codecName}` : ""}`;
}

function isProbeNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ProbeNotFound"
  );
}

/** Compact media summary for the reader sidebar. */
export function MediaInfoPanel() {
  const sourceKind = usePlayerStore((s) => s.sourceKind);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const status = usePlayerStore((s) => s.status);
  const query = useMediaInfoQuery();
  const probeMissing = isProbeNotFound(query.error) && query.isError;
  const toolQuery = useMediaToolStatus(probeMissing);

  if (sourceKind === "remote" || (currentFile?.startsWith("http") ?? false)) {
    return (
      <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
        <p className="text-[length:var(--text-ui-body)] leading-[var(--text-ui-body--line-height)] font-medium break-words text-foreground">
          在线视频 · {remoteHostLabel(currentFile)}
        </p>
        <p>媒体信息由在线解析提供；容器探测仅用于本地文件。</p>
        <Separator className="mt-2" />
      </div>
    );
  }

  if (!query.isEnabled) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {status === "Loading" ? "正在打开媒体…" : "打开视频后显示媒体信息"}
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">探测中…</div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-1 px-3 py-2 text-xs">
        <p className="text-destructive" role="alert">{errorMessage(query.error)}</p>
        {probeMissing ? (
          <p className="text-muted-foreground">
            {toolQuery.data?.hint ?? "正在检查媒体分析组件…"}
          </p>
        ) : null}
      </div>
    );
  }

  const info = query.data;
  if (!info) return null;

  const video = info.streams.find((s: MediaStream) => s.kind === "Video");
  const audio = info.streams.find((s: MediaStream) => s.kind === "Audio");
  const bitrate = formatBitrate(info.bitRate);

  return (
    <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
      <p className="text-[length:var(--text-ui-body)] leading-[var(--text-ui-body--line-height)] font-medium break-words text-foreground">
        {info.formatLongName ?? info.formatName ?? "未知格式"}
        {info.durationMs != null ? ` · ${formatTime(info.durationMs)}` : ""}
        {bitrate ? ` · ${bitrate}` : ""}
      </p>
      {video ? <p className="break-words">视频：{shortStream(video)}</p> : null}
      {audio ? <p className="break-words">音频：{shortStream(audio)}</p> : null}
      <Separator className="mt-2" />
    </div>
  );
}
