const ID_CHAR = /[\p{L}\p{N}_$]/u;

/**
 * Identificador sob a coluna `col` (0 = primeiro caractere) de uma linha.
 * Se for acesso a membro (`obj.metodo`), devolve também o receptor (`obj`).
 *
 * @param {string} text linha de código
 * @param {number} col
 * @returns {{ name: string, start: number, end: number, receiver: string | null } | null}
 */
export function identifierAt(text, col) {
  if (!text) return null;
  let c = Math.max(0, Math.min(col, text.length));
  // Clique logo depois do fim da palavra também conta.
  if (!ID_CHAR.test(text[c] ?? '') && ID_CHAR.test(text[c - 1] ?? '')) c -= 1;
  if (!ID_CHAR.test(text[c] ?? '')) return null;
  let start = c;
  let end = c + 1;
  while (start > 0 && ID_CHAR.test(text[start - 1])) start--;
  while (end < text.length && ID_CHAR.test(text[end])) end++;
  const name = text.slice(start, end);
  if (/^\p{N}/u.test(name)) return null;

  let receiver = null;
  let k = start - 1;
  while (k >= 0 && text[k] === ' ') k--;
  if (text[k] === '.' && text[k - 1] !== '.') {
    let rEnd = k;
    while (rEnd > 0 && text[rEnd - 1] === ' ') rEnd--;
    let rStart = rEnd;
    while (rStart > 0 && ID_CHAR.test(text[rStart - 1])) rStart--;
    if (rStart < rEnd) receiver = text.slice(rStart, rEnd);
  }
  return { name, start, end, receiver };
}

export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
