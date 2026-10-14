import type { ReactNode } from "react";
import { AssistantRuntimeProvider as BaseAssistantRuntimeProvider } from "@assistant-ui/react";
import type { AcpRuntimeProps } from "./types";
import { useAcpRuntime } from "./useAcpRuntime";

export type AcpRuntimeProviderProps = AcpRuntimeProps & {
  children: ReactNode;
};

/** 薄封装：运行桥接 hook 并挂载 assistant-ui runtime 上下文。 */
export function AcpRuntimeProvider({ children, ...bridge }: AcpRuntimeProviderProps) {
  const runtime = useAcpRuntime(bridge);
  return <BaseAssistantRuntimeProvider runtime={runtime}>{children}</BaseAssistantRuntimeProvider>;
}
