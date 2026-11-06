import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { NotFoundError } from './errors.js';

/** @typedef {import('../shared/types.js').ReviewState} ReviewState */
/** @typedef {import('../shared/types.js').ReviewComment} ReviewComment */

/**
 * Estado do review (arquivos vistos e comentários) salvo em
 * ~/.zgdiff/reviews/<repo>__<branch>__<base>__<hash>.json,
 * para reaparecer quando o mesmo review for aberto de novo.
 */
export class ReviewStore {
  /** @type {ReviewState} */
  #state = { viewed: {}, comments: [] };
  #writing = Promise.resolve();
  #file;

  constructor(repoRoot, repoName, head, base) {
    const dir = process.env.ZGDIFF_HOME ?? join(homedir(), '.zgdiff');
    const hash = createHash('sha1').update(`${repoRoot}\0${head}\0${base}`).digest('hex').slice(0, 10);
    const safe = (s) => s.replace(/[^\w.-]+/g, '-');
    this.#file = join(dir, 'reviews', `${safe(repoName)}__${safe(head)}__${safe(base)}__${hash}.json`);
  }

  get path() {
    return this.#file;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#file, 'utf8'));
      this.#state = { viewed: parsed.viewed ?? {}, comments: parsed.comments ?? [] };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /** @returns {ReviewState} */
  get() {
    return this.#state;
  }

  async setViewed(path, patchHash) {
    if (patchHash) this.#state.viewed[path] = patchHash;
    else delete this.#state.viewed[path];
    await this.#save();
  }

  /** @returns {Promise<ReviewComment>} */
  async addComment(input) {
    const now = new Date().toISOString();
    const comment = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.#state.comments.push(comment);
    await this.#save();
    return comment;
  }

  async updateComment(id, body) {
    const comment = this.#state.comments.find((c) => c.id === id);
    if (!comment) throw new NotFoundError('Comentário não encontrado.');
    comment.body = body;
    comment.updatedAt = new Date().toISOString();
    await this.#save();
    return comment;
  }

  async deleteComment(id) {
    const before = this.#state.comments.length;
    this.#state.comments = this.#state.comments.filter((c) => c.id !== id);
    if (this.#state.comments.length === before) throw new NotFoundError('Comentário não encontrado.');
    await this.#save();
  }

  /** Grava em fila (uma escrita por vez) e de forma atômica (arquivo temporário + rename). */
  #save() {
    const snapshot = JSON.stringify(this.#state, null, 2);
    const file = this.#file;
    const next = this.#writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, file);
    });
    // Uma escrita que falhou não pode travar as próximas; o erro volta para quem chamou.
    this.#writing = next.catch(() => undefined);
    return next;
  }
}
