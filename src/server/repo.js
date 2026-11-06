import { spawn } from 'node:child_process';
import { git } from './git.js';
import { GitError, NotFoundError } from './errors.js';

/** Arquivos maiores que isso não são lidos (minificados, dumps, binários grandes). */
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;

/**
 * Lê vários arquivos de commits com um único processo `git cat-file --batch`,
 * em vez de abrir um processo por arquivo.
 */
class BlobReader {
  #proc = null;
  #queue = [];
  #buffer = Buffer.alloc(0);

  constructor(root) {
    this.root = root;
  }

  #start() {
    this.#proc = spawn('git', ['cat-file', '--batch'], { cwd: this.root, stdio: ['pipe', 'pipe', 'ignore'] });
    this.#proc.stdout.on('data', (chunk) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#drain();
    });
    const fail = (err) => {
      for (const job of this.#queue) job.reject(new GitError(`git cat-file falhou: ${err?.message ?? 'encerrado'}`));
      this.#queue = [];
      this.#proc = null;
      this.#buffer = Buffer.alloc(0);
    };
    this.#proc.on('error', fail);
    this.#proc.on('exit', () => fail());
  }

  #drain() {
    while (this.#queue.length) {
      const nl = this.#buffer.indexOf(10);
      if (nl === -1) return;
      const header = this.#buffer.subarray(0, nl).toString('utf8');
      const job = this.#queue[0];
      if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
        this.#buffer = this.#buffer.subarray(nl + 1);
        this.#queue.shift();
        job.resolve(null);
        continue;
      }
      const size = Number(header.split(' ')[2]);
      if (this.#buffer.length < nl + 1 + size + 1) return;
      const content = this.#buffer.subarray(nl + 1, nl + 1 + size);
      this.#buffer = this.#buffer.subarray(nl + 1 + size + 1);
      this.#queue.shift();
      job.resolve(Buffer.from(content));
    }
  }

  /** @returns {Promise<Buffer | null>} */
  read(spec) {
    if (!this.#proc) this.#start();
    return new Promise((resolve, reject) => {
      this.#queue.push({ resolve, reject });
      this.#proc.stdin.write(`${spec}\n`);
    });
  }

  close() {
    this.#proc?.stdin.end();
    this.#proc = null;
  }
}

/**
 * Visão somente leitura de um commit: lista de arquivos versionados, conteúdo (com cache)
 * e busca. Tudo o que o Fluxo, o "ir para a definição" e o chat leem passa por aqui,
 * o que garante que só arquivos daquele commit sejam acessados.
 */
export class Snapshot {
  /** @type {Map<string, Promise<string | null>>} */
  #cache = new Map();
  #files = null;
  #sizes = null;

  constructor(root, sha, reader) {
    this.root = root;
    this.sha = sha;
    this.reader = reader;
  }

  /** Caminhos de todos os arquivos versionados no commit. */
  async files() {
    if (!this.#files) {
      const out = await git(this.root, ['ls-tree', '-r', '-z', '--long', '--full-tree', this.sha]);
      const files = new Set();
      const sizes = new Map();
      for (const entry of out.split('\0')) {
        if (!entry) continue;
        // "<mode> <type> <sha> <size>\t<path>"
        const tab = entry.indexOf('\t');
        const [, type, , size] = entry.slice(0, tab).trim().split(/\s+/);
        if (type !== 'blob') continue;
        const path = entry.slice(tab + 1);
        files.add(path);
        sizes.set(path, Number(size) || 0);
      }
      this.#files = files;
      this.#sizes = sizes;
    }
    return this.#files;
  }

  async has(path) {
    return (await this.files()).has(path);
  }

  async size(path) {
    await this.files();
    return this.#sizes.get(path) ?? 0;
  }

  /** Conteúdo em texto, ou null se não existir, for binário ou grande demais. */
  async text(path) {
    if (!this.#cache.has(path)) {
      this.#cache.set(
        path,
        (async () => {
          if (!(await this.has(path)) || (await this.size(path)) > MAX_BLOB_BYTES) return null;
          const buf = await this.reader.read(`${this.sha}:${path}`);
          if (!buf || buf.subarray(0, 8000).includes(0)) return null;
          return buf.toString('utf8');
        })(),
      );
    }
    return this.#cache.get(path);
  }

  /** Como text(), mas falha com 404 quando o arquivo não pode ser lido. */
  async requireText(path) {
    const t = await this.text(path);
    if (t === null) throw new NotFoundError(`Arquivo não disponível neste commit: ${path}`);
    return t;
  }

  /**
   * `git grep` no commit. Devolve [{ path, line, text }].
   * @param {string} pattern expressão regular estendida (ERE)
   */
  async grep(pattern, { ignoreCase = false, limit = 200, paths = [] } = {}) {
    const args = ['grep', '-n', '-I', '-E', '--no-color', '--full-name'];
    if (ignoreCase) args.push('-i');
    args.push('-e', pattern, this.sha, '--', ...paths);
    let out;
    try {
      out = await git(this.root, args);
    } catch (err) {
      // Código 1 = nenhum resultado.
      if (err instanceof GitError && !err.stderr.trim()) return [];
      throw err;
    }
    const prefix = `${this.sha}:`;
    const results = [];
    for (const raw of out.split('\n')) {
      if (!raw.startsWith(prefix)) continue;
      const rest = raw.slice(prefix.length);
      const m = /^(.*?):(\d+):(.*)$/.exec(rest);
      if (!m) continue;
      results.push({ path: m[1], line: Number(m[2]), text: m[3] });
      if (results.length >= limit) break;
    }
    return results;
  }
}

/** Os dois commits de um review (ponto de saída da branch e ponta da branch). */
export class ReviewRepo {
  #reader;
  #snapshots = new Map();

  constructor(root) {
    this.root = root;
    this.#reader = new BlobReader(root);
  }

  /** @returns {Snapshot} */
  snapshot(sha) {
    if (!this.#snapshots.has(sha)) this.#snapshots.set(sha, new Snapshot(this.root, sha, this.#reader));
    return this.#snapshots.get(sha);
  }

  close() {
    this.#reader.close();
  }
}
