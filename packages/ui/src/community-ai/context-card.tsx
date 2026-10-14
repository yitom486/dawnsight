/**
 * Adapted visual reference from Beautiful UI (https://www.beautifului.dev/,
 * MIT © 2026 Shane Levine, https://www.beautifului.dev/license) — implemented
 * with Dawnsight shared primitives; not verbatim upstream source.
 *
 * Context card: compact time-reference chip (visual reference: Beautiful UI
 * "Context Cards" — retrieved chunks with sources — adapted to Dawnsight's
 * video-anchor context: a label plus seek). Props-only: the label text arrives
 * via props (the caller formats it); seeking stays integrator-owned through
 * `onSeek`. No stores, no Tauri imports, no business copy.
 */
import { Clock3 } from "lucide-react";

import { Button } from "../button";
import { cn } from "../utils";

export type ContextCardProps = {
  anchorMs: number;
  /** Caller-formatted label (e.g. formatted timestamp + short text). */
  label: string;
  onSeek: (anchorMs: number) => void;
  className?: string;
};

export function ContextCard({
  anchorMs,
  label,
  onSeek,
  className,
}: ContextCardProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onSeek(anchorMs)}
      className={cn(
        "h-7 max-w-full gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Clock3 aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </Button>
  );
}
