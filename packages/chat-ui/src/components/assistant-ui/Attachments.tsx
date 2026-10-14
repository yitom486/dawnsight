import { Button } from "@dawnsight/ui/button";
import type { ChatImageAttachment } from "../../types";

export type ComposerAttachmentStripProps = {
  attachments: ChatImageAttachment[];
  onRemoveAttachment?: (id: string) => void;
};

/**
 * Presentational thumbnail strip for composer-pending pasted images.
 * Same content/shape as the chat composer has always rendered (`size-14`
 * thumbs with a remove affordance). Sending travels with the integrator's
 * `onSend` — this strip never sends.
 */
export function ComposerAttachmentStrip({
  attachments,
  onRemoveAttachment,
}: ComposerAttachmentStripProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="relative shrink-0">
          <img
            src={attachment.dataUrl}
            alt="粘贴的图片"
            className="size-14 rounded-md border border-border object-cover"
          />
          {onRemoveAttachment ? (
            <Button variant="ghost" size="icon"
              type="button"
              aria-label="移除图片"
              className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-muted p-0 text-[length:var(--text-chat-meta)] leading-none text-muted-foreground hover:text-destructive"
              onClick={() => onRemoveAttachment(attachment.id)}
            >
              ×
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
