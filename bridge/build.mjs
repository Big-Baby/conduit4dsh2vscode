import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/**
 * Bundles the bridge into one ESM file.
 *
 * Harness packages stay external: the plugin always runs inside a dsh process
 * and must use that process's copies of cordis, schemastery and the harness
 * services.
 */
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*', 'node:*'],
  alias: {
    '@conduit4dsh2vscode/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
  },
  sourcemap: true,
  logLevel: 'info',
});
