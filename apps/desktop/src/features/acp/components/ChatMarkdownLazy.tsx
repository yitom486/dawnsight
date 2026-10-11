import { Suspense, lazy, type ReactNode } from "react";

const ChatMarkdownInner = lazy(() =>
  import("./ChatMarkdown").then((module) => ({
    default: module.ChatMarkdown,
  })),
);

type Props = {
  content: string;
  className?: string;
  streaming?: boolean;
  fallback?: ReactNode;
};

/**
 * Shared lazy boundary for the markdown renderer (Streamdown + KaTeX).
 * Both ChatTurnView and WatchFeedView go through here so the heavy chunk
 * loads once and never lands in the initial bundle.
 */
export function ChatMarkdownLazy({
  content,
  className,
  streaming = false,
  fallback,
}: Props) {
  return (
    <Suspense
      fallback={
        fallback ?? (
          <span className="whitespace-pre-wrap break-words">{content}</span>
        )
      }
    >
      <ChatMarkdownInner
        content={content}
        className={className}
        streaming={streaming}
      />
    </Suspense>
  );
}
