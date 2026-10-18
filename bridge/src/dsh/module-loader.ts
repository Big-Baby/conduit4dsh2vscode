import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Locates optional harness packages.
 *
 * The bridge is linked into a profile whose node_modules only contains its own
 * dependencies, while the harness packages live next to the CLI entry point.
 * Resolution therefore tries the bare specifier first and then walks up from
 * `process.argv[1]` looking for the `@deepseek-ai/dsh` package root.
 */
export async function loadHarnessExport<T>(pkg: string, exportName: string): Promise<T | undefined> {
  const attempts: Array<() => Promise<unknown>> = [() => import(pkg)];
  for (const candidate of packageCandidates(pkg)) {
    attempts.push(() => import(pathToFileURL(candidate).href));
  }

  for (const attempt of attempts) {
    try {
      const module = (await attempt()) as Record<string, unknown>;
      const value = module[exportName];
      if (typeof value === 'function') return value as T;
    } catch {
      // Try the next candidate; the package is optional.
    }
  }
  return undefined;
}

function packageCandidates(pkg: string): string[] {
  const candidates: string[] = [];
  const push = (root: string | undefined): void => {
    if (!root) return;
    const file = join(root, 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js');
    if (!candidates.includes(file)) candidates.push(file);
  };

  try {
    const entry = process.argv[1];
    if (entry) {
      let directory = dirname(realpathSync(entry));
      for (let depth = 0; depth < 8; depth += 1) {
        const manifest = join(directory, 'package.json');
        if (existsSync(manifest)) {
          try {
            const meta = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
            if (meta.name === '@deepseek-ai/dsh') {
              push(directory);
              break;
            }
          } catch {
            /* ignore a malformed manifest and keep walking */
          }
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
  } catch {
    /* argv[1] may be absent when embedded */
  }

  push('/usr/local/lib/node_modules/@deepseek-ai/dsh');
  push(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '..', 'node_modules', '@deepseek-ai', 'dsh'));
  return candidates;
}
