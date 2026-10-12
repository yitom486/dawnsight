import { formatPlayerError } from "@/lib/format";

import { usePlayerStore } from "../store";
import { playerStatusText } from "./playerStatusText";

export function StatusLine() {
  const status = usePlayerStore((s) => s.status);
  const statusMessage = usePlayerStore((s) => s.statusMessage);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const error = usePlayerStore((s) => s.error);

  const mapped = playerStatusText(status, { hasMedia: currentFile != null });
  const errorText = error ? formatPlayerError(error) : null;
  // The store usually mirrors the error message or the stop notice into
  // statusMessage; showing both lines verbatim would repeat the same
  // sentence. A differing message is still kept — this only drops exact
  // duplicates.
  const extraMessage =
    statusMessage && statusMessage !== mapped && statusMessage !== errorText
      ? statusMessage
      : null;

  return (
    <div className="min-w-0 flex-1 text-[length:var(--text-ui-body)] leading-[var(--text-ui-body--line-height)] text-muted-foreground">
      <p role="status" className="truncate">
        {mapped}
        {extraMessage ? ` · ${extraMessage}` : null}
      </p>
      {errorText ? (
        <p role="alert" className="truncate text-destructive">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
