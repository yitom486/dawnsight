import { useCallback, useMemo } from "react";
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { createTurnsProjector } from "./convert";
import type { AcpRuntimeProps } from "./types";

/** 非文本内容被忽略时的固定业务提示（不含任何技术细节）。 */
const NON_TEXT_NOTICE = "抱歉，暂不支持发送该类型的内容，请用文字描述。";

/**
 * 从 AppendMessage 提取用户文本。content 可能是字符串或 part 数组；
 * 文本 part 拼接返回；附件等多媒体 part 由应用侧既有状态机接管，
 * 这里只取文字。无文本 part 时返回 undefined。
 */
function extractTextContent(message: AppendMessage): string | undefined {
  const content: unknown = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  let text: string | undefined;
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    if ((part as { type?: unknown }).type !== "text") continue;
    const value = (part as { text?: unknown }).text;
    if (typeof value !== "string") continue;
    text = text === undefined ? value : text + value;
  }
  return text;
}

/**
 * ACP turn 状态 → assistant-ui 外部 store runtime。
 * 只提供 onNew（纯文本）与 onCancel：不提供 setMessages/onEdit/
 * onReload/queue/threadList/voice，排队与重发仍归应用侧状态机。
 */
export function useAcpRuntime(props: AcpRuntimeProps): AssistantRuntime {
  const { turns, busy, isDisabled, thinkingLevel, onSendText, onCancelRun, onNotice } = props;

  const project = useMemo(createTurnsProjector, []);
  const messages = useMemo<ThreadMessageLike[]>(
    () => project(turns, thinkingLevel),
    [turns, thinkingLevel, project],
  );

  const handleNew = useCallback(
    async (message: AppendMessage): Promise<void> => {
      const text = extractTextContent(message);
      if (text === undefined) {
        onNotice?.(NON_TEXT_NOTICE);
        return;
      }
      onSendText(text);
    },
    [onNotice, onSendText],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    onCancelRun();
  }, [onCancelRun]);

  // 消息已是 ThreadMessageLike：恒等转换即可。
  const convertMessage = useCallback(
    (message: ThreadMessageLike): ThreadMessageLike => message,
    [],
  );

  return useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: busy,
    isDisabled,
    convertMessage,
    onNew: handleNew,
    onCancel: handleCancel,
  });
}
