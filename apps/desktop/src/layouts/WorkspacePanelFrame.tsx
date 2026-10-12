import type { CSSProperties, ReactNode } from "react";

import { cn } from "@dawnsight/ui/utils";

type WorkspacePanelFrameProps = {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
};

/** Shared right-side workspace shell for ordinary panels and the AI dock. */
export function WorkspacePanelFrame({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  contentClassName,
  style,
}: WorkspacePanelFrameProps) {
  return (
    <section
      data-panel-boundary=""
      aria-label={title}
      style={style}
      className={cn(
        "relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-card",
        className,
      )}
    >
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-[var(--space-ui-2)] border-b border-border px-[var(--space-ui-3)] py-[var(--space-ui-3)]">
        <div className="flex min-w-0 items-center gap-[var(--space-ui-2)]">
          {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-ui-title)] leading-[var(--text-ui-title--line-height)] font-semibold">{title}</p>
            {subtitle ? (
              <p className="truncate text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-[var(--space-ui-1)]">{actions}</div> : null}
      </header>
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", contentClassName)}>
        {children}
      </div>
    </section>
  );
}
