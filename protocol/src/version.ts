/**
 * Wire protocol constants.
 *
 * The version only changes when the contract changes; both sides exchange it
 * during `system.info` and compare the major field.
 */
export const PROTOCOL_VERSION = '1.0';

/** Features a peer may rely on. Absence means "degrade", never "fail". */
export const CAPABILITIES = [
  'multi-agent',
  'changes-baseline',
  'plugin-management',
  'file-mentions',
  'history-paging',
  'session-model-selection',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Upper bound for a single NDJSON frame. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Major version of a semver-like string; used for compatibility checks. */
export function majorOf(version: string): number {
  const value = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(value) ? value : 0;
}
