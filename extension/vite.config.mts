import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Chat webview bundle.
 *
 * Single-file IIFE because the host injects one nonce-protected script; code
 * splitting would require a nonce per chunk. `process.env.NODE_ENV` must be
 * defined explicitly: lib mode does not replace it, and the webview has no
 * `process` global.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/views/chat', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: {
      '@conduit4dsh2vscode/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
    },
  },
  define: {
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_OPTIONS_API__: 'false',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/chat', import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: 'esbuild',
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/views/chat/main.ts', import.meta.url)),
      name: 'DshChat',
      formats: ['iife'],
      fileName: () => 'dsh-chat.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'dsh-chat[extname]' },
    },
  },
});
