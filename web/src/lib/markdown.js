/**
 * Markdown mínimo para as respostas do chat: blocos de código, `código`, **negrito**,
 * títulos, listas e links para arquivo:linha. Todo o texto é escapado antes; o HTML gerado
 * só tem as tags que este arquivo cria.
 */

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// caminho/arquivo.ext:123 (ou :123-130)
const LOCATION_RE = /(^|[\s(`'"[])((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][\w]{0,7}):(\d+)(?:[-–](\d+))?/g;

function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(LOCATION_RE, (_, pre, path, line) => `${pre}<a class="loc" data-path="${path}" data-line="${line}">${path}:${line}</a>`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, k) => {
    const c = codes[Number(k)];
    const loc = /^((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z]\w{0,7}):(\d+)$/.exec(c);
    if (loc) return `<a class="loc" data-path="${loc[1]}" data-line="${loc[2]}"><code>${c}</code></a>`;
    return `<code>${c}</code>`;
  });
  return s;
}

export function renderMarkdown(src) {
  const out = [];
  const lines = src.split('\n');
  let k = 0;
  let list = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  while (k < lines.length) {
    const line = lines[k];
    const fence = /^\s*(`{3,})\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      closeList();
      const body = [];
      k++;
      while (k < lines.length && !lines[k].trim().startsWith(fence[1])) body.push(lines[k++]);
      k++;
      out.push(`<pre class="md-code"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<div class="md-h md-h${h[1].length}">${inline(h[2])}</div>`);
    } else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)[1])}</li>`);
    } else if (!line.trim()) {
      closeList();
      out.push('<div class="md-gap"></div>');
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    k++;
  }
  closeList();
  return out.join('');
}
