import { getExternalStoreMessages } from "@assistant-ui/react";
import type { MessageState } from "@assistant-ui/react";

import type { ChatTurn } from "../../types";

/**
 * Resolve the business `ChatTurn` behind a runtime message.
 *
 * Primary path (contract): the runtime provider (subagent A) binds the
 * source turn to its projected messages, so `getExternalStoreMessages`
 * returns it — checked at message level first, then per content part
 * (the converter tags every part with `[symbolInnerMessage]`).
 *
 * Fallback path: the integrator passes `resolveTurn`, keyed by the stable
 * derived turn id (`${turn.id}` stripped from `${turn.id}#user/#asst`,
 * see `.plan/chat-ui-rebuild/conventions.md` §2).
 */
export function isChatTurn(value: unknown): value is ChatTurn {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["userText"] === "string" &&
    typeof candidate["answer"] === "string" &&
    typeof candidate["status"] === "string" &&
    Array.isArray(candidate["activities"])
  );
}

/** Message ids are derived and stable: `${turn.id}#user` / `${turn.id}#asst`. */
export function turnIdFromMessageId(messageId: string): string {
  return messageId.replace(/#(user|asst)$/, "");
}

export function resolveHostTurn(
  message: MessageState,
  resolveTurn?: (turnId: string) => ChatTurn | undefined,
): ChatTurn | undefined {
  for (const candidate of getExternalStoreMessages<unknown>(message)) {
    if (isChatTurn(candidate)) return candidate;
  }
  for (const part of message.content) {
    for (const candidate of getExternalStoreMessages<unknown>(part)) {
      if (isChatTurn(candidate)) return candidate;
    }
  }
  if (resolveTurn) return resolveTurn(turnIdFromMessageId(message.id));
  return undefined;
}
