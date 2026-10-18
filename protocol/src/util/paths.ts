/** Path helpers that do not depend on `node:path`. */

export function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Strips trailing separators, keeping the root itself intact. */
export function trimTrailingSlash(value: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) return value;
  return value.replace(/\/+$/, '');
}

/** True when `target` equals `root` or lives below it. */
export function isWithin(root: string, target: string): boolean {
  const base = trimTrailingSlash(toPosix(root));
  const candidate = trimTrailingSlash(toPosix(target));
  if (candidate === base) return true;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return candidate.startsWith(prefix);
}

/** Resolves `.` and `..` segments without touching the file system. */
export function collapseSegments(value: string): string {
  const posix = toPosix(value);
  const absolute = posix.startsWith('/');
  const segments: string[] = [];
  for (const part of posix.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length && segments[segments.length - 1] !== '..') segments.pop();
      else if (!absolute) segments.push('..');
      continue;
    }
    segments.push(part);
  }
  const joined = segments.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

/** Makes `path` relative to `root` when possible, otherwise returns it as-is. */
export function relativeTo(root: string, path: string): string {
  const base = trimTrailingSlash(toPosix(root));
  const target = toPosix(path);
  if (!isWithin(base, target)) return target;
  return target.slice(base.length).replace(/^\/+/, '');
}
