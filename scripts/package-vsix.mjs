#!/usr/bin/env node
/**
 * Builds the extension and packages it as a VSIX.
 *
 * The extension is bundled, so `--no-dependencies` is correct: there is nothing
 * to install into the extension directory at runtime.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const manifest = JSON.parse(readFileSync(join(extensionDir, 'package.json'), 'utf8'));
process.stdout.write(`packaging ${manifest.name}@${manifest.version}\n`);

execFileSync(npm, ['run', 'compile'], { cwd: extensionDir, stdio: 'inherit', shell: true });
execFileSync(npx, ['--yes', '@vscode/vsce', 'package', '--no-dependencies'], {
  cwd: extensionDir,
  stdio: 'inherit',
  shell: true,
});

process.stdout.write(`done: extension/${manifest.name}-${manifest.version}.vsix\n`);
