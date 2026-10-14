/**
 * Verbatim-adapted from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — source
 * obtained via the per-section "Copy code" button on 2026-10-14
 * (`.plan/chat-ui-rebuild/upstream/taskRows.clip.txt`).
 *
 * Adopted verbatim: h-11 capsule row, status badges (green check / spinner
 * ring / red X — paths copied), status pill language, chevron, grid-rows
 * expand, rail + detail grammar.
 * Deliberately not shipped: the tick-driven pending→failed→done sequence
 * (fabricated status progression), demo rows, entrance stagger, Capsules/List
 * variant picker, and the Failed-pill retry icon (no retry capability exists —
 * a retry affordance would be a fake button).
 * Deviations forced by product contract: spinner carries no step count (no
 * fabricated numbers); cancelled/pending/unknown render a neutral dot
 * (upstream has no such states); pill copy is the caller's real Chinese
 * status text; detail is the real merged business text.
 *
 * Props-only: title, status text, and detail are caller-provided real data;
 * toggle labels also arrive via props. No stores, no Tauri imports, no
 * business copy, no tool execution.
 */
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";
import {
  toneBadgeClassName,
  type ToolStatusTone,
} from "./tool-chip";
import { Badge } from "../badge";

export type TaskRowProps = {
  /** Tool title (caller-provided, already business-safe). */
  title: string;
  /** Display status text resolved by the caller — never invented here. */
  status: string;
  /** Visual tone only; carries no copy. */
  tone: ToolStatusTone;
  /** Real detail text (already-merged business text, never raw JSON). */
  detail?: string;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  /** Toggle copy, caller-provided (e.g. current feed: 查看输出 / 查看原因 / 收起). */
  expandLabel: string;
  collapseLabel: string;
  className?: string;
};

function StatusBadge({ tone }: { tone: ToolStatusTone }) {
  if (tone === "success") {
    return (
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (tone === "failed") {
    return (
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (tone === "running" || tone === "pending") {
    return (
      <span className="relative inline-flex size-[22px] shrink-0 items-center justify-center" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 22 22" className="absolute inset-0 animate-spin motion-reduce:animate-none">
          <circle cx="11" cy="11" r="10" fill="none" stroke="var(--border)" strokeWidth="2" />
          <circle cx="11" cy="11" r="10" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeDasharray="17.6 45.2" />
        </svg>
      </span>
    );
  }
  return (
    <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
  );
}

export function TaskRow({
  title,
  status,
  tone,
  detail,
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  className,
}: TaskRowProps) {
  const trimmedDetail = detail?.trim() ? detail : undefined;
  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <div className={cn("overflow-hidden", className)}>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              aria-label={expanded ? collapseLabel : expandLabel}
              title={expanded ? collapseLabel : expandLabel}
              className="flex h-11 w-full items-center gap-2.5 rounded-md px-1 text-left transition-colors duration-100 hover:bg-muted"
            />
          }
        >
          <span className="flex shrink-0 items-center justify-center">
            <StatusBadge tone={tone} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {title}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              "h-auto shrink-0 px-2 py-0.5 text-[11px] font-medium",
              toneBadgeClassName(tone),
            )}
          >
            {status}
          </Badge>
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center text-muted-foreground"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(
                "transition-transform duration-300 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </CollapsibleTrigger>
        {trimmedDetail ? (
          <CollapsibleContent>
            <div className="grid grid-cols-[22px_1fr] gap-2 px-1 pb-1">
              <span aria-hidden className="mx-auto h-full w-px bg-border" />
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-background/80 p-2 text-xs leading-relaxed text-muted-foreground">
                {trimmedDetail}
              </pre>
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}
