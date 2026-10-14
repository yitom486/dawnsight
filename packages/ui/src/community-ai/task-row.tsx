/**
 * Adapted visual reference from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — implemented
 * with Dawnsight shared primitives; not verbatim upstream source.
 *
 * Task row: expanded presentational row for one tool call (visual reference:
 * Beautiful UI "Task Rows" — live status plus expandable detail). Props-only:
 * title, status text, and detail are caller-provided real data; toggle labels
 * also arrive via props. No stores, no Tauri imports, no business copy, no
 * tool execution.
 */
import { Badge } from "../badge";
import { Button } from "../button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";
import {
  toneBadgeClassName,
  toneDotClassName,
  type ToolStatusTone,
} from "./tool-chip";

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
      <div className={cn("rounded-md px-1 py-1", className)}>
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              toneDotClassName(tone),
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 truncate text-[13px] font-medium text-foreground/90">
                  {title}
                </p>
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-auto shrink-0 px-2 py-0.5 text-[11px] font-medium",
                    toneBadgeClassName(tone),
                  )}
                >
                  {status}
                </Badge>
              </div>
              {trimmedDetail ? (
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-1 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                    />
                  }
                >
                  {expanded ? collapseLabel : expandLabel}
                </CollapsibleTrigger>
              ) : null}
            </div>
            {trimmedDetail ? (
              <CollapsibleContent>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-background/80 p-2 text-xs leading-relaxed text-muted-foreground">
                  {trimmedDetail}
                </pre>
              </CollapsibleContent>
            ) : null}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}
