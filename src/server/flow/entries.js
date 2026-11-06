import { posix } from 'node:path';
import { isCodeFile } from './imports.js';

const CONVENTIONAL = ['server', 'index', 'main', 'app'];
const CONVENTIONAL_EXT = ['.js', '.mjs', '.cjs', '.ts', '.mts'];
const RUNNERS = /(?:^|\s|&&|;)(?:node|nodemon|ts-node|tsx|bun|deno run|node --watch|npx\s+(?:nodemon|ts-node|tsx))(?:\s+-[-\w=]+)*\s+([\w./@-]+\.(?:m|c)?[jt]s)\b/;

/**
 * Descobre os pontos de entrada da aplicação.
 *
 * @param {Set<string>} files arquivos do commit
 * @param {(path: string) => Promise<string | null>} readText leitor de arquivos do commit
 * @param {string[]} [configured] entradas do .zgdiff.json (têm prioridade)
 * @returns {Promise<string[]>}
 */
export async function findEntries(files, readText, configured = []) {
  const entries = [];
  const add = (p) => {
    const clean = p && posix.normalize(p).replace(/^\.\//, '');
    if (!clean || !files.has(clean) || !isCodeFile(clean)) return false;
    if (!entries.includes(clean)) entries.push(clean);
    return true;
  };

  for (const p of configured) add(p);
  if (entries.length) return entries;

  // package.json da raiz e de cada pacote (monorepo).
  const pkgs = [...files].filter((f) => f === 'package.json' || f.endsWith('/package.json')).sort((a, b) => depth(a) - depth(b));
  for (const pkgPath of pkgs) {
    const dir = posix.dirname(pkgPath) === '.' ? '' : posix.dirname(pkgPath);
    const at = (p) => (dir ? `${dir}/${p}` : p);
    const before = entries.length;
    let pkg;
    try {
      pkg = JSON.parse((await readText(pkgPath)) ?? '');
    } catch {
      continue;
    }
    for (const name of ['start', 'dev', 'serve']) {
      const m = RUNNERS.exec(pkg.scripts?.[name] ?? '');
      if (m) add(at(m[1]));
    }
    if (typeof pkg.main === 'string') add(at(pkg.main));
    if (typeof pkg.bin === 'string') add(at(pkg.bin));
    else if (pkg.bin && typeof pkg.bin === 'object') for (const v of Object.values(pkg.bin)) if (typeof v === 'string') add(at(v));
    // Vite/Vue: o index.html aponta para o script principal.
    if (files.has(at('index.html'))) {
      const html = (await readText(at('index.html'))) ?? '';
      const src = /<script[^>]+type=["']module["'][^>]+src=["']\/?([^"']+)["']/.exec(html)?.[1];
      if (src) add(at(src));
    }
    if (entries.length === before) conventional(dir, add);
  }
  if (!entries.length) conventional('', add);
  return entries;
}

/** Só o primeiro nome convencional encontrado (server > index > main > app): os outros costumam ser importados por ele. */
function conventional(dir, add) {
  for (const base of [dir, dir ? `${dir}/src` : 'src']) {
    for (const name of CONVENTIONAL) {
      for (const ext of CONVENTIONAL_EXT) if (add(base ? `${base}/${name}${ext}` : `${name}${ext}`)) return;
    }
  }
}

function depth(p) {
  return p.split('/').length;
}
