/** Small Markdown renderer: fenced code, inline code, bold, headings, lists. */

export function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

export function renderMarkdown(source: string): string {
  const blocks: Array<{ lang: string; code: string }> = [];

  let text = String(source).replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const index = blocks.length;
    blocks.push({ lang: lang ?? '', code: code ?? '' });
    return `\u0000CODE${index}\u0000`;
  });

  text = escapeHtml(text);
  text = text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^###\s?(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s?(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s?(.+)$/gm, '<h1>$1</h1>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>');

  text = `<p>${text}</p>`;
  return text.replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => {
    const block = blocks[Number(index)];
    if (!block) return '';
    return `<pre class="code-block" data-lang="${escapeHtml(block.lang)}"><code>${escapeHtml(block.code)}</code></pre>`;
  });
}

export function firstLine(text: string): string {
  const line = String(text ?? '')
    .split('\n')
    .find((candidate) => candidate.trim().length > 0);
  return (line ?? '').trim().slice(0, 120);
}

export function lineCount(text: string): number {
  return String(text ?? '').split('\n').length;
}
