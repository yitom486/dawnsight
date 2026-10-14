/**
 * Adapted visual reference from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — implemented
 * with Dawnsight shared primitives; not verbatim upstream source.
 *
 * Tool chip: compact presentational toggle for one tool call (visual reference:
 * Beautiful UI "Tool Chips"). Props-only: every user-visible string arrives
 * via props — status text is resolved by the caller (the chat-ui layer resolves
 * it via `activityStatus.ts`/`toolStatus.ts`). No stores, no Tauri imports, no
 * business copy, no tool execution.
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
      variant="outline"
      size="sm"
      aria-expanded={onToggle ? expanded : undefined}
      onClick={onToggle}
      className={cn(
        "h-7 max-w-full gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", toneDotClassName(tone))}
      />
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      <span className="shrink-0 text-[11px]">{status}</span>
      {onToggle ? (
        <ChevronDown
          aria-hidden
          className={cn(
            "shrink-0 transition-transform",
            expanded && "rotate-180",
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
