/**
 * Adapted visual reference from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — implemented
 * with Dawnsight shared primitives; not verbatim upstream source.
 *
 * Approval card: human-in-the-loop prompt (visual reference: Beautiful UI
 * "Approval Card"). Props-only: title, option labels, and all routing arrive
 * via props. No stores, no Tauri imports, no business copy, no permission
 * transport — the caller (chat-ui `ApprovalView`) owns the
 * allow/deny → approve/reject mapping and the response call.
 */
import { ShieldCheck } from "lucide-react";

import { Button } from "../button";
import { cn } from "../utils";

export type ApprovalCardOption = {
  optionId: string;
  /** Caller-provided button label (maps 1:1 to the permission option name). */
  label: string;
  /** First/allow-style option renders as the primary action. */
  primary?: boolean;
  disabled?: boolean;
};

export type ApprovalCardProps = {
  /** Prompt title (caller composes, e.g. approval subject). */
  title: string;
  description?: string;
  options: ApprovalCardOption[];
  /** While responding: all actions disable, no copy changes here. */
  busy?: boolean;
  onSelect: (optionId: string) => void;
  className?: string;
};

export function ApprovalCard({
  title,
  description,
  options,
  busy = false,
  onSelect,
  className,
}: ApprovalCardProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-md border border-warning/30 bg-warning/5 px-3 py-2",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-warning"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium break-words text-foreground">
            {title}
          </p>
          {description?.trim() ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((option) => (
              <Button
                key={option.optionId}
                type="button"
                size="sm"
                variant={option.primary ? "default" : "outline"}
                disabled={busy || option.disabled}
                onClick={() => onSelect(option.optionId)}
                className="h-7 text-xs"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
