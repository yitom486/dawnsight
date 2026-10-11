import type { AssistantAction } from "@dawnsight/chat-ui/assistantBlocks";
import type { ChatTurn } from "../types";
import { ChatColumn } from "@dawnsight/chat-ui/components/ChatShell";
import { ChatTurnView } from "./ChatTurnView";

type Props = {
  turns: ChatTurn[];
  notices: { id: string; content: string }[];
  emptyHint?: string;
  /**
   * use-stick-to-bottom 的内容锚点：跟随由 AcpPanel 持有滚动容器 +
   * stick 实例统一驱动，这里只负责把内容包起来，不再自己逐更新
   * scrollIntoView（和 hook 竞争滚动是旧抖动源之一）。
   */
  contentRef?: React.RefCallback<HTMLElement>;
  annotationWorkspace?: string | null;
  onDismissAnnotation?: (turnId: string) => void;
  onSaveAnnotation?: (turnId: string, proposalId?: string) => void;
  onAssistantAction?: (action: AssistantAction) => void;
};

export function ChatTurnList({
  turns,
  notices,
  emptyHint = "向 AI Agent 提问。打开视频后会附带播放上下文。",
  contentRef,
  annotationWorkspace,
  onDismissAnnotation,
  onSaveAnnotation,
  onAssistantAction,
}: Props) {
  if (turns.length === 0 && notices.length === 0) {
    return (
      <ChatColumn className="flex min-h-0 flex-1 items-center justify-center py-8 text-center text-xs text-muted-foreground">
        {emptyHint}
      </ChatColumn>
    );
  }

  // 操作反馈跟在对话尾部（时间顺序）。会话出身（恢复/新建）是出生证明，
  // 由调用方钉在列表顶部单槽展示，不进这里、不堆积。
  return (
    <ChatColumn className="min-h-0 py-3">
      <div ref={contentRef} className="space-y-4">
        {turns.map((turn) => (
          <ChatTurnView
            key={turn.id}
            turn={turn}
            annotationWorkspace={annotationWorkspace}
            onDismissAnnotation={onDismissAnnotation}
            onSaveAnnotation={onSaveAnnotation}
            onAssistantAction={onAssistantAction}
          />
        ))}
        {notices.map((n) => (
          <p key={n.id} className="text-center text-[11px] text-muted-foreground">
            {n.content}
          </p>
        ))}
      </div>
    </ChatColumn>
  );
}
