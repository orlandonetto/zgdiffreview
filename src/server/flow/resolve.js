import { posix } from 'node:path';

const TRY_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.json'];
const INDEX_FILES = ['index.js', 'index.mjs', 'index.cjs', 'index.ts', 'index.tsx', 'index.jsx', 'index.vue'];

/**
 * Resolve especificadores de import para arquivos do repositório.
 *
 * @param {Set<string>} files caminhos versionados no commit
 * @param {Record<string, string>} [aliases] prefixo -> pasta (ex.: { "@/": "src/" })
 */
export function createResolver(files, aliases = {}) {
  const aliasList = Object.entries({ '@/': 'src/', '~/': 'src/', ...aliases }).sort((a, b) => b[0].length - a[0].length);

  const tryPath = (base) => {
    const clean = posix.normalize(base).replace(/^\.\//, '');
    if (clean.startsWith('../')) return null;
    for (const ext of TRY_EXTENSIONS) {
      if (files.has(clean + ext)) return clean + ext;
    }
    // Import com .js que aponta para um .ts (comum em TS com ESM).
    const jsToTs = clean.replace(/\.(m|c)?js$/, '.$1ts');
    if (jsToTs !== clean && files.has(jsToTs)) return jsToTs;
    for (const idx of INDEX_FILES) {
      const p = clean ? `${clean}/${idx}` : idx;
      if (files.has(p)) return p;
    }
    return null;
  };

  /**
   * @param {string} fromFile arquivo que importa
   * @param {string} spec texto do import
   * @returns {string | null} caminho no repositório, ou null (pacote externo / não encontrado)
   */
  return function resolve(fromFile, spec) {
    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      return tryPath(posix.join(posix.dirname(fromFile), spec));
    }
    if (spec.startsWith('/')) return tryPath(spec.slice(1));
    for (const [prefix, target] of aliasList) {
      if (spec.startsWith(prefix)) {
        const rest = spec.slice(prefix.length);
        // Em monorepos o alias vale a partir do pacote do arquivo que importa.
        const pkgRoot = packageRootOf(files, fromFile);
        return tryPath(posix.join(pkgRoot, target, rest)) ?? tryPath(posix.join(target, rest));
      }
    }
    return null;
  };
}

/** Pasta do package.json mais próximo acima do arquivo ('' = raiz). */
export function packageRootOf(files, path) {
  let dir = posix.dirname(path);
  while (dir && dir !== '.') {
    if (files.has(`${dir}/package.json`)) return dir;
    dir = posix.dirname(dir);
  }
  return '';
}
