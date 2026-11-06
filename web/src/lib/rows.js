/** @typedef {import('../../../src/shared/types.js').DiffFile} DiffFile */
/** @typedef {import('../../../src/shared/types.js').Hunk} Hunk */
/** @typedef {import('../../../src/shared/types.js').Side} Side */

/**
 * Um "gap" é um trecho sem alteração escondido entre hunks.
 * Gap 0 fica antes do primeiro hunk; o gap N (N = número de hunks) fica depois do último.
 *
 * @typedef {object} GapState
 * @property {number} top    linhas reveladas a partir do hunk de cima (expandir para baixo)
 * @property {number} bottom linhas reveladas a partir do hunk de baixo (expandir para cima)
 */

/**
 * @typedef {object} LineRow
 * @property {'line'} kind
 * @property {'context' | 'add' | 'del'} type
 * @property {string} content
 * @property {number} [oldNo]
 * @property {number} [newNo]
 * @property {boolean} [expanded] linha que veio de uma expansão de contexto
 */

/**
 * @typedef {object} GapRow
 * @property {'gap'} kind
 * @property {number} index
 * @property {number | null} hidden linhas ainda escondidas; null = ainda não se sabe (fim do arquivo)
 * @property {boolean} canExpandUp
 * @property {boolean} canExpandDown
 * @property {string} section
 */

/**
 * @typedef {object} Cell
 * @property {'context' | 'add' | 'del'} type
 * @property {number} no
 * @property {string} content
 * @property {boolean} [expanded]
 */

/**
 * @typedef {object} SplitLineRow
 * @property {'split'} kind
 * @property {Cell} [left]
 * @property {Cell} [right]
 */

/** @typedef {LineRow | GapRow} Row */
/** @typedef {SplitLineRow | GapRow} SplitRow */

export const EXPAND_STEP = 20;

/** Arquivos que têm trechos fora do diff (adicionados/removidos/binários mostram tudo ou nada). */
export function hasGaps(file) {
  return !file.binary && file.hunks.length > 0 && ['modified', 'renamed', 'copied'].includes(file.status);
}

const firstNew = (h) => (h.newLines > 0 ? h.newStart : h.newStart + 1);
const firstOld = (h) => (h.oldLines > 0 ? h.oldStart : h.oldStart + 1);
const nextNew = (h) => firstNew(h) + h.newLines;

/**
 * Trechos escondidos de um arquivo.
 * `from` = primeira linha (versão nova); `size` = tamanho (null = até o fim, desconhecido);
 * `offset` = old - new nesse trecho (constante, pois não há mudanças nele).
 *
 * @param {DiffFile} file
 * @param {number | null} newFileLineCount
 */
export function gapRanges(file, newFileLineCount) {
  const hunks = file.hunks;
  const ranges = [];
  for (let g = 0; g <= hunks.length; g++) {
    if (g < hunks.length) {
      const h = hunks[g];
      const from = g === 0 ? 1 : nextNew(hunks[g - 1]);
      ranges.push({ from, size: Math.max(0, firstNew(h) - from), offset: firstOld(h) - firstNew(h) });
    } else {
      const last = hunks[hunks.length - 1];
      const from = nextNew(last);
      const lastOldNext = firstOld(last) + last.oldLines;
      ranges.push({
        from,
        size: newFileLineCount === null ? null : Math.max(0, newFileLineCount - from + 1),
        offset: lastOldNext - from,
      });
    }
  }
  return ranges;
}

/**
 * Monta as linhas do modo unificado.
 *
 * @param {DiffFile} file
 * @param {GapState[]} gaps
 * @param {string[] | null} newFileLines conteúdo da versão nova (null se ainda não carregado)
 * @returns {Row[]}
 */
export function buildRows(file, gaps, newFileLines) {
  const rows = [];
  const withGaps = hasGaps(file);
  const ranges = withGaps ? gapRanges(file, newFileLines ? newFileLines.length : null) : [];

  for (let g = 0; g <= file.hunks.length; g++) {
    if (withGaps) pushGap(rows, g, ranges[g], gaps[g] ?? { top: 0, bottom: 0 }, file, newFileLines);
    const hunk = file.hunks[g];
    if (!hunk) continue;
    for (const l of hunk.lines) {
      rows.push({ kind: 'line', type: l.type, content: l.content, oldNo: l.oldNo, newNo: l.newNo });
    }
  }
  return rows;
}

function pushGap(rows, g, range, state, file, content) {
  const isFirst = g === 0;
  const isLast = g === file.hunks.length;
  const section = file.hunks[g]?.section ?? '';

  if (range.size === null) {
    // Fim do arquivo ainda não carregado: não sabemos se há algo lá.
    rows.push({ kind: 'gap', index: g, hidden: null, canExpandUp: false, canExpandDown: true, section });
    return;
  }
  if (range.size === 0) return;

  // Sem conteúdo carregado nada pode ser revelado ainda.
  const top = content ? Math.min(isFirst ? 0 : state.top, range.size) : 0;
  const bottom = content ? Math.min(isLast ? 0 : state.bottom, range.size - top) : 0;
  const hidden = range.size - top - bottom;

  for (let k = 0; k < top; k++) rows.push(contextRow(range.from + k, range.offset, content));
  if (hidden > 0) {
    rows.push({ kind: 'gap', index: g, hidden, canExpandUp: !isLast, canExpandDown: !isFirst, section });
  }
  for (let k = range.size - bottom; k < range.size; k++) rows.push(contextRow(range.from + k, range.offset, content));
}

function contextRow(newNo, offset, content) {
  return { kind: 'line', type: 'context', content: content[newNo - 1] ?? '', newNo, oldNo: newNo + offset, expanded: true };
}

/**
 * Aplica uma expansão e devolve o novo estado do gap.
 *
 * @param {GapState} state
 * @param {'up' | 'down' | 'all'} direction
 * @returns {GapState}
 */
export function expandGap(state, direction, step = EXPAND_STEP) {
  // Os dois lados no máximo: o gap 0 só cresce por baixo e o último só por cima.
  if (direction === 'all') return { top: Number.MAX_SAFE_INTEGER, bottom: Number.MAX_SAFE_INTEGER };
  if (direction === 'down') return { top: state.top + step, bottom: state.bottom };
  return { top: state.top, bottom: state.bottom + step };
}

/**
 * Pareia remoções e adições consecutivas para o modo lado a lado.
 *
 * @param {Row[]} rows
 * @returns {SplitRow[]}
 */
export function toSplitRows(rows) {
  const out = [];
  let k = 0;
  const isLine = (r, type) => r && r.kind === 'line' && r.type === type;
  while (k < rows.length) {
    const row = rows[k];
    if (row.kind === 'gap') {
      out.push(row);
      k++;
      continue;
    }
    if (row.type === 'context') {
      out.push({
        kind: 'split',
        left: { type: 'context', no: row.oldNo, content: row.content, expanded: row.expanded },
        right: { type: 'context', no: row.newNo, content: row.content, expanded: row.expanded },
      });
      k++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (isLine(rows[k], 'del')) dels.push(rows[k++]);
    while (isLine(rows[k], 'add')) adds.push(rows[k++]);
    const n = Math.max(dels.length, adds.length);
    for (let p = 0; p < n; p++) {
      const d = dels[p];
      const a = adds[p];
      out.push({
        kind: 'split',
        left: d ? { type: 'del', no: d.oldNo, content: d.content } : undefined,
        right: a ? { type: 'add', no: a.newNo, content: a.content } : undefined,
      });
    }
  }
  return out;
}

/**
 * Lado/linha a que uma linha unificada se refere para comentários
 * (contexto conta como versão nova, igual ao GitHub).
 *
 * @param {LineRow} row
 * @returns {{ side: Side, line: number }}
 */
export function anchorOf(row) {
  if (row.type === 'del') return { side: 'old', line: row.oldNo };
  return { side: 'new', line: row.newNo };
}

/** A linha (de qualquer modo) contém a posição side:line? */
export function rowHas(row, side, line) {
  if (row.kind === 'gap') return false;
  if (row.kind === 'line') return side === 'old' ? row.oldNo === line : row.newNo === line;
  return side === 'old' ? row.left?.no === line : row.right?.no === line;
}

/**
 * Texto das linhas side:[start,end] presentes nas linhas visíveis.
 *
 * @param {Row[]} rows
 * @param {Side} side
 */
export function snippetFor(rows, side, start, end) {
  const out = [];
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    const no = side === 'old' ? row.oldNo : row.newNo;
    if (no === undefined || no < start || no > end) continue;
    if (side === 'old' && row.type === 'add') continue;
    if (side === 'new' && row.type === 'del') continue;
    out.push(row.content);
  }
  return out.join('\n');
}
