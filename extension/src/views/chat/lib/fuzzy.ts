import type { FileEntry } from '../types';

/** Subsequence score with consecutive and word-boundary bonuses. */
export function fuzzyScore(path: string, query: string): number {
  if (!query) return 1;

  const target = path.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;
  let score = 0;
  let previous = -1;

  for (const char of needle) {
    const index = target.indexOf(char, cursor);
    if (index < 0) return 0;

    if (previous >= 0 && index === previous + 1) score += 10;
    const before = index > 0 ? target[index - 1] : '/';
    if (before === '/' || before === '.' || before === '-' || before === '_') score += 8;
    score += 1;
    previous = index;
    cursor = index + 1;
  }

  // Prefer shallow paths when several files match equally well.
  score -= (target.split('/').length - 1) * 0.5;
  return score;
}

export function computeCandidates(files: FileEntry[], query: string): FileEntry[] {
  const scored: Array<{ file: FileEntry; score: number }> = [];
  for (const file of files) {
    const score = fuzzyScore(file.path, query);
    if (score > 0) scored.push({ file, score });
  }
  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return scored.slice(0, 8).map((entry) => entry.file);
}

/** The bridge validates absolute paths. */
export function absolutePathOf(file: FileEntry): string {
  const root = (file.root ?? '').replace(/[\\/]+$/, '');
  return root ? `${root}/${file.path}` : file.path;
}
