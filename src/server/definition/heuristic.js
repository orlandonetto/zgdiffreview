import { posix } from 'node:path';
import { escapeRegExp } from './symbol.js';

/**
 * Busca de definição sem análise de tipos: declarações no próprio arquivo, imports
 * seguidos até o arquivo de origem e, por último, `git grep` no repositório.
 */

/** Padrões de declaração de `name` (JS/TS/Vue, com alguns de outras linguagens). */
export function declarationPatterns(name) {
  const n = escapeRegExp(name);
  const b = '(?![\\p{L}\\p{N}_$])';
  const mods = '(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?';
  return [
    new RegExp(`\\bfunction\\s*\\*?\\s*${n}${b}`, 'u'),
    new RegExp(`\\b(?:const|let|var)\\s+${n}${b}`, 'u'),
    new RegExp(`\\b(?:const|let|var)\\s*[{[][^=]*(?<![\\p{L}\\p{N}_$])${n}${b}[^=]*[}\\]]\\s*=`, 'u'),
    new RegExp(`${mods}\\bclass\\s+${n}${b}`, 'u'),
    new RegExp(`\\b(?:interface|type|enum)\\s+${n}${b}`, 'u'),
    // Método de classe/objeto: `nome(args) {` (exige a chave, para não confundir com chamada).
    new RegExp(`^\\s*(?:(?:public|private|protected|static|async|get|set|override)\\s+)*\\*?${n}\\s*\\([^)]*\\)\\s*(?::[^={;]*)?\\{`, 'u'),
    new RegExp(`(?:^|[\\s,{])${n}\\s*:\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\p{L}_$][\\p{L}\\p{N}_$]*\\s*=>)`, 'u'),
    new RegExp(`(?:^|[\\s,{])(?:async\\s+)?${n}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\p{L}_$][\\p{L}\\p{N}_$]*\\s*=>)`, 'u'),
    new RegExp(`\\b(?:module\\.)?exports\\.${n}\\s*=`, 'u'),
    new RegExp(`\\bthis\\.${n}\\s*=(?!=)`, 'u'),
    new RegExp(`\\bdef\\s+${n}${b}`, 'u'),
    new RegExp(`\\bfunc\\s+(?:\\([^)]*\\)\\s*)?${n}${b}`, 'u'),
  ];
}

const IMPORT_LINE = /\bimport\b|\brequire\s*\(/;

export function isDeclarationLine(text, name) {
  if (IMPORT_LINE.test(text)) return false;
  return declarationPatterns(name).some((re) => re.test(text));
}

/**
 * Se `name` vem de um import no arquivo, devolve { spec, kind } —
 * kind 'default' (import X / const X = require), 'namespace' (import * as X) ou 'named'.
 */
export function findImportBinding(source, name) {
  const n = escapeRegExp(name);
  const b = '(?![\\p{L}\\p{N}_$])';
  const pats = [
    [new RegExp(`\\bimport\\s+(?:type\\s+)?\\*\\s+as\\s+${n}${b}[^'"]*from\\s*['"]([^'"]+)['"]`, 'u'), 'namespace'],
    [new RegExp(`\\bimport\\s+(?:type\\s+)?${n}${b}\\s*(?:,[^'"]*)?from\\s*['"]([^'"]+)['"]`, 'u'), 'default'],
    [new RegExp(`\\bimport\\s+(?:type\\s+)?[^'"]*\\{[^}]*(?<![\\p{L}\\p{N}_$])(?:${n}|[\\p{L}\\p{N}_$]+\\s+as\\s+${n})${b}[^}]*\\}[^'"]*from\\s*['"]([^'"]+)['"]`, 'u'), 'named'],
    [new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=\\s*require\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*;?\\s*$`, 'mu'), 'default'],
    [new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=\\s*require\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*\\.\\s*([\\p{L}_$][\\p{L}\\p{N}_$]*)`, 'mu'), 'member'],
    [new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*(?<![\\p{L}\\p{N}_$])(?:${n}|[\\p{L}\\p{N}_$]+\\s*:\\s*${n})${b}[^}]*\\}\\s*=\\s*require\\s*\\(\\s*['"]([^'"]+)['"]`, 'u'), 'named'],
  ];
  for (const [re, kind] of pats) {
    const m = re.exec(source);
    if (m) {
      // Para `import { a as b }`, o nome exportado é `a`.
      let exported = name;
      const alias = new RegExp(`([\\p{L}_$][\\p{L}\\p{N}_$]*)\\s+as\\s+${n}${b}|([\\p{L}_$][\\p{L}\\p{N}_$]*)\\s*:\\s*${n}${b}`, 'u').exec(m[0]);
      if (kind === 'named' && alias) exported = alias[1] ?? alias[2];
      if (kind === 'member') return { spec: m[1], kind: 'named', exported: m[2], line: lineOf(source, m.index) };
      return { spec: m[1], kind, exported, line: lineOf(source, m.index) };
    }
  }
  return null;
}

function lineOf(source, index) {
  let line = 1;
  for (let k = 0; k < index; k++) if (source.charCodeAt(k) === 10) line++;
  return line;
}

/** Linhas (1-based) do arquivo que declaram `name`, fora de imports. */
export function declarationsIn(source, name) {
  const out = [];
  const lines = source.split('\n');
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].includes(name) && isDeclarationLine(lines[k], name)) out.push({ line: k + 1, text: lines[k] });
  }
  return out;
}

/** Linha do export default / module.exports de um arquivo, ou 1. */
function defaultExportLine(source) {
  const lines = source.split('\n');
  const k = lines.findIndex((l) => /^\s*export\s+default\b|^\s*module\.exports\s*=/.test(l));
  return k === -1 ? 1 : k + 1;
}

/**
 * @param {object} p
 * @param {import('../repo.js').Snapshot} p.snap
 * @param {string} p.path arquivo onde está o clique
 * @param {number} p.line linha (1-based) do clique
 * @param {{ name: string, receiver: string | null }} p.symbol
 * @param {(from: string, spec: string) => string | null} p.resolve
 * @returns {Promise<Array<{ path: string, line: number, text: string }>>}
 */
export async function findDefinitionHeuristic({ snap, path, line, symbol, resolve }) {
  const source = (await snap.text(path)) ?? '';

  // obj.metodo: se obj veio de um import, procura `metodo` no arquivo de origem.
  if (symbol.receiver && symbol.receiver !== 'this') {
    const binding = findImportBinding(source, symbol.receiver);
    const target = binding && resolve(path, binding.spec);
    if (target) {
      const found = await exportedDeclaration(snap, target, symbol.name, resolve, new Set());
      if (found.length) return found;
    }
  } else if (symbol.receiver === 'this') {
    const local = declarationsIn(source, symbol.name);
    if (local.length) return local.map((d) => ({ path, ...d }));
  }

  if (!symbol.receiver) {
    // 1) Declaração no próprio arquivo (a mais próxima acima do clique primeiro).
    const local = declarationsIn(source, symbol.name).sort((a, b) => rank(a.line, line) - rank(b.line, line));
    if (local.length) return local.map((d) => ({ path, ...d }));

    // 2) Veio de um import: segue até o arquivo de origem.
    const binding = findImportBinding(source, symbol.name);
    if (binding) {
      const target = resolve(path, binding.spec);
      if (target) {
        const text = (await snap.text(target)) ?? '';
        if (binding.kind === 'default' || binding.kind === 'namespace') {
          const ln = defaultExportLine(text);
          return [{ path: target, line: ln, text: text.split('\n')[ln - 1] ?? '' }];
        }
        const found = await exportedDeclaration(snap, target, binding.exported, resolve, new Set());
        if (found.length) return found;
        return [{ path: target, line: 1, text: text.split('\n')[0] ?? '' }];
      }
      // Pacote externo: mostra a própria linha do import.
      return [{ path, line: binding.line, text: source.split('\n')[binding.line - 1] ?? '' }];
    }
  }

  // 3) Repositório inteiro.
  return repoWide(snap, path, symbol.name);
}

/** `x < clique` vence `x > clique`; entre os de cima, o mais próximo. */
function rank(declLine, clickLine) {
  return declLine <= clickLine ? clickLine - declLine : 1e6 + declLine - clickLine;
}

/** Declaração exportada de `name` em `file`, seguindo `export ... from` (reexports). */
async function exportedDeclaration(snap, file, name, resolve, seen) {
  if (seen.has(file) || seen.size > 8) return [];
  seen.add(file);
  const text = (await snap.text(file)) ?? '';
  const direct = declarationsIn(text, name);
  if (direct.length) return direct.map((d) => ({ path: file, ...d }));

  const n = escapeRegExp(name);
  const reexports = [
    ...text.matchAll(new RegExp(`export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`, 'g')),
    ...text.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g),
  ];
  for (const m of reexports) {
    const target = resolve(file, m[1]);
    if (!target) continue;
    const found = await exportedDeclaration(snap, target, name, resolve, seen);
    if (found.length) return found;
  }
  // `module.exports = { name }` ou `export { name }` apontando para uma declaração local já falhou acima.
  return [];
}

async function repoWide(snap, fromPath, name) {
  const hits = await snap.grep(`(^|[^[:alnum:]_$])${escapeRegExp(name).replace(/\\\$/g, '[$]')}([^[:alnum:]_$]|$)`, { limit: 3000 });
  const decls = hits.filter((h) => isDeclarationLine(h.text, name));
  const dir = posix.dirname(fromPath);
  const distance = (p) => {
    const a = posix.dirname(p).split('/');
    const b = dir.split('/');
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    return a.length + b.length - 2 * common;
  };
  return decls
    .sort((x, y) => distance(x.path) - distance(y.path) || x.path.localeCompare(y.path) || x.line - y.line)
    .slice(0, 30)
    .map((h) => ({ path: h.path, line: h.line, text: h.text }));
}
