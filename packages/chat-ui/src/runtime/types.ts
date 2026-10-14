import type { ChatShortcutTaskId, ChatTurn, ThinkingLevel } from "../types";

/**
 * assistant-ui 桥接输入（约定 §2）。
 * turns/busy 的语义与 AcpPanel 现有状态一致：turns 是唯一的对话真相源
 * （新数组 identity 即一次流式推进），busy 表示本轮 run 是否进行中。
 */
export type AcpRuntimeProps = {
  turns: ChatTurn[];
  busy: boolean;
  isDisabled: boolean;
  thinkingLevel: ThinkingLevel;
  /** 文本发送：宿主把文字交回现有 run 链路（含排队/打断语义）。 */
  onSendText: (text: string) => void;
  /** 取消本轮 run。 */
  onCancelRun: () => void;
  /** 非文本 composer 内容被忽略时的业务提示通道（只收中文业务文案）。 */
  onNotice?: (text: string) => void;
};

/**
 * assistant 消息上的领域元数据（约定 §2）。
 * 经 ThreadMessageLike.metadata.custom 携带，供 B 侧关联回 ChatTurn。
 */
export type AcpAssistantMetadata = {
  turnId: string;
  anchorMs: number | null;
  status: ChatTurn["status"];
  errorHint?: string;
  shortcutTaskId?: ChatShortcutTaskId;
  hasAnnotationProposal: boolean;
  annotationProposalSaved: boolean;
};
