/** @typedef {import('./types.js').DiffFile} DiffFile */
/** @typedef {import('./types.js').Hunk} Hunk */

/**
 * Converte a saída de `git diff` (formato unificado, com prefixos a/ e b/) em
 * uma lista de arquivos com hunks e linhas numeradas.
 *
 * O fim de cada hunk é decidido pelas contagens do cabeçalho `@@`, não pelo
 * conteúdo, para que linhas como `--- algo` dentro do código não sejam
 * confundidas com cabeçalhos.
 *
 * @param {string} raw
 * @returns {DiffFile[]}
 */
export function parseUnifiedDiff(raw) {
  const lines = raw.split('\n');
  const files = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('diff --git ')) {
      i++;
      continue;
    }

    const start = i;
    const builder = newBuilder(line.slice('diff --git '.length));
    i++;

    // Cabeçalho estendido, até o primeiro hunk ou o próximo arquivo.
    while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@')) {
      readHeaderLine(builder, lines[i]);
      i++;
    }

    // Hunks.
    while (i < lines.length && lines[i].startsWith('@@')) {
      const hunk = parseHunkHeader(lines[i]);
      i++;
      let oldLeft = hunk.oldLines;
      let newLeft = hunk.newLines;
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;

      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i].startsWith('\\'))) {
        const l = lines[i];
        const marker = l[0];
        const content = l.slice(1);
        if (marker === '\\') {
          // "\ No newline at end of file": informativo, não é linha do arquivo.
        } else if (marker === '+') {
          hunk.lines.push({ type: 'add', content, newNo: newNo++ });
          newLeft--;
          builder.additions++;
        } else if (marker === '-') {
          hunk.lines.push({ type: 'del', content, oldNo: oldNo++ });
          oldLeft--;
          builder.deletions++;
        } else {
          // Linha de contexto (marcador ' '; uma linha vazia pode aparecer se o patch foi editado).
          hunk.lines.push({ type: 'context', content, oldNo: oldNo++, newNo: newNo++ });
          oldLeft--;
          newLeft--;
        }
        i++;
      }
      builder.hunks.push(hunk);
    }

    files.push(finish(builder, lines.slice(start, i).join('\n')));
  }

  return files;
}

function newBuilder(gitLineRest) {
  const [a, b] = splitDiffGitPaths(gitLineRest);
  return {
    fallbackOld: a,
    fallbackNew: b,
    oldPath: null,
    newPath: null,
    sawOldPath: false,
    sawNewPath: false,
    status: 'modified',
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  };
}

function readHeaderLine(b, line) {
  if (line.startsWith('new file mode')) {
    b.status = 'added';
  } else if (line.startsWith('deleted file mode')) {
    b.status = 'deleted';
  } else if (line.startsWith('rename from ')) {
    b.status = 'renamed';
    b.oldPath = unquote(line.slice('rename from '.length));
  } else if (line.startsWith('rename to ')) {
    b.status = 'renamed';
    b.newPath = unquote(line.slice('rename to '.length));
  } else if (line.startsWith('copy from ')) {
    b.status = 'copied';
    b.oldPath = unquote(line.slice('copy from '.length));
  } else if (line.startsWith('copy to ')) {
    b.status = 'copied';
    b.newPath = unquote(line.slice('copy to '.length));
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
    b.binary = true;
  } else if (line.startsWith('--- ')) {
    b.sawOldPath = true;
    b.oldPath = stripPrefix(unquote(line.slice(4)), 'a/');
  } else if (line.startsWith('+++ ')) {
    b.sawNewPath = true;
    b.newPath = stripPrefix(unquote(line.slice(4)), 'b/');
  }
}

/** @returns {DiffFile} */
function finish(b, rawPatch) {
  let oldPath = b.oldPath ?? (b.status === 'added' ? null : b.fallbackOld);
  let newPath = b.newPath ?? (b.status === 'deleted' ? null : b.fallbackNew);
  // `--- /dev/null` / `+++ /dev/null` viram null em stripPrefix.
  if (b.sawOldPath && b.oldPath === null) oldPath = null;
  if (b.sawNewPath && b.newPath === null) newPath = null;

  let status = b.status;
  if (status === 'modified' && oldPath === null) status = 'added';
  if (status === 'modified' && newPath === null) status = 'deleted';

  return {
    path: newPath ?? oldPath,
    oldPath,
    newPath,
    status,
    binary: b.binary,
    additions: b.additions,
    deletions: b.deletions,
    hunks: b.hunks,
    patchHash: fnv1a(rawPatch),
  };
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** @returns {Hunk} */
function parseHunkHeader(line) {
  const m = HUNK_RE.exec(line);
  if (!m) throw new Error(`Cabeçalho de hunk inválido: ${line}`);
  return {
    oldStart: Number(m[1]),
    oldLines: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newLines: m[4] === undefined ? 1 : Number(m[4]),
    section: m[5] ?? '',
    lines: [],
  };
}

/** Separa `a/x b/x` da linha `diff --git`. Só é usado quando não há `---`/`+++` (binários, renames puros). */
function splitDiffGitPaths(rest) {
  if (rest.startsWith('"')) {
    const end = findClosingQuote(rest, 0);
    const a = unquote(rest.slice(0, end + 1));
    const b = unquote(rest.slice(end + 2));
    return [stripPrefix(a, 'a/'), stripPrefix(b, 'b/')];
  }
  // Caso comum: mesmo caminho dos dois lados, então dá para cortar exatamente no meio.
  if (rest.length % 2 === 1) {
    const half = (rest.length - 1) / 2;
    const a = rest.slice(0, half);
    const b = rest.slice(half + 1);
    if (a.startsWith('a/') && b.startsWith('b/') && a.slice(2) === b.slice(2)) {
      return [a.slice(2), b.slice(2)];
    }
  }
  const idx = rest.indexOf(' b/');
  if (idx === -1) return [null, null];
  return [stripPrefix(rest.slice(0, idx), 'a/'), stripPrefix(unquote(rest.slice(idx + 1)), 'b/')];
}

function stripPrefix(p, prefix) {
  if (p === '/dev/null') return null;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

function findClosingQuote(s, open) {
  for (let k = open + 1; k < s.length; k++) {
    if (s[k] === '\\') k++;
    else if (s[k] === '"') return k;
  }
  return s.length - 1;
}

const ESCAPES = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };

/** Remove as aspas no estilo C que o git coloca em caminhos com caracteres especiais. */
function unquote(p) {
  // Em `---`/`+++` o git pode acrescentar um TAB depois do caminho.
  const trimmed = p.replace(/\t$/, '');
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  const body = trimmed.slice(1, -1);
  const bytes = [];
  const enc = new TextEncoder();
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch !== '\\') {
      bytes.push(...enc.encode(ch));
      continue;
    }
    const next = body[k + 1] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(k + 1, k + 4), 8));
      k += 3;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
      k += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
