/** Harness model selection, mirrored structurally to avoid a hard dependency. */

export interface ModelSelection {
  provider: string;
  model: string;
  /** Opaque adapter id; the bridge passes user input through unchanged. */
  reasoningEffort?: string;
}

export interface ModelSelectionRef {
  current?: ModelSelection;
  assembled?: unknown;
}

export type InstallModelSelection = (agentCtx: unknown, selection: ModelSelectionRef) => void;

/** Branded string expected by the harness; branding is a compile-time concern. */
export function asReasoningEffort(value: string): never {
  return value as never;
}
