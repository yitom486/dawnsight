import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@dawnsight/ui/button";
import { formatRenderError } from "@/lib/formatRenderError";
import { reportRenderError } from "@/lib/reportRenderError";

export type PanelErrorBoundaryProps = {
  children: ReactNode;
  /** Short panel label, e.g. 对话 / 播放区域 */
  panelLabel?: string;
  /** Optional override when no error yet (unused in fallback). */
  title?: string;
  hint?: string;
  scope?: string;
  resetKey?: string | number;
  className?: string;
};

type State = {
  error: Error | null;
};

/** Isolates a feature panel so render errors do not blank the WebView. */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportRenderError(this.props.scope ?? "panel", error, info.componentStack);
  }

  componentDidUpdate(prevProps: PanelErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const copy = formatRenderError(
        this.state.error,
        this.props.panelLabel ?? "面板",
      );
      return (
        <div
          className={
            this.props.className ??
            "flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-ui-3)] px-[var(--space-ui-4)] py-[var(--space-ui-6)] text-center"
          }
          role="alert"
        >
          <TriangleAlert
            className="size-4 text-destructive"
            aria-hidden="true"
          />
          <p className="text-[length:var(--text-ui-title)] leading-[var(--text-ui-title--line-height)] font-semibold text-foreground">
            {copy.title}
          </p>
          <p className="max-w-sm text-[length:var(--text-ui-meta)] leading-[var(--text-ui-meta--line-height)] text-foreground/90">
            {copy.message}
          </p>
          <p className="max-w-sm text-[length:var(--text-ui-label)] leading-[var(--text-ui-label--line-height)] text-muted-foreground">
            {this.props.hint ?? copy.hint}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={this.retry}>
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Last-resort shell boundary — keeps native player chrome mountable when possible. */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <PanelErrorBoundary
      scope="app-root"
      panelLabel="应用"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-6 py-12 text-center text-foreground"
    >
      {children}
    </PanelErrorBoundary>
  );
}
