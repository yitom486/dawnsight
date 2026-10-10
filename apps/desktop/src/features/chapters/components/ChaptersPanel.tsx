import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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
} from "@dawnsight/chat-ui";
import { profilesSignature } from "@dawnsight/chat-ui/profilesSignature";
import { useAgentModelControls } from "@/features/acp/useAgentModelControls";
import { useChapterAgentSettingsStore } from "@dawnsight/chat-ui/chapterAgentSettingsStore";

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
  const isRunning =
    segmentation.isPending || segmentation.taskStatus === "running";
  return (
    <div className="border-t border-border/70">
      <div className="space-y-2.5 p-3 text-xs">
        <ResegmentProgress segmentation={segmentation} />
        <ResegmentModelControls disabled={isRunning} />
      </div>
      {!isRunning ? (
        segmentation.status === "completed" ? (
          <div className="p-3 pt-0 space-y-2 text-xs">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={start}
            >
              重新执行 AI 分段
            </Button>
          </div>
        ) : (
          <EmptyChaptersState
            onStartAiSegmentation={start}
            showModelControls={false}
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
        )
      ) : null}
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
  const isRunning =
    segmentation.isPending || segmentation.taskStatus === "running";

  const isQueued = phase !== null;
  const isEvidence =
    phase === "preparing_evidence" ||
    phase === "agent_running" ||
    phase === "checking_result" ||
    phase === "succeeded";
  const isAgent =
    phase === "agent_running" ||
    phase === "checking_result" ||
    phase === "succeeded";
  const isCheck = phase === "succeeded" || failing;

  const activeStepId = failing
    ? "check"
    : phase === "checking_result"
      ? "check"
      : phase === "agent_running"
        ? "agent"
        : phase === "preparing_evidence"
          ? "evidence"
          : phase !== null && phase !== "succeeded"
            ? "queued"
            : null;

  const steps = [
    { id: "queued", label: "排队", done: isQueued, active: activeStepId === "queued", bad: false },
    { id: "evidence", label: "取证", done: isEvidence, active: activeStepId === "evidence", bad: false },
    { id: "agent", label: "Agent", done: isAgent, active: activeStepId === "agent", bad: false },
    { id: "check", label: failing ? "校验未过" : "校验落库", done: isCheck, active: activeStepId === "check" && !failing, bad: failing },
  ];

  const attemptText =
    typeof snapshot?.attemptCount === "number" && typeof snapshot?.maxAttempts === "number"
      ? `尝试 ${snapshot.attemptCount}/${snapshot.maxAttempts}`
      : null;

  const currentMessage =
    live?.message ?? segmentation.taskStatus ?? snapshot?.status ?? "尚未开始";

  return (
    <section
      aria-label="重分段进度"
      className="space-y-2.5 rounded-lg border border-border/70 bg-card/60 p-2.5 shadow-sm backdrop-blur-sm"
    >
      <ol className="flex items-center justify-between gap-1 rounded-md bg-muted/40 p-1 text-[11px]">
        {steps.map((step, index) => (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1">
            <span
              aria-current={step.done ? "step" : undefined}
              className={
                step.bad
                  ? "flex w-full items-center justify-center gap-1 rounded-md bg-destructive px-1.5 py-1 text-center font-medium text-destructive-foreground shadow-sm"
                  : step.active
                    ? "relative flex w-full items-center justify-center gap-1 rounded-md border border-primary/40 bg-primary/20 px-1.5 py-1 text-center font-medium text-primary shadow-[0_0_10px_rgba(56,189,248,0.2)]"
                    : step.done
                      ? "flex w-full items-center justify-center gap-1 rounded-md bg-accent px-1.5 py-1 text-center font-normal text-foreground"
                      : "flex w-full items-center justify-center gap-1 rounded-md bg-transparent px-1.5 py-1 text-center font-normal text-muted-foreground/60"
              }
            >
              {step.active ? (
                <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              ) : null}
              <span className="truncate">{step.label}</span>
            </span>
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`shrink-0 select-none text-[10px] ${
                  step.done ? "text-primary/70 font-semibold" : "text-muted-foreground/40"
                }`}
              >
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {isRunning ? (
        <div className="relative overflow-hidden rounded-md border border-primary/30 bg-primary/10 p-2.5 transition-all">
          <div className="flex items-start gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0 mt-1" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-80" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-xs font-medium text-foreground">
                  {currentMessage}
                </span>
                {draftCount > 0 ? (
                  <span className="shrink-0 rounded-full border border-primary/30 bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    草稿 {draftCount} 段
                  </span>
                ) : null}
              </div>
              <div className="relative h-1 w-full overflow-hidden rounded-full bg-primary/20">
                <div className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
          <span>{currentMessage}</span>
          <div className="flex items-center gap-1.5">
            {attemptText ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {attemptText}
              </span>
            ) : null}
            {draftCount > 0 ? (
              <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                草稿 {draftCount} 段
              </span>
            ) : null}
          </div>
        </div>
      )}

      {isRunning && segmentation.taskStatus === "running" ? (
        <p className="text-[11px] text-muted-foreground/80">运行中暂不支持取消，请等待本轮结束。</p>
      ) : null}

      {segmentation.canCancel || segmentation.isCancelling ? (
        <div className="flex items-center gap-2 pt-0.5">
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
        </div>
      ) : null}

      {segmentation.taskStatus === "failed" && snapshot?.failureMessage ? (
        <div className="pt-0.5">
          <span className="min-w-0 flex-1 truncate text-[11px] text-destructive">
            {snapshot.failureMessage}
          </span>
        </div>
      ) : null}
    </section>
  );
}

// Share the runtime registry, catalogue and controls; chapter selections and
// execution sessions stay separate from chat. Native controls do not overlay HWND.
function ResegmentModelControls({ disabled }: { disabled: boolean }) {
  const chatProfileId = useAcpProfilesStore((s) => s.activeProfileId);
  const selectedProfileId = useChapterAgentSettingsStore((s) => s.profileId);
  const activeProfileId = selectedProfileId ?? chatProfileId;
  const profiles = useAcpProfilesStore((s) => s.profiles);
  const profilesSig = useAcpProfilesStore((s) => profilesSignature(s.profiles));
  const switchActiveProfileId = useChapterAgentSettingsStore((s) => s.selectProfile);
  const statusQuery = useQuery({
    // Identical key/shape to the chat panel (`AcpPanel`): one shared cache
    // entry, so a connect in AI 对话 refreshes this panel automatically and
    // both surfaces always see the same advertised lists.
    queryKey: ["acp-status", activeProfileId ?? null, profilesSig],
    queryFn: () => {
      const state = useAcpProfilesStore.getState();
      return getAcpStatus(profilesHintFromStore(activeProfileId, state.profiles));
    },
    retry: false,
    staleTime: 15_000,
  });
  const models = useAgentModelControls({
    status: statusQuery.data,
    sessionConnected: false,
    purpose: "chapter",
  });
  const profileOptions =
    profiles.length > 0
      ? profiles
      : activeProfileId?.trim()
        ? [{ id: activeProfileId, name: activeProfileId }]
        : [];
  return (
    <section aria-label="重分段运行时" className="space-y-1.5 rounded-md border border-border/70 p-2">
      <p className="text-[11px] text-muted-foreground">
        运行时：{activeProfileId?.trim() || "未配置"} · {models.modelId.trim() || "Agent 默认"} ·{" "}
        {models.reasoningEffort.trim() || "默认档"}
      </p>
      <p className="text-[11px] text-muted-foreground">修改下次启动/重试生效；章节配置独立保存。</p>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">运行时</span>
          <select
            aria-label="重分段运行时"
            value={activeProfileId}
            disabled={disabled || profileOptions.length === 0}
            onChange={(event) => {
              switchActiveProfileId(event.target.value);
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
              disabled={disabled || models.discoverBusy}
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
          <Button type="button" size="sm" variant="ghost" disabled={disabled || models.discoverBusy || !models.canDiscover}
            onClick={() => { void models.discoverModels(); }} className="h-7 shrink-0 px-2.5 text-xs font-normal">
            {models.discoverBusy ? "正在获取配置…" : "刷新配置"}
          </Button>
        </div>
      </div>
      {models.controlError ? <p role="alert" className="text-[11px] text-destructive">{models.controlError}</p> : null}
      {!models.discoverBusy && !models.controlError && models.hasModelOptions && !models.hasReasoningOptions ? <p className="text-[11px] text-muted-foreground">该模型未提供可选思考档，将使用默认设置。</p> : null}
      {!models.discoverBusy && !models.controlError && !models.hasModelOptions ? <p className="text-[11px] text-muted-foreground">该运行时未提供模型列表，可使用默认模型。</p> : null}
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
  showModelControls = true,
}: ChaptersPanelProps & { description: string; errorMessage?: string | null; showModelControls?: boolean }) {
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
      {showModelControls ? <ResegmentModelControls disabled={aiSegmentationStatus === "pending"} /> : null}
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
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>AI 章节草稿 · 已从任务大纲持久化</span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-mono font-medium text-foreground">
          {chapters.length} 章节
        </span>
      </div>
      {progressMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="truncate">{progressMessage}</span>
        </div>
      ) : null}
      <div className="space-y-1">
        {chapters.map((chapter, index) => {
          const active = positionMs >= chapter.startMs && positionMs < chapter.endMs;
          const isSelected = selectedChapter?.id === chapter.id;
          return (
            <Button
              key={`${chapter.id}-${chapter.updatedAtMs}`}
              type="button"
              size="sm"
              variant="ghost"
              className={
                isSelected
                  ? "h-auto w-full items-start gap-2.5 rounded-md border border-primary/40 bg-primary/15 px-2.5 py-2 text-left text-xs font-normal shadow-sm"
                  : active
                    ? "h-auto w-full items-start gap-2.5 rounded-md bg-accent px-2.5 py-2 text-left text-xs font-normal hover:bg-accent"
                    : "h-auto w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-xs font-normal hover:bg-muted/80"
              }
              aria-pressed={isSelected}
              onClick={() => {
                setSelectedChapterId(chapter.id);
                void seek(chapter.startMs);
              }}
            >
              <span className="shrink-0 font-mono text-xs font-medium text-primary">
                {formatTime(chapter.startMs)}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block font-medium text-foreground">
                  {chapter.title?.trim() || `章节 ${index + 1}`}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {chapterDraftStatusLabel(chapter.status)}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
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
