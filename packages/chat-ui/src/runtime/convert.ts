import type { MessageStatus, ThreadMessageLike } from "@assistant-ui/react";
import { isToolCancelled, isToolFailed, isToolSucceeded } from "../toolStatus";
import type { ChatActivity, ChatMessageStatus, ChatTurn, ThinkingLevel } from "../types";
import type { AcpAssistantMetadata } from "./types";

type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/** 工具调用是否已终态：终态才允许把 activity.text 作为结果文本投影。 */
function isToolTerminal(status?: string): boolean {
  return isToolSucceeded(status) || isToolFailed(status) || isToolCancelled(status);
}

/**
 * 本轮可见的活动。工具活动始终可见；thought/plan 没有线程 part 映射
 * （约定 §2：content 只有 [...toolCallParts, text]），且上游只在 verbose
 * 记录它们——非 verbose 投影在这里同样过滤，stale 数据永不泄漏。
 */
function visibleActivities(turn: ChatTurn, thinkingLevel: ThinkingLevel): ChatActivity[] {
  if (!turn.showActivities) return [];
  if (thinkingLevel === "verbose") return turn.activities;
  return turn.activities.filter((activity) => activity.kind === "tool");
}

function toToolCallPart(activity: ChatActivity): LikePart | null {
  // thought/plan 永不成为 part：领域正文只读 turn.answer。
  if (activity.kind !== "tool") return null;
  const toolCallId = activity.toolCallId ?? activity.id;
  const text = activity.text;
  return {
    type: "tool-call",
    toolCallId,
    toolName: activity.title ?? activity.toolCallId ?? activity.id,
    // 终态结果文本只取 activity.text（已合并的业务文本，绝不拼 raw JSON）。
    result: isToolTerminal(activity.status) && text ? text : undefined,
    isError: isToolFailed(activity.status) ? true : undefined,
  };
}

function toAssistantStatus(status: ChatMessageStatus): MessageStatus {
  switch (status) {
    case "streaming":
      return { type: "running" };
    case "done":
      return { type: "complete", reason: "stop" };
    case "error":
      return { type: "incomplete", reason: "error" };
  }
}

function toAssistantMetadata(turn: ChatTurn): AcpAssistantMetadata {
  return {
    turnId: turn.id,
    anchorMs: turn.anchorMs ?? null,
    status: turn.status,
    errorHint: turn.errorHint,
    shortcutTaskId: turn.shortcutTaskId,
    hasAnnotationProposal: turn.annotationProposal !== undefined && turn.annotationProposal !== null,
    annotationProposalSaved: turn.annotationProposalSaved ?? false,
  };
}

function projectTurnPair(turn: ChatTurn, thinkingLevel: ThinkingLevel): [ThreadMessageLike, ThreadMessageLike] {
  const userMessage: ThreadMessageLike = {
    role: "user",
    id: `${turn.id}#user`,
    content: [{ type: "text", text: turn.userText }],
  };
  const toolCallParts: LikePart[] = [];
  for (const activity of visibleActivities(turn, thinkingLevel)) {
    const part = toToolCallPart(activity);
    if (part) toolCallParts.push(part);
  }
  const assistantMessage: ThreadMessageLike = {
    role: "assistant",
    id: `${turn.id}#asst`,
    content: [...toolCallParts, { type: "text", text: turn.answer }],
    status: toAssistantStatus(turn.status),
    metadata: { custom: toAssistantMetadata(turn) },
  };
  return [userMessage, assistantMessage];
}

/**
 * 纯函数：ChatTurn[] → ThreadMessageLike[]（约定 §2）。
 * 消息 id 由 turn.id 稳定派生；图片/锚点/富块不进 part，
 * B 侧经 metadata.custom.turnId 关联回宿主 turn。
 */
export function projectTurnsToMessages(
  turns: ChatTurn[],
  thinkingLevel: ThinkingLevel,
): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  for (const turn of turns) {
    const [userMessage, assistantMessage] = projectTurnPair(turn, thinkingLevel);
    messages.push(userMessage, assistantMessage);
  }
  return messages;
}

/** Keep unchanged turns' projected message identities during token updates. */
export function createTurnsProjector() {
  const cache = new WeakMap<ChatTurn, { level: ThinkingLevel; pair: [ThreadMessageLike, ThreadMessageLike] }>();
  return (turns: ChatTurn[], level: ThinkingLevel): ThreadMessageLike[] => {
    return turns.flatMap((turn) => {
      const previous = cache.get(turn);
      if (previous?.level === level) return previous.pair;
      const pair = projectTurnPair(turn, level);
      cache.set(turn, { level, pair });
      return pair;
    });
  };
}
