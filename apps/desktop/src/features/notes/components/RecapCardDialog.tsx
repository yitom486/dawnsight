import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "@dawnsight/ui/button";
import { NativeSelect, NativeSelectOption } from "@dawnsight/ui/native-select";

import { getNoteFrame } from "../api";
import { errorMessage, formatTime } from "@/lib/format";

import { exportNoteRecapCard } from "../api";
import {
  decodeImage,
  RECAP_CARD_SIZE,
  renderRecapCard,
  type RecapCardData,
  type RecapCardRatio,
} from "../recapCard";
import type { Note } from "../types";

type Props = {
  note: Note;
  mediaPath: string;
  open: boolean;
  onClose: () => void;
};

/**
 * 观影打卡卡片：Note → 暗色胶片风 PNG。canvas 渲染 + 保存对话框落盘；
 * 无截帧时优雅退化为纯文字卡片。
 *
 * 非模态面板内预览：普通流占据笔记工作区空间，不挂 body portal、
 * 不盖全窗口 backdrop；关闭只走明确的返回动作。
 */
export function RecapCardDialog({ note, mediaPath, open, onClose }: Props) {
  const [ratio, setRatio] = useState<RecapCardRatio>("3:4");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameImageRef = useRef<HTMLImageElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const [frameReady, setFrameReady] = useState(0);

  const mediaTitle = mediaTitleOf(mediaPath);

  const frameQuery = useQuery({
    queryKey: ["recap-card-frame", note.id],
    queryFn: () => getNoteFrame(note.id),
    staleTime: Infinity,
    retry: false,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const data = frameQuery.data;
    if (!data) return;
    let cancelled = false;
    void decodeImage(`data:${data.mime};base64,${data.data}`).then((image) => {
      if (cancelled) return;
      frameImageRef.current = image;
      setFrameReady((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [frameQuery.data, open]);

  // Opening comes from an explicit user action (the note's card button):
  // land focus on the return action once. Re-renders (ratio, frame load,
  // export result) must not move focus again.
  useEffect(() => {
    if (open) {
      backRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data: RecapCardData = {
      mediaTitle,
      timeLabel: formatTime(note.positionMs),
      body: note.body,
      quotes: (note.quotes ?? []).map((quote) => quote.text),
      frameImage: frameImageRef.current,
      ratio,
    };
    try {
      renderRecapCard(canvas, data);
    } catch (renderError) {
      setError(errorMessage(renderError));
    }
  }, [open, note.body, note.positionMs, note.quotes, mediaTitle, ratio, frameReady]);

  if (!open) return null;

  const exportCard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const pngBase64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      const saved = await exportNoteRecapCard(
        mediaPath,
        formatTime(note.positionMs),
        pngBase64,
      );
      if (saved) setSavedPath(saved);
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      setBusy(false);
    }
  };

  const size = RECAP_CARD_SIZE[ratio];
  return (
    <section
      aria-label="打卡卡片预览"
      // Scoped Escape: only this preview's own unconsumed keypress returns.
      // Synthetic/isComposing/229 and SELECT targets are skipped; nothing
      // document-global is installed. Consumed Escape stops here so the chat
      // dock's own window handler does not fire on the same keypress.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const native = event.nativeEvent as KeyboardEvent;
        if (
          event.defaultPrevented ||
          native.isComposing ||
          native.keyCode === 229 ||
          (event.target as HTMLElement | null)?.tagName === "SELECT"
        ) {
          return;
        }
        event.stopPropagation();
        onClose();
      }}
      className="flex min-h-0 flex-1 flex-col gap-2 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">打卡卡片预览</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {mediaTitle} · {formatTime(note.positionMs)}
          </p>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="max-h-[60vh] w-auto max-w-full self-center rounded-md border border-border"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={backRef}
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={onClose}
        >
          返回笔记
        </Button>
        <NativeSelect
          aria-label="打卡卡片比例"
          size="sm"
          className="w-[4.5rem]"
          value={ratio}
          onChange={(event) => setRatio(event.target.value as RecapCardRatio)}
        >
          <NativeSelectOption value="3:4">3:4</NativeSelectOption>
          <NativeSelectOption value="9:16">9:16</NativeSelectOption>
        </NativeSelect>
        <Button
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={busy}
          onClick={() => void exportCard()}
        >
          {busy ? "导出中…" : "导出 PNG"}
        </Button>
      </div>
      {savedPath ? (
        <p className="text-[11px] text-muted-foreground">已保存至 {savedPath}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function mediaTitleOf(mediaPath: string): string {
  // A stream URL is a source identity, not a filename: query credentials
  // must never become the visible title or be drawn into an exported card.
  if (/^https?:/i.test(mediaPath)) {
    try {
      const host = new URL(mediaPath).hostname.replace(/^www\./, "");
      return host ? `在线视频 · ${host}` : "在线视频";
    } catch {
      return "在线视频";
    }
  }
  const normalized = mediaPath.replace(/\\/g, "/");
  const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const stem = baseName.replace(/\.[a-z0-9]{2,5}$/i, "");
  return stem || "Dawnsight";
}
