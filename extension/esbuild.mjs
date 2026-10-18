import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

/**
 * Bundles the extension host into one CommonJS file.
 *
 * Bundling keeps `@conduit4dsh2vscode/protocol` inlined, so the packaged extension has
 * no runtime workspace dependency and ships without node_modules.
 */
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  alias: {
    '@conduit4dsh2vscode/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
  },
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
