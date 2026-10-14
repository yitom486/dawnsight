/**
 * Adapted visual reference from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — implemented
 * with Dawnsight shared primitives; not verbatim upstream source.
 *
 * Chat-ui binding for the props-only `community-ai` blocks. This layer resolves
 * display status text via the existing `activityStatus.ts`/`toolStatus.ts`
 * helpers and renders REAL activity data only:
 *
 * - Tool results come from the bound `ChatActivity` (already-merged business
 *   text in `activity.text`, never raw JSON). The integrator (message layer)
 *   looks the activity up by toolCallId from the bound host message and passes
 *   it here as `activity` — these components never look anything up and never
 *   start tool execution.
 * - Failures show the fixed business hint from `toolFailureHint` (never
 *   technical details); the toggle/detail labels below preserve the current
 *   `ChatActivityFeed` copy and are overridable via props.
 * - Approval routing preserves the `PermissionPrompt` contract: the option
 *   whose kind starts with "allow" approves, the option whose kind includes
 *   "reject"/"deny" rejects; `onApprove`/`onReject` are integrator-provided.
 */
import { useState } from "react";

import { cn } from "@dawnsight/ui";
import { Button } from "@dawnsight/ui/button";

import { ApprovalCard } from "@dawnsight/ui/community-ai/approval-card";
import { ContextCard } from "@dawnsight/ui/community-ai/context-card";
import { ThinkingLoadingState } from "@dawnsight/ui/community-ai/loading-state";
import { TaskRow } from "@dawnsight/ui/community-ai/task-row";
import { ToolChip } from "@dawnsight/ui/community-ai/tool-chip";
import type { ToolStatusTone } from "@dawnsight/ui/community-ai/tool-chip";

import { isToolRunning } from "../../activityStatus";
import {
  isToolCancelled,
  isToolFailed,
  isToolSucceeded,
  parseToolDetail,
  toolFailureHint,
  toolStatusLabel,
} from "../../toolStatus";
import type { ChatActivity, PermissionOption } from "../../types";

export type ToolActivityViewProps = {
  /** Real bound activity (looked up by toolCallId by the message layer). */
  activity: ChatActivity;
  defaultExpanded?: boolean;
  /** Toggle copy; defaults preserve the current activity-feed wording. */
  expandLabel?: string;
  collapseLabel?: string;
  failureExpandLabel?: string;
};

/**
 * Collapsed `ToolChip` ↔ expanded `TaskRow` for one tool activity. The detail
 * is the real activity text (failure business hint first, else parsed detail);
 * when there is no detail the chip renders without a toggle. Never executes.
 */
export function ToolActivityView({
  activity,
  defaultExpanded = false,
  expandLabel = "查看输出",
  collapseLabel = "收起",
  failureExpandLabel = "查看原因",
}: ToolActivityViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const title = activity.title ?? activity.toolCallId ?? "";
  const status = toolStatusLabel(activity.status);
  const tone = toStatusTone(activity.status);
  const failed = isToolFailed(activity.status);
  const detail = toolFailureHint(activity.status, activity.text) ??
    parseToolDetail(activity.text);

  if (!expanded || !detail) {
    return (
      <ToolChip
        title={title}
        status={status}
        tone={tone}
        expanded={false}
        onToggle={detail ? () => setExpanded(true) : undefined}
      />
    );
  }
  return (
    <TaskRow
      title={title}
      status={status}
      tone={tone}
      detail={detail}
      expanded
      onToggle={(open) => {
        if (!open) setExpanded(false);
      }}
      expandLabel={failed ? failureExpandLabel : expandLabel}
      collapseLabel={collapseLabel}
    />
  );
}

function toStatusTone(status?: string): ToolStatusTone {
  if (status === "pending") return "pending";
  if (isToolRunning(status)) return "running";
  if (isToolSucceeded(status)) return "success";
  if (isToolFailed(status)) return "failed";
  if (isToolCancelled(status)) return "cancelled";
  return "unknown";
}

export type ApprovalViewProps = {
  /** Prompt title composed by the caller (approval subject). */
  title: string;
  /** Permission options, mapped 1:1 to card actions. */
  options: PermissionOption[];
  /** While the integrator's response call is in flight. */
  busy?: boolean;
  /** Integrator-provided; follows the PermissionPrompt contract. */
  onApprove: (optionId: string) => void;
  /** Integrator-provided; follows the PermissionPrompt contract. */
  onReject: (optionId: string | null) => void;
  /**
   * Fallback button labels when an option arrives without a name (ACP normally
   * provides names). The integrator passes the current copy (允许 / 拒绝).
   */
  approveFallbackLabel?: string;
  rejectFallbackLabel?: string;
};

/**
 * Wraps `ApprovalCard`. Options map 1:1; deny-kind options route to
 * `onReject`, everything else routes to `onApprove`. Never calls the
 * permission transport directly — that stays integrator-owned.
 */
export function ApprovalView({
  title,
  options,
  busy = false,
  onApprove,
  onReject,
  approveFallbackLabel,
  rejectFallbackLabel,
}: ApprovalViewProps) {
  return (
    <div className="space-y-2">
    <ApprovalCard
      title={title}
      busy={busy}
      options={options.map((option) => ({
        optionId: option.optionId,
        label:
          option.name?.trim() ||
          (isDenyOption(option) ? (rejectFallbackLabel ?? "") : (approveFallbackLabel ?? "")) ||
          (isAllowOption(option) ? "允许" : isDenyOption(option) ? "拒绝" : "选择此项"),
        primary: isAllowOption(option),
      }))}
      onSelect={(optionId) => {
        const selected = options.find((item) => item.optionId === optionId);
        if (!selected) {
          onReject(null);
          return;
        }
        if (isDenyOption(selected)) {
          onReject(selected.optionId);
        } else {
          onApprove(selected.optionId);
        }
      }}
    />
    {!options.some(isDenyOption) ? (
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onReject(null)}>
        {rejectFallbackLabel || "拒绝"}
      </Button>
    ) : null}
    </div>
  );
}

/** Same allow/deny matching as `PermissionPrompt` (kind-prefix protocol). */
function isAllowOption(option: PermissionOption): boolean {
  return option.kind?.startsWith("allow") ?? false;
}

function isDenyOption(option: PermissionOption): boolean {
  return (
    option.kind?.includes("reject") === true ||
    option.kind?.includes("deny") === true
  );
}

export type ContextViewProps = {
  anchorMs: number;
  /** Caller-provided label (timestamp text + short description). */
  label: string;
  /** Integrator-owned seek. */
  onSeek: (anchorMs: number) => void;
};

/** Time-reference chip; seeking stays integrator-owned. */
export function ContextView({ anchorMs, label, onSeek }: ContextViewProps) {
  return <ContextCard anchorMs={anchorMs} label={label} onSeek={onSeek} />;
}

export type ThoughtTraceViewProps = {
  /** Projected header copy ("思考"/"计划" fallbacks resolved by caller). */
  title: string;
  /** Safety-projected body text (already redacted upstream where required). */
  text: string;
  /** Running run: shimmer title + expanded trace. */
  live?: boolean;
  defaultExpanded?: boolean;
};

/**
 * Thinking-trace row, verbatim-adapted from the upstream Thinking header +
 * expand pattern (sparkle, shimmer-while-working, rotating chevron,
 * grid-rows expand, rail). What it never takes from upstream: the timed
 * staging sequence, the variant picker, and fabricated durations
 * ("Thought for 4 seconds") — rows render only caller-provided projected
 * copy, all visible at once, expanded by default while running.
 */
export function ThoughtTraceView({
  title,
  text,
  live = false,
  defaultExpanded,
}: ThoughtTraceViewProps) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const autoExpanded = defaultExpanded ?? live;
  const expanded = manualExpanded ?? autoExpanded;
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? autoExpanded))}
        className="flex min-h-7 w-fit items-center gap-2 rounded-md px-1 py-0.5 text-[length:var(--text-chat-meta)] leading-[var(--text-chat-meta--line-height)] transition-colors duration-100 hover:bg-muted"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden
          className={cn("shrink-0", live ? "text-foreground/70" : "text-muted-foreground")}
          fill="currentColor"
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {live ? (
          <span className="bui-shimmer-text whitespace-nowrap bg-clip-text font-medium text-transparent motion-reduce:animate-none">
            {title}
          </span>
        ) : (
          <span className="whitespace-nowrap font-medium text-foreground/80">
            {title}
          </span>
        )}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="relative ml-[5px] mt-1 pl-4">
            <span aria-hidden className="absolute bottom-1 left-[3px] top-1 w-px bg-border" />
            <p className="whitespace-pre-wrap break-words py-1 text-[length:var(--text-chat-meta)] leading-relaxed text-muted-foreground">
              {text}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export type LoadingStateViewProps = {
  /** Real run-state copy (waitingLabel output). */
  label: string;
};

/** Waiting row: pixel grid + label + honest mount-clock. */
export function LoadingStateView({ label }: LoadingStateViewProps) {
  return <ThinkingLoadingState label={label} />;
}
