import { execFile } from 'node:child_process';

export interface CliResolution {
  command: string;
  prefixArgs: string[];
  source: 'config' | 'path' | 'npx';
}

/** Resolution order: configured path, PATH, then the npx fallback. */
export async function resolveCli(configured: string): Promise<CliResolution> {
  if (configured.trim()) {
    return { command: configured.trim(), prefixArgs: [], source: 'config' };
  }
  if (await probe('dsh', ['--version'])) {
    return { command: 'dsh', prefixArgs: [], source: 'path' };
  }
  return { command: 'npx', prefixArgs: ['--yes', '@deepseek-ai/dsh'], source: 'npx' };
}

function probe(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000, windowsHide: true }, (error) => resolve(!error));
  });
}
