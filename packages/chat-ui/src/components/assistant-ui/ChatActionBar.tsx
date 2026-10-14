import { forwardRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { Button, type ButtonProps } from "@dawnsight/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@dawnsight/ui/tooltip";
import { cn } from "@dawnsight/ui";

export type TooltipIconButtonProps = Omit<ButtonProps, "children"> & {
  tooltip: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
};

/**
 * Local TooltipIconButton mapping: Dawnsight shared Button + Base UI
 * Tooltip composed via `render` (per AGENTS.md, no Radix `asChild`).
 * Requires an ancestor `TooltipProvider` — the desktop `App` root provides
 * one, so chat surfaces must not add their own.
 *
 * Ref lands on the underlying `<button>` (React 19 ref-as-prop through the
 * local Button). The root is the Tooltip, so this button is NOT suitable as
 * an `asChild`/`render` child of action primitives — use it standalone.
 */
export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(function TooltipIconButton(
  {
    tooltip,
    side = "top",
    variant = "ghost",
    size = "icon",
    className,
    children,
    ...rest
  },
  ref,
) {
  const button = (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        "size-7 shrink-0 text-muted-foreground hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
});

/**
 * Copy affordance for assistant answers.
 *
 * Deliberately NOT `ActionBarPrimitive.Copy`: the default copy path calls
 * `aui.message.getCopyText()`, which joins every `text` part
 * (`getThreadMessageText` in `@assistant-ui/core`, `utils/text.js` — tool
 * parts are excluded, but the raw `turn.answer` envelope is NOT). For
 * structured (block JSON) answers that envelope is internal data that must
 * never reach the clipboard (same F4 rule as `ChatTurnView`). The caller
 * passes the already-composed business text (visible text only), resolved
 * lazily at click time so streaming never copies a stale snapshot.
 */
export function BusinessCopyButton({
  getText,
  className,
}: {
  getText: () => string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [denied, setDenied] = useState(false);

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <TooltipIconButton
        tooltip={copied ? "已复制" : "复制回答"}
        aria-label="复制回答"
        onClick={() => {
          void (async () => {
            const text = getText();
            if (!text.trim()) {
              setDenied(true);
              return;
            }
            try {
              await navigator.clipboard.writeText(text);
              setDenied(false);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              setDenied(true);
            }
          })();
        }}
      >
        {copied ? (
          <Check className="size-4 animate-in zoom-in-50 fade-in duration-200 ease-out" />
        ) : (
          <Copy className="size-4 animate-in zoom-in-75 fade-in duration-150" />
        )}
      </TooltipIconButton>
      {denied ? (
        <span className="text-[length:var(--text-chat-meta)] leading-[var(--text-chat-meta--line-height)] text-muted-foreground">
          复制失败，请重试
        </span>
      ) : null}
    </span>
  );
}
