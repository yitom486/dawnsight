import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@dawnsight/ui/button";
import { Checkbox } from "@dawnsight/ui/checkbox";
import { Field as SharedField, FieldLabel } from "@dawnsight/ui/field";
import { Textarea } from "@dawnsight/ui/textarea";
import { ScrollArea } from "@dawnsight/ui/scroll-area";
import { usePlayerStore } from "@/features/player";
import { useTrackStore } from "@/features/player/trackStore";
import { loadSubtitleChoice } from "@/features/transcript/api";
import { transcriptKey } from "@dawnsight/query-keys";
import type { Cue } from "@dawnsight/contracts";
import { errorMessage, formatTime } from "@/lib/format";
import { cn } from "@dawnsight/ui/utils";

import {
  createNote,
  deleteNote,
  exportNotesMarkdownToFile,
  getNoteFrame,
  listNotes,
  previewNoteQuotes,
} from "../api";
import { noteFrameKey, notesKey } from "@dawnsight/query-keys";
import { useNoteComposeStore } from "../noteComposeStore";
import { RecapCardDialog } from "./RecapCardDialog";
import {
  activeCueListIndex,
  indicesAroundPlayback,
} from "../noteQuoteSelection";
import type { NoteQuote } from "../types";

const QUOTE_CONTEXT = 3;

function formatCueLabel(cue: Cue): string {
  return `${formatTime(cue.startMs)} ${cue.text.replace(/\s+/g, " ").slice(0, 48)}`;
}

/** P7-M3 lazy frame thumbnail; click seeks to the frame moment. */
function NoteFrameThumb({ noteId, atMs }: { noteId: string; atMs: number }) {
  const seek = usePlayerStore((s) => s.seek);
  const frameQuery = useQuery({
    queryKey: noteFrameKey(noteId),
    queryFn: () => getNoteFrame(noteId),
    staleTime: Infinity,
    retry: false,
  });
  const data = frameQuery.data;
  if (!data) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      title={`跳转到 ${formatTime(atMs)} 的画面`}
      onClick={() => void seek(atMs)}
      className="h-auto shrink-0 overflow-hidden rounded border border-border p-0 hover:border-primary"
    >
      <img
        src={`data:${data.mime};base64,${data.data}`}
        alt={`批注画面 ${formatTime(atMs)}`}
        className="h-12 w-auto"
      />
    </Button>
  );
}

export function NotesPanel() {
  const mediaPath = usePlayerStore((s) => s.currentFile);
  const positionMs = usePlayerStore((s) => s.currentTimeMs);
  const seek = usePlayerStore((s) => s.seek);
  const subtitleChoiceId = useTrackStore((s) => s.subtitleChoiceId);
  const queryClient = useQueryClient();
  const [quotePreview, setQuotePreview] = useState<NoteQuote[]>([]);
  const [exportSavedPath, setExportSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeFrame, setIncludeFrame] = useState(false);
  const [recapCardNoteId, setRecapCardNoteId] = useState<string | null>(null);
  const openRecapMediaRef = useRef<string | null>(null);
  const recapTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const recapReturnIdRef = useRef<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const openDeleteMediaRef = useRef<string | null>(null);
  const deleteTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const savedHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const activeCueRef = useRef<HTMLLabelElement | null>(null);

  const body = useNoteComposeStore((s) => s.body);
  const includeQuotes = useNoteComposeStore((s) => s.includeQuotes);
  const quoteMode = useNoteComposeStore((s) => s.quoteMode);
  const selectedQuoteIndices = useNoteComposeStore((s) => s.selectedIndices);
  const anchorCueIndex = useNoteComposeStore((s) => s.anchorCueIndex);
  const setBody = useNoteComposeStore((s) => s.setBody);
  const setIncludeQuotes = useNoteComposeStore((s) => s.setIncludeQuotes);
  const syncMedia = useNoteComposeStore((s) => s.syncMedia);
  const setQuoteMode = useNoteComposeStore((s) => s.setQuoteMode);
  const setSelectedIndices = useNoteComposeStore((s) => s.setSelectedIndices);
  const toggleAtListIndex = useNoteComposeStore((s) => s.toggleAtListIndex);
  const setAnchorCueIndex = useNoteComposeStore((s) => s.setAnchorCueIndex);
  const clearQuoteSelection = useNoteComposeStore((s) => s.clearQuoteSelection);
  const resetCompose = useNoteComposeStore((s) => s.resetCompose);
  const resetComposeKeepQuotes = useNoteComposeStore(
    (s) => s.resetComposeKeepQuotes,
  );

  const transcriptQuery = useQuery({
    queryKey: transcriptKey(mediaPath, subtitleChoiceId),
    queryFn: () => loadSubtitleChoice(mediaPath!, subtitleChoiceId!),
    enabled: Boolean(mediaPath && subtitleChoiceId),
    staleTime: Infinity,
  });

  const cues = transcriptQuery.data?.cues ?? [];

  const notesQuery = useQuery({
    queryKey: notesKey(mediaPath),
    queryFn: () => listNotes(mediaPath!),
    enabled: Boolean(mediaPath),
  });

  const notes = notesQuery.data;

  const recapCardNote =
    notes?.find((note) => note.id === recapCardNoteId) ?? null;

  const focusRecapFallback = (list: { id: string }[]) => {
    const fallbackId = list
      .map((note) => note.id)
      .find((id) => recapTriggerRefs.current.has(id));
    if (fallbackId) {
      recapTriggerRefs.current.get(fallbackId)?.focus();
    } else {
      savedHeadingRef.current?.focus();
    }
  };

  const closeRecap = () => {
    setRecapCardNoteId(null);
  };

  // Return focus runs after the list remounts (the origin row is unmounted
  // while previewing, so no live element can be kept). It covers explicit
  // return, media switches, and vanished notes with one fallback shape.
  useEffect(() => {
    if (recapCardNoteId) return;
    const id = recapReturnIdRef.current;
    recapReturnIdRef.current = null;
    if (!id) return;
    const origin = recapTriggerRefs.current.get(id);
    if (origin && document.contains(origin) && !origin.disabled) {
      origin.focus();
    } else {
      focusRecapFallback(notes ?? []);
    }
  }, [recapCardNoteId, notes]);

  // Preview staleness mirrors the delete-confirm scope rule: a media switch
  // (including to no media) closes immediately without waiting for the next
  // query; on the same media a present list missing the note closes too.
  // Background loads/failures with the row still present never steal focus.
  useEffect(() => {
    if (!recapCardNoteId) return;
    if (mediaPath !== openRecapMediaRef.current) {
      setRecapCardNoteId(null);
      return;
    }
    if (notes !== undefined && !notes.some((note) => note.id === recapCardNoteId)) {
      setRecapCardNoteId(null);
    }
  }, [recapCardNoteId, notes, mediaPath]);

  const openRecap = (id: string) => {
    // Explicit UI mutex with the inline delete confirm; the delete
    // mutation/scope policy itself is untouched.
    setPendingDeleteId(null);
    openRecapMediaRef.current = mediaPath;
    recapReturnIdRef.current = id;
    setRecapCardNoteId(id);
  };

  const cancelDelete = (id: string) => {
    setPendingDeleteId(null);
    deleteTriggerRefs.current.get(id)?.focus();
  };

  // Focus the safe action when a confirm region opens.
  useEffect(() => {
    if (pendingDeleteId) {
      deleteCancelRef.current?.focus();
    }
  }, [pendingDeleteId]);

  // The pending confirm belongs to one media + one row. Media scope is
  // checked first and never waits for the query: a switch (including to no
  // media) clears the state even while the next list is loading or failed.
  // Only on the same media do we consult returned data for a vanished row.
  useEffect(() => {
    if (!pendingDeleteId) return;
    if (mediaPath !== openDeleteMediaRef.current) {
      setPendingDeleteId(null);
      savedHeadingRef.current?.focus();
      return;
    }
    if (notes !== undefined && !notes.some((note) => note.id === pendingDeleteId)) {
      setPendingDeleteId(null);
      const fallbackId = notes
        .map((note) => note.id)
        .find((id) => deleteTriggerRefs.current.has(id));
      if (fallbackId) {
        deleteTriggerRefs.current.get(fallbackId)?.focus();
      } else {
        savedHeadingRef.current?.focus();
      }
    }
  }, [pendingDeleteId, notes, mediaPath]);

  useEffect(() => {
    if (mediaPath) {
      syncMedia(mediaPath);
    }
  }, [mediaPath, syncMedia]);

  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ block: "nearest" });
  }, [quoteMode, positionMs, cues.length]);

  const playbackCueIndex = cues.length
    ? activeCueListIndex(cues, positionMs)
    : -1;

  const previewInput = useMemo(() => {
    if (!mediaPath || !includeQuotes || !subtitleChoiceId) return null;
    if (quoteMode === "manual") {
      return {
        mediaPath,
        positionMs,
        subtitleChoiceId,
        anchorCueIndex,
        quoteCueIndices:
          selectedQuoteIndices.length > 0 ? selectedQuoteIndices : null,
      };
    }
    return {
      mediaPath,
      positionMs,
      subtitleChoiceId,
      anchorCueIndex: null,
      quoteCueIndices: null,
    };
  }, [
    mediaPath,
    positionMs,
    subtitleChoiceId,
    includeQuotes,
    quoteMode,
    anchorCueIndex,
    selectedQuoteIndices,
  ]);

  useEffect(() => {
    if (!previewInput) {
      setQuotePreview([]);
      return;
    }
    let cancelled = false;
    void previewNoteQuotes(previewInput)
      .then((quotes) => {
        if (!cancelled) setQuotePreview(quotes);
      })
      .catch(() => {
        if (!cancelled) setQuotePreview([]);
      });
    return () => {
      cancelled = true;
    };
  }, [previewInput]);

  const createMutation = useMutation({
    mutationFn: createNote,
    onSuccess: async () => {
      resetComposeKeepQuotes();
      setError(null);
      await queryClient.invalidateQueries({ queryKey: notesKey(mediaPath) });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notesKey(mediaPath) });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const fillAroundPlayback = () => {
    const indices = indicesAroundPlayback(cues, positionMs, QUOTE_CONTEXT);
    setSelectedIndices(indices);
    const center = cues[playbackCueIndex];
    if (center) setAnchorCueIndex(center.index);
    setQuoteMode("manual");
  };

  if (!mediaPath) {
    return (
      <p
        ref={savedHeadingRef}
        tabIndex={-1}
        className="p-3 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        打开视频后可记录带时间戳的笔记。
      </p>
    );
  }

  const canAttachQuotes = Boolean(subtitleChoiceId && cues.length);
  const composing = body.trim().length > 0 || selectedQuoteIndices.length > 0;

  return (
    // Root may scroll as a last resort at extreme short heights; it stays
    // inside the sidebar frame (never page-level, never over the HWND).
    // The saved list below remains the primary scroll owner.
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {recapCardNote ? (
        <RecapCardDialog
          note={recapCardNote}
          mediaPath={mediaPath ?? ""}
          open
          onClose={closeRecap}
        />
      ) : (
        <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          当前 {formatTime(positionMs)}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => resetCompose()}
          >
            新建批注
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const saved = await exportNotesMarkdownToFile(mediaPath);
                if (saved) {
                  setExportSavedPath(saved);
                  setError(null);
                }
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            导出 MD
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-dashed border-border/80 p-2">
        <p className="mb-2 text-[11px] text-muted-foreground">
          {composing ? "正在编写（未保存）" : "新建批注"}
          {" · "}
          保存后写入下方列表；同一段台词可写多条批注
        </p>

        <Textarea
          className={cn(
            "min-h-[64px] w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm",
            "outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          placeholder="写下这一刻的感想…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <SharedField orientation="horizontal" className="mt-2 w-fit items-center gap-2">
          <Checkbox
            id="notes-include-quotes"
            checked={includeQuotes}
            disabled={!canAttachQuotes}
            onCheckedChange={(checked) => setIncludeQuotes(checked === true)}
          />
          <FieldLabel htmlFor="notes-include-quotes" className="w-fit text-xs text-muted-foreground">
            附带台词引用
            {!canAttachQuotes ? "（需先选择字幕轨）" : null}
          </FieldLabel>
        </SharedField>

        <SharedField orientation="horizontal" className="mt-2 w-fit items-center gap-2">
          <Checkbox
            id="notes-include-frame"
            checked={includeFrame}
            onCheckedChange={(checked) => setIncludeFrame(checked === true)}
          />
          <FieldLabel htmlFor="notes-include-frame" className="w-fit text-xs text-muted-foreground">
            附带当前画面
          </FieldLabel>
        </SharedField>

        {includeQuotes && canAttachQuotes ? (
          <div className="mt-2 space-y-2 rounded-md border border-border/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span id="notes-quote-mode-label" className="text-[11px] text-muted-foreground">引用方式</span>
              <div
                role="group"
                aria-labelledby="notes-quote-mode-label"
                className="flex rounded-md border border-border p-0.5 text-[11px]"
              >
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={quoteMode === "auto"}
                  className={cn(
                    "h-auto rounded px-2 py-0.5 text-[11px] font-normal hover:bg-transparent",
                    quoteMode === "auto" && "bg-muted font-medium",
                  )}
                  onClick={() => setQuoteMode("auto")}
                >
                  自动（最近三句）
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={quoteMode === "manual"}
                  className={cn(
                    "h-auto rounded px-2 py-0.5 text-[11px] font-normal hover:bg-transparent",
                    quoteMode === "manual" && "bg-muted font-medium",
                  )}
                  onClick={() => {
                    setQuoteMode("manual");
                    if (selectedQuoteIndices.length === 0) {
                      fillAroundPlayback();
                    }
                  }}
                >
                  手动勾选
                </Button>
              </div>
            </div>

            {quoteMode === "manual" ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  可勾选任意多句；Shift 连选；文稿「引用」可带入
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={fillAroundPlayback}
                  >
                    填入当前±3句
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={clearQuoteSelection}
                  >
                    清空引用
                  </Button>
                </div>
                <ScrollArea className="h-40 rounded border border-border/40">
                  <div className="space-y-0.5 p-1">
                    {cues.map((cue, index) => {
                      const checked = selectedQuoteIndices.includes(cue.index);
                      const isAnchor = anchorCueIndex === cue.index;
                      return (
                        <label
                          key={cue.index}
                          ref={
                            index === playbackCueIndex ? activeCueRef : undefined
                          }
                          className={cn(
                            "flex items-start gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-muted/50",
                            index === playbackCueIndex && "bg-primary/5",
                            checked && "bg-muted/30",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            // Controlled by the store via onChange (no
                            // preventDefault): cancelling the click default
                            // leaves the box visually unchecked in real
                            // browsers even though the pick is saved.
                            onChange={(event) =>
                              toggleAtListIndex(
                                cues,
                                index,
                                (event.nativeEvent as MouseEvent).shiftKey,
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 break-words leading-snug">
                            {formatCueLabel(cue)}
                          </span>
                          {checked ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className={cn(
                                "h-6 min-w-6 shrink-0 rounded px-1.5 text-[11px]",
                                isAnchor
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:bg-muted",
                              )}
                              title={isAnchor ? "取消锚点句" : "标为锚点句"}
                              aria-label={isAnchor ? "取消锚点句" : "标为锚点句"}
                              aria-pressed={isAnchor}
                              onClick={(event) => {
                                event.preventDefault();
                                setAnchorCueIndex(
                                  anchorCueIndex === cue.index
                                    ? null
                                    : cue.index,
                                );
                              }}
                            >
                              锚
                            </Button>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                将引用当前播放位置之前的最近 3 句字幕
              </p>
            )}

            {quotePreview.length > 0 ? (
              <ScrollArea className="h-24 rounded border border-border/40">
                <div className="space-y-0.5 p-2 text-[11px] text-muted-foreground">
                  {quotePreview.map((quote) => (
                    <p
                      key={`${quote.index}-${quote.startMs}`}
                      className={cn(
                        "break-words",
                        quote.anchor && "font-medium text-foreground",
                      )}
                    >
                      {quote.anchor ? "▸ " : "· "}
                      {quote.text}
                    </p>
                  ))}
                </div>
              </ScrollArea>
            ) : quoteMode === "manual" ? (
              <p className="text-[11px] text-muted-foreground">
                请勾选要引用的台词
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                此位置附近暂无可引用台词
              </p>
            )}
          </div>
        ) : null}

        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={!body.trim() || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              mediaPath,
              positionMs,
              body: body.trim(),
              subtitleChoiceId: includeQuotes ? subtitleChoiceId : null,
              anchorCueIndex:
                includeQuotes && quoteMode === "manual" ? anchorCueIndex : null,
              quoteCueIndices:
                includeQuotes && quoteMode === "manual"
                  ? selectedQuoteIndices
                  : null,
              includeQuotes,
              includeFrame,
            })
          }
        >
          保存批注
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <p
        ref={savedHeadingRef}
        tabIndex={-1}
        className="text-[11px] font-medium text-muted-foreground focus:outline-none"
      >
        已保存
      </p>
      {/* Saved list owns its scroll; min-h keeps a real viewport at short heights. */}
      <div className="min-h-[5rem] flex-1 space-y-1 overflow-auto">
        {(notes ?? []).map((note) => {
          const confirming = pendingDeleteId === note.id;
          const deleting =
            deleteMutation.isPending && deleteMutation.variables === note.id;
          return (
          <div
            key={note.id}
            className="flex flex-col gap-1 rounded-md border border-border px-2 py-1.5 text-xs"
          >
            <div className="flex items-start gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-auto shrink-0 rounded-none px-0 py-0 font-mono text-primary hover:bg-transparent hover:underline"
                onClick={() => void seek(note.positionMs)}
              >
                {formatTime(note.positionMs)}
              </Button>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{note.body}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                ref={(el) => {
                  if (el) {
                    recapTriggerRefs.current.set(note.id, el);
                  } else {
                    recapTriggerRefs.current.delete(note.id);
                  }
                }}
                className="h-7 shrink-0 px-2 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-primary"
                title="生成打卡卡片"
                onClick={() => openRecap(note.id)}
              >
                打卡卡片
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                ref={(el) => {
                  if (el) {
                    deleteTriggerRefs.current.set(note.id, el);
                  } else {
                    deleteTriggerRefs.current.delete(note.id);
                  }
                }}
                className="h-7 shrink-0 px-2 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-destructive"
                title="删除这条批注"
                aria-expanded={confirming}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (deleteMutation.isPending) return;
                  if (confirming) {
                    cancelDelete(note.id);
                  } else {
                    openDeleteMediaRef.current = mediaPath;
                    setPendingDeleteId(note.id);
                  }
                }}
              >
                删除
              </Button>
            </div>
            {confirming ? (
              <div
                role="group"
                aria-label={`确认删除 ${formatTime(note.positionMs)} 的批注`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancelDelete(note.id);
                  }
                }}
                className="rounded border border-destructive/40 bg-destructive/5 p-2"
              >
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  删除后无法恢复。确认删除这条批注吗？
                </p>
                <div className="flex gap-1.5">
                  <Button
                    ref={deleteCancelRef}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={deleting}
                    onClick={() => cancelDelete(note.id)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 border-destructive/50 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={deleting}
                    onClick={() => {
                      if (deleteMutation.isPending) return;
                      // Stale scope (media switched) or vanished row: never
                      // fire the delete for a confirm that is no longer valid.
                      if (mediaPath !== openDeleteMediaRef.current) return;
                      if (
                        notes !== undefined &&
                        !notes.some((entry) => entry.id === note.id)
                      ) {
                        return;
                      }
                      deleteMutation.mutate(note.id);
                    }}
                  >
                    {deleting ? "删除中…" : "确认删除"}
                  </Button>
                </div>
              </div>
            ) : null}
            {note.quotes?.length ? (
              <div className="border-l-2 border-muted pl-2 text-[11px] text-muted-foreground">
                {note.quotes.map((quote) => (
                  <p
                    key={`${note.id}-${quote.index}`}
                    className={cn("break-words", quote.anchor && "font-medium text-foreground")}
                  >
                    {quote.text}
                  </p>
                ))}
              </div>
            ) : null}
            {note.frames?.length ? (
              <div className="flex flex-wrap gap-1">
                {note.frames.map((frame) => (
                  <NoteFrameThumb
                    key={`${note.id}-${frame.file}`}
                    noteId={note.id}
                    atMs={frame.atMs}
                  />
                ))}
              </div>
            ) : null}
          </div>
          );
        })}
        {notesQuery.data?.length === 0 ? (
          <p className="text-muted-foreground">暂无批注</p>
        ) : null}
      </div>

      {exportSavedPath ? (
        <p className="text-[11px] text-muted-foreground">
          已保存至 {exportSavedPath}
        </p>
      ) : null}
        </>
      )}
    </div>
  );
}
