/**
 * Verbatim-adapted from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — source
 * obtained via the per-section "Copy code" button on 2026-10-14
 * (`.plan/chat-ui-rebuild/upstream/toolChips.clip.txt`).
 *
 * Adopted verbatim: h-7 hover-pill row grammar (-mx bleed + px room),
 * 12.5px medium title, inline status slot, chevron reveal interaction.
 * Deliberately not shipped: the timed step reveal, demo rows/diffs, the
 * file-diff chips + hover portal (no diff data exists in our domain), the
 * no-op "+2 more" button, and the run header (our rows render per message).
 * Deviations forced by product contract: the status dot stays always visible
 * (upstream swaps its icon away on hover; our run states must never be
 * color-or-nothing) and CJK status copy stays non-mono.
 *
 * Props-only: every user-visible string arrives via props — status text is
 * resolved by the caller. No stores, no Tauri imports, no business copy, no
 * tool execution.
 */
import { ChevronDown } from "lucide-react";

import { Button } from "../button";
import { cn } from "../utils";

export type ToolStatusTone =
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "pending"
  | "unknown";

export type ToolChipProps = {
  /** Tool title (caller-provided, already business-safe). */
  title: string;
  /** Display status text resolved by the caller — never invented here. */
  status: string;
  /** Visual tone only; carries no copy. */
  tone: ToolStatusTone;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
};

export function ToolChip({
  title,
  status,
  tone,
  expanded = false,
  onToggle,
  className,
}: ToolChipProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={onToggle ? expanded : undefined}
      onClick={onToggle}
      className={cn(
        "group/row -mx-[3px] h-7 w-[calc(100%+6px)] gap-2 rounded-md px-[3px] font-normal hover:bg-muted",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", toneDotClassName(tone))}
      />
      <span className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-foreground">
        {title}
      </span>
      <span className="shrink-0 text-[11.5px] text-muted-foreground">
        {status}
      </span>
      {onToggle ? (
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover/row:opacity-100 motion-reduce:transition-none",
            expanded && "rotate-180 opacity-100",
          )}
        />
      ) : null}
    </Button>
  );
}

/** Status dot color; semantic tokens only, valid in both themes. */
export function toneDotClassName(tone: ToolStatusTone): string {
  switch (tone) {
    case "success":
      return "bg-success";
    case "failed":
      return "bg-destructive";
    case "cancelled":
    case "unknown":
      return "bg-muted-foreground/60";
    case "running":
      return "bg-warning animate-pulse";
    case "pending":
      return "bg-warning/60";
  }
}

/** Status badge color; semantic tokens only, valid in both themes. */
export function toneBadgeClassName(tone: ToolStatusTone): string {
  switch (tone) {
    case "success":
      return "bg-success/10 text-success";
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "running":
    case "pending":
      return "bg-warning/10 text-warning";
    case "cancelled":
    case "unknown":
      return "bg-muted text-muted-foreground";
  }
}
