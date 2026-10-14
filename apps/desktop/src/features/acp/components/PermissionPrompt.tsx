import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/format";

import { respondAcpPermission } from "../api";
import type { PendingPermission } from "../types";
import { ApprovalView } from "@dawnsight/chat-ui/components/assistant-ui/ToolViews";

type Props = {
  pending: PendingPermission;
  onDone: () => void;
};

/**
 * 审批提示：同样的 `PendingPermission` 契约（allow 前缀批准、
 * reject/deny 否决，缺名回退文案），视觉走社区 Approval 卡。
 */
export function PermissionPrompt({ pending, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const responding = useRef(false);
  const currentRequest = useRef(pending.requestId);
  currentRequest.current = pending.requestId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const respond = (optionId: string | null) => {
    if (responding.current) return;
    responding.current = true;
    const requestId = pending.requestId;
    setBusy(true);
    setError(null);
    void respondAcpPermission(requestId, optionId).then(() => {
      if (mounted.current && currentRequest.current === requestId) onDone();
    }).catch((err) => {
      if (mounted.current && currentRequest.current === requestId) setError(errorMessage(err));
    }).finally(() => {
      responding.current = false;
      if (mounted.current && currentRequest.current === requestId) setBusy(false);
    });
  };
  return (
    <div className="space-y-2">
    <ApprovalView
      title={`需要你的审批：${pending.title ?? pending.toolCallId ?? "工具调用"}`}
      options={pending.options}
      busy={busy}
      approveFallbackLabel="允许"
      rejectFallbackLabel="拒绝"
      onApprove={(optionId) => respond(optionId)}
      onReject={(optionId) => respond(optionId)}
    />
    {error ? <p role="alert" className="break-words text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
