import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Reads the harness version.
 *
 * The most reliable source is the CLI entry point, since the bridge runs in the
 * same process. Global installation layouts are kept as fallbacks.
 */
export function readDshVersion(home: string): string {
  const candidates: string[] = [];
  const push = (file: string): void => {
    if (file && !candidates.includes(file)) candidates.push(file);
  };

  try {
    const entry = process.argv[1];
    if (entry) {
      let directory = dirname(realpathSync(entry));
      for (let depth = 0; depth < 8; depth += 1) {
        push(join(directory, 'package.json'));
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
  } catch {
    /* ignore */
  }

  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
  push(join(home, '..', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));
  push(join(home, 'profiles', process.env.DSH_PROFILE ?? 'rpc', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));

  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (manifest.name && manifest.name !== '@deepseek-ai/dsh') continue;
      if (manifest.version) return manifest.version;
    } catch {
      /* ignore */
    }
  }
  return process.env.DSH_VERSION ?? 'unknown';
}
