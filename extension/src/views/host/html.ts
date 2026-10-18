import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

const assetCache = new Map<string, string>();

/**
 * Reads a built asset and makes it safe to inline.
 *
 * A closing `</script>` or `</style>` inside the content would terminate the
 * host document early; the escaped form is equivalent inside JS and CSS.
 */
export function inlineAsset(extensionUri: vscode.Uri, ...segments: string[]): string {
  const file = join(extensionUri.fsPath, ...segments);
  const cached = assetCache.get(file);
  if (cached !== undefined) return cached;

  let content = '';
  try {
    content = readFileSync(file, 'utf8').replace(/<\/(script|style)/gi, '<\\/$1');
  } catch {
    content = '';
  }
  assetCache.set(file, content);
  return content;
}

export interface HtmlOptions {
  webview: vscode.Webview;
  title: string;
  body: string;
  script?: string;
  style?: string;
  /** Extra inline script that runs before the app (used for diagnostics). */
  bootstrap?: string;
}

/**
 * Builds a webview document.
 *
 * `cspSource` must be used instead of `'self'`: under Remote-SSH the webview
 * origin and the resource proxy differ, and `'self'` silently blocks assets.
 */
export function renderHtml(options: HtmlOptions): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const csp = options.webview.cspSource;
  const style = options.style ? `<style nonce="${nonce}">${options.style}</style>` : '';
  const bootstrap = options.bootstrap ? `<script nonce="${nonce}">${options.bootstrap}</script>` : '';
  const script = options.script ? `<script nonce="${nonce}">${options.script}</script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: https:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${csp};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(options.title)}</title>
${style}
</head>
<body>
${options.body}
${bootstrap}
${script}
</body>
</html>`;
}

/** Surfaces runtime errors in the panel, where the user can see them. */
export const DIAGNOSTIC_BOOTSTRAP = `
window.__dshFatal = function (message) {
  var node = document.createElement('pre');
  node.style.cssText = 'position:fixed;inset:0 0 auto 0;z-index:999;margin:0;padding:10px;' +
    'color:#f14c4c;background:rgba(20,20,20,.94);white-space:pre-wrap;font-size:12px;max-height:45vh;overflow:auto';
  node.textContent = message;
  document.body.appendChild(node);
};
window.addEventListener('error', function (event) {
  window.__dshFatal('[dsh] ' + ((event.error && event.error.stack) || event.message || event.type));
});
window.addEventListener('unhandledrejection', function (event) {
  var reason = event.reason;
  window.__dshFatal('[dsh] ' + ((reason && (reason.stack || reason.message)) || String(reason)));
});
`;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
