import { posix } from 'node:path';

/**
 * "Ir para a definição" preciso, com o mesmo mecanismo do VS Code: o language service do
 * pacote `typescript` (que também entende JavaScript), lendo os arquivos direto do commit.
 *
 * Os arquivos ficam num diretório virtual (/__zgdiff__/<sha>/...) para nunca se misturar
 * com o disco; só as bibliotecas padrão do TypeScript (lib.*.d.ts) vêm do disco.
 */

const SCRIPT_RE = /\.(m|c)?[jt]sx?$/;
const SKIP_RE = /(^|\/)(node_modules|dist|build|coverage|\.next|\.nuxt|vendor)\/|\.min\.js$|\.d\.ts$/;
const MAX_FILES = 6000;
const MAX_FILE_BYTES = 1024 * 1024;

let tsModule = null;
async function loadTs() {
  tsModule ??= import('typescript').then((m) => m.default ?? m);
  return tsModule;
}

/**
 * Para .vue: mantém só o conteúdo dos <script>, trocando todo o resto por espaços
 * (as quebras de linha ficam), para que linha/coluna continuem iguais às do arquivo original.
 */
export function vueToScript(source) {
  const keep = new Uint8Array(source.length);
  let lang = 'js';
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source))) {
    if (/\blang=["']ts["']/.test(m[1])) lang = 'ts';
    const start = m.index + m[0].indexOf('>') + 1;
    for (let k = start; k < start + m[2].length; k++) keep[k] = 1;
  }
  let out = '';
  for (let k = 0; k < source.length; k++) {
    const ch = source[k];
    out += keep[k] || ch === '\n' || ch === '\r' ? ch : ' ';
  }
  return { text: out, lang };
}

function lineStarts(text) {
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) starts.push(k + 1);
  return starts;
}

function lineColOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: pos - starts[lo] };
}

export class TsProject {
  #ready = null;
  #service = null;
  #ts = null;
  /** caminho virtual -> { real, text, starts } */
  #files = new Map();
  /** caminho real -> caminho virtual */
  #byReal = new Map();
  #dirs = new Set();
  #root;

  /** @param {import('../repo.js').Snapshot} snap */
  constructor(snap) {
    this.snap = snap;
    this.#root = `/__zgdiff__/${snap.sha.slice(0, 12)}/`;
  }

  /** Carrega os arquivos e monta o language service (uma vez). */
  ready() {
    this.#ready ??= this.#init();
    return this.#ready;
  }

  async #init() {
    const ts = await loadTs();
    this.#ts = ts;
    const all = [...(await this.snap.files())].filter((p) => (SCRIPT_RE.test(p) || p.endsWith('.vue')) && !SKIP_RE.test(p));
    const picked = [];
    for (const p of all) {
      if (picked.length >= MAX_FILES) break;
      if ((await this.snap.size(p)) <= MAX_FILE_BYTES) picked.push(p);
    }
    const texts = await Promise.all(picked.map((p) => this.snap.text(p)));
    picked.forEach((real, k) => {
      let text = texts[k];
      if (text === null) return;
      let virtual = this.#root + real;
      if (real.endsWith('.vue')) {
        const v = vueToScript(text);
        text = v.text;
        virtual = `${virtual}.${v.lang}`;
      }
      this.#files.set(virtual, { real, text, starts: lineStarts(text) });
      this.#byReal.set(real, virtual);
      for (let d = posix.dirname(virtual); d.length >= this.#root.length - 1; d = posix.dirname(d)) {
        if (this.#dirs.has(d)) break;
        this.#dirs.add(d);
      }
    });

    const options = await this.#compilerOptions(ts);
    const root = this.#root;
    const files = this.#files;
    const dirs = this.#dirs;
    const inRoot = (p) => p.startsWith(root);
    const host = {
      getScriptFileNames: () => [...files.keys()],
      getScriptVersion: () => '1',
      getScriptSnapshot: (name) => {
        const f = files.get(name);
        if (f) return ts.ScriptSnapshot.fromString(f.text);
        if (inRoot(name)) return undefined;
        const text = ts.sys.readFile(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (p) => files.has(p) || (!inRoot(p) && ts.sys.fileExists(p)),
      readFile: (p) => files.get(p)?.text ?? (inRoot(p) ? undefined : ts.sys.readFile(p)),
      directoryExists: (d) => (inRoot(d) || d === root.slice(0, -1) ? dirs.has(d.replace(/\/$/, '')) : ts.sys.directoryExists(d)),
      getDirectories: (d) => {
        if (!inRoot(d) && d !== root.slice(0, -1)) return ts.sys.getDirectories(d);
        const base = d.replace(/\/$/, '');
        return [...dirs].filter((x) => posix.dirname(x) === base && x !== base).map((x) => posix.basename(x));
      },
      useCaseSensitiveFileNames: () => true,
    };
    this.#service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  async #compilerOptions(ts) {
    const root = this.#root;
    const options = {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      allowImportingTsExtensions: true,
      allowArbitraryExtensions: true,
      resolveJsonModule: true,
      types: [],
    };
    // `paths` do tsconfig/jsconfig da raiz, convertidos para caminhos absolutos (sem baseUrl).
    let paths = { '@/*': [`${root}src/*`], '~/*': [`${root}src/*`] };
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const raw = await this.snap.text(name);
      if (!raw) continue;
      const parsed = ts.parseConfigFileTextToJson(name, raw).config?.compilerOptions;
      if (parsed?.paths && typeof parsed.paths === 'object') {
        const base = posix.join(root, typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '.');
        paths = {};
        for (const [k, v] of Object.entries(parsed.paths)) {
          if (Array.isArray(v)) paths[k] = v.filter((x) => typeof x === 'string').map((x) => posix.join(base, x));
        }
      }
      break;
    }
    options.paths = paths;
    return options;
  }

  /**
   * Definições do símbolo em (path, line 1-based, col 0-based).
   * @returns {Promise<Array<{ path: string, line: number, col: number }> | null>} null = arquivo fora do projeto
   */
  async definitionAt(path, line, col) {
    await this.ready();
    const virtual = this.#byReal.get(path);
    if (!virtual) return null;
    const file = this.#files.get(virtual);
    const start = file.starts[line - 1];
    if (start === undefined) return [];
    const defs = this.#service.getDefinitionAtPosition(virtual, start + col) ?? [];
    const out = [];
    for (const d of defs) {
      const target = this.#files.get(d.fileName);
      if (!target) continue; // biblioteca padrão (lib.d.ts) ou pacote externo
      const pos = lineColOf(target.starts, d.textSpan.start);
      if (!out.some((o) => o.path === target.real && o.line === pos.line)) out.push({ path: target.real, ...pos });
    }
    return out;
  }
}
