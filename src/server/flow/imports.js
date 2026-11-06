/** Extensões cujos imports o Fluxo e a heurística de definição entendem. */
export const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue'];

export function isCodeFile(path) {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext)) && !path.endsWith('.d.ts');
}

/**
 * Troca comentários por espaços, preservando strings e quebras de linha
 * (posições continuam iguais às do arquivo original).
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (q !== '`' && src[i] === '\n') break;
        out += src[i];
        i++;
      }
      if (i < src.length) {
        out += src[i];
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const IMPORT_PATTERNS = [
  // import x from 'a'; import { a } from 'a'; export { a } from 'a'; export * from 'a'
  // (só no começo de uma instrução, para não pegar texto dentro de strings)
  /(?:^|[;{}])\s*(?:import|export)\s+(?:type\s+)?[\w*\s{},$]*?\s*from\s*['"]([^'"\n]+)['"]/gm,
  // import 'a' (efeito colateral)
  /(?:^|[;{}])\s*import\s*['"]([^'"\n]+)['"]/gm,
  // import('a')
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  // require('a')
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/**
 * Especificadores importados por um arquivo (`./x`, `@/y`, `express`...), sem repetição.
 * @param {string} source
 * @returns {string[]}
 */
export function extractImports(source) {
  const src = stripComments(source);
  const found = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) found.add(m[1]);
  }
  return [...found];
}
