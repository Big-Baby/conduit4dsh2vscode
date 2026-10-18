#!/usr/bin/env node
/**
 * Builds the online documentation.
 *
 * Sources live in docs/src/*.md and stay readable offline. The generated HTML
 * adds a sidebar, Mermaid diagrams and syntax highlighting from CDNs, so it
 * needs a network connection but renders diagrams directly in the browser.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'docs', 'src');
const outDir = join(root, 'docs');

const PAGES = [
  { file: 'index', title: '概述', group: '开始' },
  { file: 'architecture', title: '架构', group: '设计' },
  { file: 'protocol', title: 'RPC 协议', group: '设计' },
  { file: 'bridge', title: '网关', group: '实现' },
  { file: 'extension', title: '编辑器客户端', group: '实现' },
  { file: 'development', title: '开发与发布', group: '工程' },
];

const LINK_REWRITE = {
  '../protocol/': 'protocol.html',
  '../bridge/': 'bridge.html',
  '../extension/': 'extension.html',
  '../LICENSE': 'https://github.com/conduit4dsh2vscode/conduit4dsh2vscode/blob/main/LICENSE',
};

const CSS = `
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #59636e;
  --line: #d8dee4;
  --panel: #f6f8fa;
  --accent: #0969da;
  --code-bg: #f6f8fa;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9198a1;
    --line: #30363d;
    --panel: #151b23;
    --accent: #4493f8;
    --code-bg: #161b22;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--fg);
  background: var(--bg);
  font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 260px;
  flex: none;
  padding: 28px 20px;
  border-right: 1px solid var(--line);
  background: var(--panel);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}
.brand { font-weight: 700; font-size: 17px; letter-spacing: .01em; }
.brand span { display: block; margin-top: 4px; font-weight: 400; font-size: 12px; color: var(--muted); }
.nav-group { margin-top: 26px; }
.nav-group h2 {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}
.nav-group a {
  display: block;
  padding: 5px 10px;
  margin: 1px 0;
  border-radius: 6px;
  color: var(--fg);
  font-size: 14px;
}
.nav-group a:hover { background: var(--line); text-decoration: none; }
.nav-group a.active { background: var(--accent); color: #fff; }
.content { flex: 1; min-width: 0; padding: 44px 48px 80px; }
.page { max-width: 880px; margin: 0 auto; }
.page-meta { color: var(--muted); font-size: 13px; margin-bottom: 26px; }
h1 { font-size: 30px; line-height: 1.3; margin: 0 0 18px; }
h2 { font-size: 21px; margin: 38px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 17px; margin: 26px 0 10px; }
p { margin: 0 0 14px; }
ul, ol { margin: 0 0 16px; padding-left: 24px; }
li { margin: 4px 0; }
code {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--code-bg);
  font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
pre { margin: 0 0 18px; padding: 14px 16px; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--code-bg); }
pre code { padding: 0; background: none; font-size: 13px; }
pre.mermaid { background: var(--panel); text-align: center; border-style: dashed; }
table { width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px; }
th, td { padding: 8px 12px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
th { background: var(--panel); font-weight: 600; }
blockquote { margin: 0 0 18px; padding: 6px 16px; border-left: 3px solid var(--line); color: var(--muted); }
hr { border: none; border-top: 1px solid var(--line); margin: 32px 0; }
.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 14px; }
.pager a { max-width: 46%; }
.pager .next { margin-left: auto; text-align: right; }
@media (max-width: 900px) {
  .layout { display: block; }
  .sidebar { position: static; width: auto; height: auto; border-right: none; border-bottom: 1px solid var(--line); }
  .content { padding: 28px 20px 60px; }
}
`;

function inline(text) {
  const codeSpans = [];
  let value = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  value = escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const target = rewriteLink(String(href));
      return `<a href="${target}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  return value.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => {
    const code = codeSpans[Number(index)] ?? '';
    return `<code>${escapeHtml(code)}</code>`;
  });
}

function rewriteLink(href) {
  let target = href;
  for (const [prefix, replacement] of Object.entries(LINK_REWRITE)) {
    if (target.startsWith(prefix)) {
      target = replacement + target.slice(prefix.length);
      break;
    }
  }
  if (target.startsWith('./')) target = target.slice(2);
  if (/^[^#:]+\.md(#.*)?$/.test(target)) target = target.replace(/\.md/, '.html');
  return target;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderTable(lines) {
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());

  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  const head = `<tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr>`;
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderMarkdown(markdown) {
  const blocks = [];
  let text = markdown.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    blocks.push({ lang: String(lang ?? ''), code: String(code ?? '') });
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });

  const lines = text.split('\n');
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const blockToken = /^\u0000BLOCK(\d+)\u0000$/.exec(line.trim());
    if (blockToken) {
      const block = blocks[Number(blockToken[1])];
      if (block?.lang === 'mermaid') {
        out.push(`<pre class="mermaid">${escapeHtml(block.code.trim())}</pre>`);
      } else if (block) {
        const language = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
        out.push(`<pre><code${language}>${escapeHtml(block.code)}</code></pre>`);
      }
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 2;
      const label = heading[2] ?? '';
      const id = slug(label);
      out.push(`<h${level} id="${id}">${inline(label)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\|/.test(line) && /^\|?[\s:|-]+\|?$/.test(lines[index + 1] ?? '')) {
      const tableLines = [];
      while (index < lines.length && /^\|/.test(lines[index] ?? '')) {
        tableLines.push(lines[index] ?? '');
        index += 1;
      }
      out.push(renderTable(tableLines));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        items.push(`<li>${inline((lines[index] ?? '').replace(/^[-*]\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        items.push(`<li>${inline((lines[index] ?? '').replace(/^\d+\.\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const parts = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        parts.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>${inline(parts.join(' '))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      out.push('<hr>');
      index += 1;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^(#{1,4})\s+/.test(lines[index] ?? '') &&
      !/^[-*]\s+/.test(lines[index] ?? '') &&
      !/^\d+\.\s+/.test(lines[index] ?? '') &&
      !/^>\s?/.test(lines[index] ?? '') &&
      !/^\|/.test(lines[index] ?? '') &&
      !/^\u0000BLOCK\d+\u0000$/.test((lines[index] ?? '').trim())
    ) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return out.join('\n');
}

function sidebar(active) {
  const groups = new Map();
  for (const page of PAGES) {
    const list = groups.get(page.group) ?? [];
    list.push(page);
    groups.set(page.group, list);
  }

  return [...groups.entries()]
    .map(([group, pages]) => {
      const links = pages
        .map(
          (page) =>
            `<a href="${page.file}.html"${page.file === active ? ' class="active"' : ''}>${page.title}</a>`,
        )
        .join('\n');
      return `<div class="nav-group"><h2>${group}</h2>\n${links}\n</div>`;
    })
    .join('\n');
}

function pager(active) {
  const index = PAGES.findIndex((page) => page.file === active);
  const previous = PAGES[index - 1];
  const next = PAGES[index + 1];
  return `<nav class="pager">
    ${previous ? `<a class="prev" href="${previous.file}.html">← ${previous.title}</a>` : '<span></span>'}
    ${next ? `<a class="next" href="${next.file}.html">${next.title} →</a>` : '<span></span>'}
  </nav>`;
}

function template(page, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${page.title} · Conduit</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github.min.css" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
<style>${CSS}</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand">Conduit<span>DSH to VS Code</span></div>
    ${sidebar(page.file)}
    <div class="nav-group">
      <h2>离线版本</h2>
      <a href="src/${page.file}.md">Markdown 源文件</a>
    </div>
  </aside>
  <main class="content">
    <article class="page">
      <div class="page-meta">${page.group} · 协议 1.0 · v0.8.0</div>
      ${body}
      ${pager(page.file)}
    </article>
  </main>
</div>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/common.min.js"></script>
<script>hljs.highlightAll();</script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
  await mermaid.run({ querySelector: '.mermaid' });
</script>
</body>
</html>`;
}

mkdirSync(outDir, { recursive: true });

for (const page of PAGES) {
  const source = readFileSync(join(sourceDir, `${page.file}.md`), 'utf8');
  const html = renderMarkdown(source);
  writeFileSync(join(outDir, `${page.file}.html`), template(page, html), 'utf8');
  process.stdout.write(`docs/${page.file}.html\n`);
}

process.stdout.write(`built ${PAGES.length} pages\n`);
