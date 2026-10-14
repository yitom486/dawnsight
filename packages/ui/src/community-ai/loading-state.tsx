/**
 * Verbatim-adapted from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — source
 * obtained via the per-section "Copy code" button on 2026-10-14
 * (`.plan/chat-ui-rebuild/upstream/loading-state.clip.txt`), not from the
 * marketing screenshots.
 *
 * Adaptations (tokens, product honesty, a11y — behavior identical):
 * - `bg-ink` → `bg-foreground`; `text-ink-3` → `text-muted-foreground`;
 *   shimmer gradient resolves to product tokens (see `.bui-shimmer-text`).
 * - Only the Drive pattern ships (chevron wavefront delays verbatim);
 *   Dots/Orbit/Surfer variant picker, the "Churning" demo copy and the meme
 *   video are deliberately not shipped.
 * - Label always arrives via props from the real run state.
 * - The elapsed clock is honest wall-clock from mount (upstream counts
 *   decisecs from mount too) — never a backend duration or progress share.
 * - `role="status"` kept verbatim; the ticking readout is `aria-hidden`
 *   (screen readers get the static row label, not a 100ms storm).
 * - Reduced motion freezes cells dim + kills the shimmer with a legible
 *   fallback (see chat-motion.css); the timer still ticks, per upstream.
 */
import { useEffect, useState } from "react";

import { cn } from "@dawnsight/ui";

/** Upstream Drive wavefront: (col + |row - 1|) * 90ms. */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const TICK_MS = 100;

function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, elapsedMs) / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/** Pixel-grid pulse. Decorative — the row label carries the meaning. */
export function LoadingGrid({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]", className)}
    >
      {CHEVRON_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="bui-pixel-cell size-[4px] rounded-[1px] bg-foreground motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Ticking wall-clock since `startedAtMs`. `aria-hidden`: screen readers get
 * the row's static label instead of a 100ms announcement storm.
 */
export function ElapsedTime({ startedAtMs }: { startedAtMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span
      aria-hidden
      className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground"
    >
      {formatElapsed(now - startedAtMs)}
    </span>
  );
}

export type ThinkingLoadingStateProps = {
  /** Real run-state copy (e.g. waitingLabel output). Never demo wording. */
  label: string;
  className?: string;
};

/**
 * One waiting row: pixel grid + shimmering live label + elapsed. The clock
 * starts at mount — i.e. when this turn's waiting UI first paints, not a
 * backend execution measure. Mounts are keyed per message, so each turn
 * times itself.
 */
export function ThinkingLoadingState({ label, className }: ThinkingLoadingStateProps) {
  const [startedAtMs] = useState(() => Date.now());
  return (
    <div
      role="status"
      className={cn("flex w-fit items-center gap-2.5 py-1", className)}
      aria-label={label}
    >
      <LoadingGrid />
      <span className="bui-shimmer-text bg-clip-text text-[13px] font-medium text-transparent motion-reduce:animate-none">
        {label}
      </span>
      <ElapsedTime startedAtMs={startedAtMs} />
    </div>
  );
}
