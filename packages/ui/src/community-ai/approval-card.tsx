/**
 * Verbatim-adapted from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — source
 * obtained via the per-section "Copy code" button on 2026-10-14
 * (`.plan/chat-ui-rebuild/upstream/approvalCard.clip.txt`).
 *
 * Adopted verbatim: card chrome (rounded card + title-as-heading), radio-row
 * option grammar (inset ring → filled dot, click decides immediately — the
 * same auto-submit semantics as upstream radio), primary/outline action
 * language (the allow path stays filled, as before — it marks the suggested
 * action, not a persisted pick: a click still decides at once).
 * Deliberately not shipped: the multi-question survey (pager, Skip/Continue
 * flow, custom-answer input, sent state, reset), the Dismiss button (closing
 * without responding would orphan the pending tool call), and the hover
 * glide highlight (private upstream primitive, plain hover instead).
 * Our contract is one pending request answered exactly once — options map
 * 1:1 to permission decisions, no survey state machine.
 *
 * Props-only: title, option labels, and all routing arrive via props. No
 * stores, no Tauri imports, no business copy, no permission transport — the
 * caller (chat-ui `ApprovalView`) owns the allow/deny → approve/reject
 * mapping and the response call.
 */
import { cn } from "../utils";

export type ApprovalCardOption = {
  optionId: string;
  /** Caller-provided button label (maps 1:1 to the permission option name). */
  label: string;
  /** First/allow-style option renders filled to mark the suggested path. */
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
        "rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm",
        className,
      )}
    >
      <p className="pr-2 text-sm font-medium break-words text-foreground">
        {title}
      </p>
      {description?.trim() ? (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-1" role="group">
        {options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            disabled={busy || option.disabled}
            onClick={() => onSelect(option.optionId)}
            className="flex min-h-7 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors duration-100 hover:bg-muted disabled:opacity-50"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                option.primary
                  ? "rounded-full bg-primary text-primary-foreground"
                  : "rounded-full text-transparent shadow-[inset_0_0_0_1.5px_var(--border)]",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full transition-transform duration-200",
                  option.primary ? "bg-primary-foreground" : "bg-transparent",
                )}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] leading-none text-foreground">
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
