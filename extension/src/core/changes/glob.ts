/** Minimal glob engine (`**`, `*`, `?`) and the change-tracking whitelist. */

export function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === undefined) continue;

    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
      } else {
        pattern += '[^/\\\\]*';
      }
      continue;
    }
    if (char === '?') {
      pattern += '[^/\\\\]';
      continue;
    }
    pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Compiles the whitelist.
 *
 * Accepted forms, all relative to the workspace root:
 * - `logs/app.log` exact file
 * - `tmp` / `tmp/` directory and everything below
 * - `logs/**\/*.log` glob
 */
export function compileWhitelist(patterns: string[]): (relPath: string) => boolean {
  const globs: RegExp[] = [];
  const exact = new Set<string>();
  const prefixes: string[] = [];

  for (const raw of patterns) {
    if (typeof raw !== 'string') continue;
    let pattern = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!pattern) continue;

    if (/[*?]/.test(pattern)) {
      globs.push(globToRegExp(pattern.endsWith('/') ? `${pattern}**` : pattern));
      continue;
    }

    const clean = pattern.replace(/\/+$/, '');
    if (!clean) continue;
    exact.add(clean);
    prefixes.push(`${clean}/`);
  }

  if (!globs.length && !exact.size) return () => false;
  return (relPath) => {
    if (!relPath) return false;
    if (globs.some((re) => re.test(relPath))) return true;
    if (exact.has(relPath)) return true;
    return prefixes.some((prefix) => relPath.startsWith(prefix));
  };
}
