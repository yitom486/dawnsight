import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "@dawnsight/ui/button";
import { Input } from "@dawnsight/ui/input";

import { useMediaInfoQuery } from "@/features/media";
import { usePlayerStore } from "@/features/player";
import { ytdlResolveKey } from "@dawnsight/query-keys";
import { getCachedYtdlResolve } from "@/features/ytdl";
import { getAcpStatus } from "@/features/acp/api";
import { formatTime } from "@/lib/format";
import type { MediaChapter } from "@dawnsight/contracts";
import { chapterAssetKey, getChapterAsset, parseDraftChapters } from "../api";
import type { ChapterAssetData, ChapterDetailSnapshot, ChapterDraftSnapshot } from "../api";
import { useChapterSegmentation } from "../hooks/useChapterSegmentation";
import {
  profilesHintFromStore,
  useAcpProfilesStore,
  useChatUiStore,
} from "@dawnsight/chat-ui";
import { profilesSignature } from "@dawnsight/chat-ui/profilesSignature";
import { useAgentModelControls } from "@/features/acp/useAgentModelControls";

// Panel-local option tuning: semantic popover tokens so the native popup
// follows both themes without hardcoding colors or touching packages/ui.
// NOTE: plain <select> (no overlay chevron component) is deliberate here —
// the shared chevron overlay misaligned over the text in this narrow panel.
const resegmentOptionClassName = "bg-popover text-popover-foreground";
const resegmentControlClassName =
  "h-7 w-full min-w-0 truncate rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground disabled:opacity-60";

export type AiSegmentationStatus =
  | "unavailable"
  | "ready"
  | "pending"
  | "validation_failure"
  | "completed"
  | "failed";

export type ChaptersPanelProps = {
  /** Starts the user-requested AI chapter segmentation job when wired by the app. */
  onStartAiSegmentation?: () => void;
  /** The orchestration layer owns this state; the panel never starts it on mount. */
  aiSegmentationStatus?: AiSegmentationStatus;
  /** Safe business failure summary supplied by the durable chapter task. */
  failureMessage?: string | null;
  validationSummary?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  canRetry?: boolean;
  retryAction?: "retry" | "configure_agent" | null;
  agentConfigured?: boolean;
  taskStatus?: string | null;
  progressMessage?: string | null;
};

export function ChaptersPanel({
  onStartAiSegmentation,
  aiSegmentationStatus,
}: ChaptersPanelProps) {
  const mediaPath = usePlayerStore((s) => s.currentFile);
  const sourceKind = usePlayerStore((s) => s.sourceKind);
  const seek = usePlayerStore((s) => s.seek);
  const positionMs = usePlayerStore((s) => s.currentTimeMs);
  const isRemote =
    sourceKind === "remote" || (mediaPath?.startsWith("http") ?? false);
  const { data, isLoading, error } = useMediaInfoQuery();
  // Online chapters come from the cached ytdl resolve result shared with the
  // online/transcript/ACP surfaces (same query key, no refetch, no fresh resolve).
  const onlineQuery = useQuery({
    queryKey: ytdlResolveKey(mediaPath),
    queryFn: () => getCachedYtdlResolve(mediaPath as string),
    enabled: Boolean(isRemote && mediaPath),
    retry: false,
    staleTime: Infinity,
  });
  // The resegment poller stays disabled until real chapters are confirmed.
  // An always-on second poller would double `chapter_segmentation_status`
  // traffic and break strictly-sequential consumers of that command.
  const hasRealChapters = isRemote
    ? (onlineQuery.data?.chapters ?? []).length > 0
    : (data?.chapters ?? []).length > 0;
  const segmentation = useChapterSegmentation();
  const resegmentation = useChapterSegmentation({ resegment: true, enabled: hasRealChapters });
  const effectiveSegmentationStatus =
    aiSegmentationStatus ?? segmentation.status;
  const startSegmentation = onStartAiSegmentation ?? segmentation.start;

  if (!mediaPath) {
    return (
      <div className="p-3 text-xs text-muted-foreground">打开含章节元数据的视频后显示。</div>
    );
  }

  if (isRemote) {
    const onlineChapters = onlineQuery.data?.chapters ?? [];
    if (onlineQuery.isLoading) {
      return <div className="p-3 text-xs text-muted-foreground">正在读取在线章节…</div>;
    }
    if (onlineChapters.length === 0) {
      const draftChapters = parseDraftChapters(segmentation.snapshot);
      if (draftChapters.length > 0) {
        return (
          <ChapterDraftList
            chapters={draftChapters}
            positionMs={positionMs}
            seek={seek}
            progressMessage={segmentation.liveProgress?.message}
          />
        );
      }
      return (
        <EmptyChaptersState
          onStartAiSegmentation={startSegmentation}
          aiSegmentationStatus={effectiveSegmentationStatus}
          errorMessage={onStartAiSegmentation ? null : segmentation.errorMessage}
          failureMessage={onStartAiSegmentation ? null : segmentation.failureMessage}
          validationSummary={onStartAiSegmentation ? null : segmentation.validationSummary}
          attemptCount={onStartAiSegmentation ? undefined : segmentation.attemptCount}
          maxAttempts={onStartAiSegmentation ? undefined : segmentation.maxAttempts}
          canRetry={onStartAiSegmentation ? undefined : segmentation.canRetry}
          retryAction={onStartAiSegmentation ? undefined : segmentation.retryAction}
          agentConfigured={onStartAiSegmentation ? undefined : segmentation.agentConfigured}
          taskStatus={onStartAiSegmentation ? undefined : segmentation.taskStatus}
          progressMessage={onStartAiSegmentation ? null : segmentation.liveProgress?.message}
          description="该在线视频暂无真实章节。"
        />
      );
    }
    return (
      <RealChaptersWithResegment
        realChapters={onlineChapters}
        resegmentation={resegmentation}
        onStartAiSegmentation={onStartAiSegmentation}
        positionMs={positionMs}
        seek={seek}
      />
    );
  }

  if (isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">正在探测章节…</div>;
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-muted-foreground">无法读取媒体信息（章节依赖探测）。</div>
    );
  }

  const chapters = data?.chapters ?? [];
  const draftChapters = parseDraftChapters(segmentation.snapshot);
  if (chapters.length === 0) {
    if (draftChapters.length > 0) {
      return (
        <ChapterDraftList
          chapters={draftChapters}
          positionMs={positionMs}
          seek={seek}
          progressMessage={segmentation.liveProgress?.message}
        />
      );
    }
    return (
      <EmptyChaptersState
        onStartAiSegmentation={startSegmentation}
        aiSegmentationStatus={effectiveSegmentationStatus}
        errorMessage={onStartAiSegmentation ? null : segmentation.errorMessage}
        failureMessage={onStartAiSegmentation ? null : segmentation.failureMessage}
        validationSummary={onStartAiSegmentation ? null : segmentation.validationSummary}
        attemptCount={onStartAiSegmentation ? undefined : segmentation.attemptCount}
        maxAttempts={onStartAiSegmentation ? undefined : segmentation.maxAttempts}
        canRetry={onStartAiSegmentation ? undefined : segmentation.canRetry}
        retryAction={onStartAiSegmentation ? undefined : segmentation.retryAction}
        agentConfigured={onStartAiSegmentation ? undefined : segmentation.agentConfigured}
        taskStatus={onStartAiSegmentation ? undefined : segmentation.taskStatus}
        progressMessage={onStartAiSegmentation ? null : segmentation.liveProgress?.message}
        description="该文件暂无容器章节。"
      />
    );
  }

  return (
    <RealChaptersWithResegment
      realChapters={chapters}
      resegmentation={resegmentation}
      onStartAiSegmentation={onStartAiSegmentation}
      positionMs={positionMs}
      seek={seek}
    />
  );
}

function RealChaptersWithResegment({
  realChapters,
  resegmentation,
  onStartAiSegmentation,
  positionMs,
  seek,
}: {
  realChapters: MediaChapter[];
  resegmentation: ReturnType<typeof useChapterSegmentation>;
  onStartAiSegmentation?: () => void;
  positionMs: number;
  seek: (ms: number) => unknown;
}) {
  const [view, setView] = useState<"real" | "draft">("real");
  const draftChapters = parseDraftChapters(resegmentation.snapshot);
  const showToggle = draftChapters.length > 0;
  const showDraft = showToggle && view === "draft";
  // Media switches must not inherit the previous media's view: without drafts
  // this already falls back to real, but a draft-capable next media would
  // otherwise open on the stale "draft" tab.
  const mediaIdentity = resegmentation.request?.episodeKey ?? "";
  const currentFile = usePlayerStore((s) => s.currentFile);
  useEffect(() => {
    setView("real");
  }, [mediaIdentity, currentFile]);
  return (
    <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
      {showToggle ? (
        <div className="flex gap-1 px-3 pt-2" role="tablist" aria-label="章节来源切换">
          <Button
            type="button"
            size="sm"
            variant={view === "real" ? "default" : "ghost"}
            aria-pressed={view === "real"}
            className="h-7 px-2.5 text-xs font-normal"
            onClick={() => setView("real")}
          >
            真实章节
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "draft" ? "default" : "ghost"}
            aria-pressed={view === "draft"}
            className="h-7 px-2.5 text-xs font-normal"
            onClick={() => setView("draft")}
          >
            AI重分段草稿
          </Button>
        </div>
      ) : null}
      {showDraft ? (
        <ChapterDraftList
          chapters={draftChapters}
          positionMs={positionMs}
          seek={seek}
          progressMessage={resegmentation.liveProgress?.message}
        />
      ) : (
        <ChapterList chapters={realChapters} positionMs={positionMs} seek={seek} />
      )}
      <ResegmentSection
        segmentation={resegmentation}
        onStartAiSegmentation={onStartAiSegmentation}
      />
    </div>
  );
}

function ResegmentSection({
  segmentation,
  onStartAiSegmentation,
}: {
  segmentation: ReturnType<typeof useChapterSegmentation>;
  onStartAiSegmentation?: () => void;
}) {
  const start = onStartAiSegmentation ?? segmentation.start;
  return (
    <div className="border-t border-border/70">
      <div className="space-y-2 p-3 text-xs">
        <ResegmentProgress segmentation={segmentation} />
        <ResegmentModelControls disabled={segmentation.isPending} />
      </div>
      <EmptyChaptersState
        onStartAiSegmentation={start}
        aiSegmentationStatus={segmentation.status}
        errorMessage={onStartAiSegmentation ? null : segmentation.errorMessage}
        failureMessage={onStartAiSegmentation ? null : segmentation.failureMessage}
        validationSummary={onStartAiSegmentation ? null : segmentation.validationSummary}
        attemptCount={onStartAiSegmentation ? undefined : segmentation.attemptCount}
        maxAttempts={onStartAiSegmentation ? undefined : segmentation.maxAttempts}
        canRetry={onStartAiSegmentation ? undefined : segmentation.canRetry}
        retryAction={onStartAiSegmentation ? undefined : segmentation.retryAction}
        agentConfigured={onStartAiSegmentation ? undefined : segmentation.agentConfigured}
        taskStatus={onStartAiSegmentation ? undefined : segmentation.taskStatus}
        progressMessage={onStartAiSegmentation ? null : segmentation.liveProgress?.message}
        description="容器章节较粗糙，可用 AI 完全重分段（不删除真实章节）。"
      />
    </div>
  );
}

// Inline progress only: no Portal/fixed overlay, stays in the panel scroll
// column as an HWND sibling so it can never cover the native video surface.
function ResegmentProgress({
  segmentation,
}: {
  segmentation: ReturnType<typeof useChapterSegmentation>;
}) {
  const live = segmentation.liveProgress;
  const snapshot = segmentation.snapshot;
  const draftCount = parseDraftChapters(snapshot).length;
  const phase = live?.phase ?? snapshot?.status ?? null;
  const failing =
    snapshot?.status === "failed" || snapshot?.status === "validation_failure";
  const steps = [
    { id: "queued", label: "排队", done: phase !== null, bad: false },
    { id: "evidence", label: "取证", done: phase === "preparing_evidence" || phase === "agent_running" || phase === "checking_result" || phase === "succeeded", bad: false },
    { id: "agent", label: "Agent", done: phase === "agent_running" || phase === "checking_result" || phase === "succeeded", bad: false },
    { id: "check", label: failing ? "校验未过" : "校验落库", done: phase === "succeeded" || failing, bad: failing },
  ];
  const attemptText =
    typeof snapshot?.attemptCount === "number" && typeof snapshot?.maxAttempts === "number"
      ? `尝试 ${snapshot.attemptCount}/${snapshot.maxAttempts}`
      : null;
  return (
    <section aria-label="重分段进度" className="space-y-1.5 rounded-md border border-border/70 p-2">
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden className="text-muted-foreground">→</span> : null}
            <span
              aria-current={step.done ? "step" : undefined}
              className={
                step.bad
                  ? "rounded-full bg-destructive px-2 py-0.5 text-[11px] text-destructive-foreground"
                  : step.done
                    ? "rounded-full bg-accent px-2 py-0.5 text-[11px] text-foreground"
                    : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        {[live?.message ?? segmentation.taskStatus ?? snapshot?.status ?? "尚未开始", attemptText, draftCount > 0 ? `草稿 ${draftCount} 段` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {segmentation.taskStatus === "running" ? (
        <p className="text-[11px] text-muted-foreground">运行中暂不支持取消，请等待本轮结束。</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!segmentation.canCancel || segmentation.isCancelling}
          onClick={() => segmentation.cancel()}
          className="h-7 px-2.5 text-xs font-normal"
        >
          {segmentation.isCancelling ? "取消中…" : "取消任务"}
        </Button>
        {segmentation.taskStatus === "failed" && snapshot?.failureMessage ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {snapshot.failureMessage}
          </span>
        ) : null}
      </div>
    </section>
  );
}

// Runtime controls reuse the global Agent stores AND the chat composer's
// discovery hook, so the chapter task snapshots the same profile/model/effort
// and sees the same Agent-advertised lists (including the refresh flow).
// sessionConnected=false: selection only patches the store, never pushes to
// the live chat session. Native controls only: no floating Portal that could
// overlay the HWND video area.
function ResegmentModelControls({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const activeProfileId = useAcpProfilesStore((s) => s.activeProfileId);
  const profiles = useAcpProfilesStore((s) => s.profiles);
  const profilesSig = useAcpProfilesStore((s) => profilesSignature(s.profiles));
  const switchActiveProfileId = useAcpProfilesStore((s) => s.switchActiveProfileId);
  const openChat = useChatUiStore((s) => s.openChat);
  const statusQuery = useQuery({
    // Identical key/shape to the chat panel (`AcpPanel`): one shared cache
    // entry, so a connect in AI 对话 refreshes this panel automatically and
    // both surfaces always see the same advertised lists.
    queryKey: ["acp-status", activeProfileId ?? null, profilesSig],
    queryFn: () => {
      const state = useAcpProfilesStore.getState();
      return getAcpStatus(profilesHintFromStore(state.activeProfileId, state.profiles));
    },
    retry: false,
    staleTime: 15_000,
  });
  const models = useAgentModelControls({
    status: statusQuery.data,
    sessionConnected: false,
  });
  // Alignment: the model belongs to a profile. The panel keeps a small
  // per-profile memory: switching away stashes the old profile's model,
  // switching back restores it (falling back to Agent default for profiles
  // with no remembered choice). A stale cross-profile combination can therefore
  // never be snapshotted into a chapter task, and a deliberate choice is never
  // blanked. The hook's defaults-merge still fills the advertised current
  // model when the new profile has no memory yet.
  const alignedProfileRef = useRef(activeProfileId);
  const modelMemoryRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (alignedProfileRef.current === activeProfileId) return;
    const prev = alignedProfileRef.current;
    alignedProfileRef.current = activeProfileId;
    modelMemoryRef.current[prev] = models.modelId;
    models.patchSettings({
      modelId: modelMemoryRef.current[activeProfileId] ?? "",
      reasoningEffort: "",
    });
  }, [activeProfileId, models.modelId, models.patchSettings]);
  // reasoningEffort is cleared too: isolated engine sessions honor it via
  // `session/set_config`, so effort is chapter-relevant (per-profile) state.
  // Model lists likewise come only from the live session advertisement
  // (`acp_status.sessionModelOptions`); the discovery endpoint is a backend
  // stub, so this panel never calls it.
  const profileOptions =
    profiles.length > 0
      ? profiles
      : activeProfileId?.trim()
        ? [{ id: activeProfileId, name: activeProfileId }]
        : [];
  // The only working list source is the LIVE session's advertisement. When it
  // belongs to another runtime, this panel honestly has no list — name both
  // sides instead of showing a mysterious empty input.
  const liveProfileId = statusQuery.data?.activeProfileId ?? "";
  const liveModelCount = statusQuery.data?.sessionModelOptions?.models.length ?? 0;
  const showSessionMismatch =
    liveProfileId !== "" &&
    liveProfileId !== activeProfileId &&
    !models.hasModelOptions;
  const liveProfile = profiles.find((profile) => profile.id === liveProfileId);
  const liveProfileName =
    (liveProfile && "name" in liveProfile && liveProfile.name) || liveProfileId;
  return (
    <section aria-label="重分段运行时" className="space-y-1.5 rounded-md border border-border/70 p-2">
      <p className="text-[11px] text-muted-foreground">
        运行时：{activeProfileId?.trim() || "未配置"} · {models.modelId.trim() || "Agent 默认"} ·{" "}
        {models.reasoningEffort.trim() || "默认档"}
      </p>
      <p className="text-[11px] text-muted-foreground">修改下次启动/重试生效，运行中不改；切换运行时会同步影响 AI 对话。</p>
      {showSessionMismatch ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            AI 对话已连接{liveProfileName}
            {liveModelCount > 0 ? `（${liveModelCount} 个模型）` : ""}，章节当前选的是
            {activeProfileId}暂无列表——切回可下拉选择，或在对话里连上{activeProfileId}。
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={openChat}
            className="h-7 px-2.5 text-xs font-normal"
          >
            去 AI 对话连接
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">运行时</span>
          <select
            aria-label="重分段运行时"
            value={activeProfileId}
            disabled={disabled || profileOptions.length === 0}
            onChange={(event) => {
              switchActiveProfileId(event.target.value);
              // Mirror AcpPanel.handleSwitchProfile: status-derived lists
              // (models/effort) are keyed off acp-status, so refresh them.
              // Chat-transient cleanup (queue/permission/proposals) stays owned
              // by AcpPanel and is intentionally not duplicated here.
              void queryClient.invalidateQueries({ queryKey: ["acp-status"] });
            }}
            className={resegmentControlClassName}
          >
            {profileOptions.map((profile) => (
              <option
                key={profile.id}
                value={profile.id}
                className={resegmentOptionClassName}
              >
                {"name" in profile && profile.name ? profile.name : profile.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">模型</span>
          {models.hasModelOptions ? (
            <select
              aria-label="重分段模型"
              value={models.modelId}
              disabled={disabled || models.controlsDisabled}
              onChange={(event) => {
                void models.applyModelSelection({ modelId: event.target.value });
              }}
              className={resegmentControlClassName}
            >
              <option value="" className={resegmentOptionClassName}>
                Agent 默认
              </option>
              {models.modelOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  className={resegmentOptionClassName}
                >
                  {option.name}
                </option>
              ))}
            </select>
          ) : (
            <Input
              aria-label="重分段模型"
              type="text"
              value={models.modelId}
              disabled={disabled}
              placeholder="留空用 Agent 默认"
              onChange={(event) => models.patchSettings({ modelId: event.target.value })}
              className="h-7 w-full min-w-0 px-2 text-xs"
            />
          )}
        </label>
        <div className="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">思考档</span>
          <select
            aria-label="重分段思考档"
            value={models.reasoningEffort}
            disabled={disabled || models.controlsDisabled}
            onChange={(event) => {
              void models.applyModelSelection({ reasoningEffort: event.target.value });
            }}
            className={resegmentControlClassName}
          >
            <option value="" className={resegmentOptionClassName}>
              默认档
            </option>
            {models.reasoningOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className={resegmentOptionClassName}
              >
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {!models.hasModelOptions ? (
            <>
              <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                连接一次 AI 对话后，这里可下拉选择该运行时模型。
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={openChat}
                className="h-7 shrink-0 px-2.5 text-xs font-normal"
              >
                去 AI 对话
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function EmptyChaptersState({
  description,
  onStartAiSegmentation,
  aiSegmentationStatus,
  errorMessage,
  failureMessage,
  validationSummary,
  attemptCount,
  maxAttempts,
  canRetry = false,
  retryAction,
  agentConfigured = true,
  taskStatus,
  progressMessage,
}: ChaptersPanelProps & { description: string; errorMessage?: string | null }) {
  const retryableFailure =
    (aiSegmentationStatus === "validation_failure" ||
      aiSegmentationStatus === "failed") &&
    canRetry;
  const needsAgentConfiguration =
    retryAction === "configure_agent" || !agentConfigured;
  const canStartAiSegmentation =
    Boolean(onStartAiSegmentation) &&
    agentConfigured &&
    (aiSegmentationStatus === "ready" || retryableFailure);
  const handleStartAiSegmentation = () => {
    if (canStartAiSegmentation) {
      onStartAiSegmentation?.();
    }
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-xs">
      <div className="space-y-1 text-muted-foreground">
        <p>{description}</p>
        <p>点击后会创建独立章节 Agent 任务，结合字幕与按需画面生成语义章节。</p>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-auto rounded-md px-3 py-1.5 text-xs font-normal"
        disabled={!canStartAiSegmentation}
        onClick={handleStartAiSegmentation}
      >
        {aiSegmentationStatus === "pending"
          ? taskStatus === "running"
            ? "正在分析字幕与画面…"
            : "已排队，等待执行…"
          : aiSegmentationStatus === "completed"
            ? "AI 分段已完成，等待章节写入…"
            : retryableFailure
              ? "再次尝试"
              : aiSegmentationStatus === "validation_failure" ||
                  aiSegmentationStatus === "failed"
                ? "AI 分段失败"
              : "开始 AI 分段"}
      </Button>
      {needsAgentConfiguration &&
      (aiSegmentationStatus === "unavailable" ||
        aiSegmentationStatus === "pending" ||
        aiSegmentationStatus === "validation_failure" ||
        aiSegmentationStatus === "failed") ? (
        <p className="text-[11px] text-muted-foreground">
          尚未配置可用的 AI Agent，请先在设置中完成配置后再开始章节分析。
        </p>
      ) : null}
      {failureMessage ? <p className="text-destructive">{failureMessage}</p> : null}
      {validationSummary ? (
        <p className="text-[11px] text-muted-foreground">{validationSummary}</p>
      ) : null}
      {(aiSegmentationStatus === "validation_failure" ||
        aiSegmentationStatus === "failed") &&
      agentConfigured ? (
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {typeof attemptCount === "number" && typeof maxAttempts === "number" ? (
            <p>
              已尝试 {attemptCount} / {maxAttempts} 次
              {maxAttempts > 0 && attemptCount >= maxAttempts
                ? "，已达到尝试上限。"
                : "。"}
            </p>
          ) : null}
          {retryableFailure && retryAction === "retry" ? (
            <p>再次尝试会创建新的独立章节 Agent 会话，不会写入自由聊天。</p>
          ) : null}
          {!retryableFailure && maxAttempts && attemptCount && attemptCount >= maxAttempts ? (
            <p>已达到自动校验和作业尝试上限，请检查字幕、画面证据或 Agent 设置后再处理。</p>
          ) : null}
        </div>
      ) : null}
      {aiSegmentationStatus === "pending" && agentConfigured ? (
        <p className="text-[11px] text-muted-foreground">
          {progressMessage ??
            "任务已保存，章节 Agent 正在独立执行；不会写入自由聊天，也不会自动重复启动。"}
        </p>
      ) : null}
      {aiSegmentationStatus === "completed" ? (
        <p className="text-[11px] text-muted-foreground">
          结果已通过校验并保存，章节列表将在任务投影完成后显示。
        </p>
      ) : null}
      {aiSegmentationStatus === "unavailable" && agentConfigured && errorMessage ? (
        <p className="text-[11px] text-muted-foreground">{errorMessage}</p>
      ) : null}
    </div>
  );
}

function ChapterList({
  chapters,
  positionMs,
  seek,
}: {
  chapters: MediaChapter[];
  positionMs: number;
  seek: (ms: number) => unknown;
}) {
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-auto p-3">
      {chapters.map((chapter, index) => {
        const active =
          positionMs >= chapter.startMs &&
          (chapter.endMs == null || positionMs < chapter.endMs);
        return (
          <Button
            key={`${chapter.id}-${chapter.startMs}`}
            type="button"
            size="sm"
            variant="ghost"
            className={
              active
                ? "h-auto w-full items-start gap-2 rounded-md bg-accent px-2 py-1.5 text-left text-xs font-normal hover:bg-accent"
                : "h-auto w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal hover:bg-muted"
            }
            onClick={() => void seek(chapter.startMs)}
          >
            <span className="shrink-0 font-mono text-primary">
              {formatTime(chapter.startMs)}
            </span>
            <span className="min-w-0 flex-1">
              {chapter.title?.trim() || `章节 ${index + 1}`}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function ChapterDraftList({
  chapters,
  positionMs,
  seek,
  progressMessage,
}: {
  chapters: ChapterDraftSnapshot[];
  positionMs: number;
  seek: (ms: number) => unknown;
  progressMessage?: string | null;
}) {
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(
    chapters[0]?.id ?? null,
  );
  const selectedChapter =
    chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0];

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
      <div className="text-xs text-muted-foreground">
        AI 章节草稿 · 已从任务大纲持久化
      </div>
      {progressMessage ? (
        <div className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
          {progressMessage}
        </div>
      ) : null}
      {chapters.map((chapter, index) => {
        const active = positionMs >= chapter.startMs && positionMs < chapter.endMs;
        return (
          <Button
            key={`${chapter.id}-${chapter.updatedAtMs}`}
            type="button"
            size="sm"
            variant="ghost"
            className={
              active
                ? "h-auto w-full items-start gap-2 rounded-md bg-accent px-2 py-1.5 text-left text-xs font-normal hover:bg-accent"
                : "h-auto w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal hover:bg-muted"
            }
            aria-pressed={selectedChapter?.id === chapter.id}
            onClick={() => {
              setSelectedChapterId(chapter.id);
              void seek(chapter.startMs);
            }}
          >
            <span className="shrink-0 font-mono text-primary">
              {formatTime(chapter.startMs)}
            </span>
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block">
                {chapter.title?.trim() || `章节 ${index + 1}`}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {chapterDraftStatusLabel(chapter.status)}
              </span>
            </span>
          </Button>
        );
      })}
      {selectedChapter ? (
        <ChapterDetailView detail={selectedChapter.detail} />
      ) : null}
    </div>
  );
}

function ChapterDetailView({
  detail,
}: {
  detail?: ChapterDetailSnapshot | null;
}) {
  const coverAssetRef = detail?.coverAssetRef ?? null;
  const coverQuery = useQuery({
    queryKey: chapterAssetKey(coverAssetRef),
    queryFn: () => getChapterAsset(coverAssetRef as string),
    enabled: Boolean(coverAssetRef),
    staleTime: Infinity,
    retry: false,
  });

  if (!detail) {
    return (
      <section className="space-y-1 rounded-lg border border-border bg-card p-3 text-xs">
        <h3 className="font-medium text-foreground">章节详情</h3>
        <p className="text-muted-foreground">详情尚未生成，当前仅显示章节大纲。</p>
      </section>
    );
  }

  const evidenceCount = detail.evidenceAssetRefs.length;
  const metadata = [
    detail.revisionNumber ? `第 ${detail.revisionNumber} 版` : null,
    detail.revisionStatus === "accepted" ? "已通过校验" : null,
    evidenceCount > 0 ? `${evidenceCount} 个画面证据` : null,
  ].filter(Boolean);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">章节详情</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {metadata.length > 0 ? metadata.join(" · ") : "来自已保存的章节内容"}
          </p>
        </div>
        {detail.coverAssetRef ? (
          <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            {coverQuery.data ? "代表画面" : "含代表画面"}
          </span>
        ) : null}
      </div>

      <ChapterAssetPreview
        asset={coverQuery.data}
        loading={coverQuery.isLoading}
        unavailable={Boolean(coverAssetRef) && Boolean(coverQuery.error || coverQuery.data === null)}
      />

      <ChapterDetailSection title="前情提要" value={detail.recap} empty="暂无前情提要" />
      <ChapterDetailList
        title="本章不剧透的观看重点"
        values={detail.watchPoints}
        empty="暂无观看重点"
      />
      <ChapterDetailSection title="本章剧情" value={detail.mainline} empty="暂无剧情详情" />
      <ChapterDetailSection title="后续看点" value={detail.outlook} empty="暂无后续看点" />
      <ChapterDetailList
        title="可以留意的问题"
        values={detail.questions}
        empty="暂无问题候选"
      />
    </section>
  );
}

function ChapterAssetPreview({
  asset,
  loading,
  unavailable,
}: {
  asset?: ChapterAssetData | null;
  loading: boolean;
  unavailable: boolean;
}) {
  if (asset) {
    return (
      <div className="overflow-hidden rounded-md border border-border bg-muted">
        <img
          src={`data:${asset.mime};base64,${asset.data}`}
          alt="章节代表画面"
          className="max-h-48 w-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label="章节代表画面占位"
      className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted px-3 text-center text-[11px] text-muted-foreground"
    >
      {loading ? "正在读取代表画面…" : unavailable ? "代表画面暂不可用" : "暂无代表画面"}
    </div>
  );
}

function ChapterDetailSection({
  title,
  value,
  empty,
}: {
  title: string;
  value: string | null;
  empty: string;
}) {
  return (
    <div className="space-y-1">
      <h4 className="font-medium text-foreground">{title}</h4>
      <p className="whitespace-pre-wrap leading-5 text-muted-foreground">{value?.trim() || empty}</p>
    </div>
  );
}

function ChapterDetailList({
  title,
  values,
  empty,
}: {
  title: string;
  values: string[];
  empty: string;
}) {
  return (
    <div className="space-y-1">
      <h4 className="font-medium text-foreground">{title}</h4>
      {values.length > 0 ? (
        <ul className="space-y-1 text-muted-foreground">
          {values.map((value, index) => (
            <li key={`${value}-${index}`} className="flex gap-2 leading-5">
              <span className="text-primary" aria-hidden="true">
                ·
              </span>
              <span>{value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function chapterDraftStatusLabel(status: ChapterDraftSnapshot["status"]): string {
  switch (status) {
    case "waiting_evidence":
      return "等待取证";
    case "analyzing":
      return "分析中";
    case "generated":
      return "已生成";
    case "validation_failed":
      return "校验失败";
  }
}
