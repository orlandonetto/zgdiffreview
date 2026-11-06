/** @typedef {import('../shared/types.js').ReviewInfo} ReviewInfo */
/** @typedef {import('../shared/types.js').ReviewComment} ReviewComment */

/**
 * Exporta os comentários em Markdown, agrupados por arquivo e na ordem das linhas.
 *
 * @param {ReviewInfo} review
 * @param {ReviewComment[]} comments
 */
export function commentsToMarkdown(review, comments) {
  const out = [];
  out.push(`# Review: \`${review.head}\` → \`${review.base}\` (${review.repoName})`);
  out.push('');
  out.push(`Comparação: \`${review.mergeBaseSha.slice(0, 8)}...${review.headSha.slice(0, 8)}\` · ${comments.length} comentário(s)`);

  const order = new Map(review.files.map((f, k) => [f.path, k]));
  const byFile = new Map();
  for (const c of comments) byFile.set(c.path, [...(byFile.get(c.path) ?? []), c]);

  const paths = [...byFile.keys()].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));
  for (const path of paths) {
    out.push('', `## \`${path}\``);
    const list = byFile.get(path).sort((a, b) => a.startLine - b.startLine || a.side.localeCompare(b.side));
    for (const c of list) {
      const lines = c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-L${c.endLine}`;
      const side = c.side === 'new' ? 'versão nova' : 'versão antiga';
      out.push('', `### ${path}:${lines} (${side})`);
      if (c.snippet) out.push('', fence(c.snippet, language(path)));
      out.push('', c.body.trim());
    }
  }
  if (comments.length === 0) out.push('', '_Nenhum comentário._');
  return `${out.join('\n')}\n`;
}

function language(path) {
  const ext = path.split('.').pop() ?? '';
  return /^[\w+-]{1,10}$/.test(ext) && ext !== path ? ext : '';
}

/** Usa uma cerca maior que qualquer sequência de crases dentro do trecho. */
function fence(code, lang) {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}
