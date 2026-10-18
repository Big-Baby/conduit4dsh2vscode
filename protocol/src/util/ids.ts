/** Identifier helpers. Prefixed ids keep logs and stores readable. */

export function createId(prefix: string, random: () => number = Math.random): string {
  const body = random().toString(36).slice(2, 10);
  return `${prefix}_${body}${Date.now().toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
