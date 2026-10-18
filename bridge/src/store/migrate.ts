import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BridgePaths } from './paths';

/**
 * Imports state written by earlier bridge versions.
 *
 * Files are copied only when the new location is absent, so an upgrade keeps
 * projects, sessions, providers and stored transcripts without a manual step.
 */
export function migrateLegacyState(home: string, paths: BridgePaths): void {
  const files: Array<[string, string]> = [
    ['rpc-projects.json', paths.projects],
    ['rpc-sessions.json', paths.sessions],
    ['rpc-providers.json', paths.providers],
    ['rpc-default-model.json', paths.defaultModel],
    ['rpc-config.json', paths.runtimeConfig],
  ];

  for (const [legacyName, target] of files) {
    const source = join(home, legacyName);
    if (!existsSync(source) || existsSync(target)) continue;
    try {
      mkdirSync(join(target, '..'), { recursive: true });
      cpSync(source, target);
    } catch {
      // A failed migration is not fatal: the bridge starts with empty state.
    }
  }

  const directories: Array<[string, string]> = [
    ['rpc-messages', paths.messages],
    ['rpc-agents', paths.agents],
  ];
  for (const [legacyName, target] of directories) {
    const source = join(home, legacyName);
    if (!existsSync(source) || existsSync(target)) continue;
    try {
      cpSync(source, target, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}
