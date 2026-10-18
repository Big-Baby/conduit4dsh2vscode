export type ChangeType = 'added' | 'modified' | 'deleted';

export type ChangeMode = 'git' | 'snapshot' | 'none';

export interface FileChange {
  /** Workspace-relative path using POSIX separators. */
  relPath: string;
  absPath: string;
  type: ChangeType;
  sizeBefore?: number;
  sizeAfter?: number;
  /** Whether the baseline content is available for diff and revert. */
  hasBefore: boolean;
}

export interface ChangeSummary {
  mode: ChangeMode;
  changes: FileChange[];
  total: number;
  truncated: boolean;
  /** Creation time of the current baseline. */
  confirmedAt?: string;
}

export interface Baseline {
  mode: 'git' | 'snapshot';
  createdAt: string;
  gitRoot?: string;
  gitRef?: string;
  snapshotId?: string;
}

export interface ConfirmRecord {
  at: string;
  count: number;
  mode: 'git' | 'snapshot';
  committed: boolean;
}

export interface SnapshotEntry {
  size: number;
  mtimeMs: number;
  /** Index of the baseline copy inside the snapshot directory. */
  copy?: number;
}

export type SnapshotManifest = Record<string, SnapshotEntry>;
