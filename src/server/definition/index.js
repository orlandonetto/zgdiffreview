import { readRepoConfig } from '../flow/index.js';
import { isCodeFile } from '../flow/imports.js';
import { createResolver } from '../flow/resolve.js';
import { findDefinitionHeuristic, findImportBinding } from './heuristic.js';
import { identifierAt } from './symbol.js';
import { TsProject } from './ts-service.js';

/** @typedef {import('../repo.js').Snapshot} Snapshot */

/**
 * @typedef {object} DefinitionResult
 * @property {{ name: string, receiver: string | null } | null} symbol
 * @property {'typescript' | 'heuristic' | null} method nível da cascata que encontrou
 * @property {Array<{ path: string, line: number, col?: number, text: string }>} candidates
 */

/**
 * Cascata de "ir para a definição": language service do TypeScript → heurística.
 * (O terceiro nível, a IA, é acionado pela interface pelo chat.)
 */
export class DefinitionFinder {
  #projects = new Map();
  #resolvers = new Map();

  /** Começa a montar o projeto TypeScript em segundo plano, para o primeiro clique ser rápido. */
  warmUp(snap) {
    this.#project(snap)
      .ready()
      .catch(() => undefined);
  }

  #project(snap) {
    if (!this.#projects.has(snap.sha)) this.#projects.set(snap.sha, new TsProject(snap));
    return this.#projects.get(snap.sha);
  }

  async #resolver(snap) {
    if (!this.#resolvers.has(snap.sha)) {
      this.#resolvers.set(
        snap.sha,
        (async () => createResolver(await snap.files(), (await readRepoConfig(snap)).aliases))(),
      );
    }
    return this.#resolvers.get(snap.sha);
  }

  /**
   * @param {Snapshot} snap versão (base ou branch) onde o clique aconteceu
   * @param {string} path
   * @param {number} line 1-based
   * @param {number} col 0-based
   * @returns {Promise<DefinitionResult>}
   */
  async find(snap, path, line, col) {
    const source = await snap.requireText(path);
    const lines = source.split('\n');
    const text = lines[line - 1] ?? '';
    const symbol = identifierAt(text, col);
    if (!symbol) return { symbol: null, method: null, candidates: [] };
    const preview = async (p, ln) => ((await snap.text(p)) ?? '').split('\n')[ln - 1] ?? '';

    // 1) TypeScript
    let tsResult = [];
    if (isCodeFile(path)) {
      try {
        tsResult = (await this.#project(snap).definitionAt(path, line, symbol.start)) ?? [];
      } catch {
        tsResult = [];
      }
    }
    // Quando o TS não consegue resolver o módulo, ele para na própria linha do import:
    // nesse caso vale tentar a heurística antes de aceitar.
    const stuckOnImport =
      tsResult.length > 0 &&
      tsResult.every((d) => d.path === path) &&
      tsResult.every((d) => /\bimport\b|\brequire\s*\(/.test(lines[d.line - 1] ?? '')) &&
      findImportBinding(source, symbol.name) !== null;
    if (tsResult.length && !stuckOnImport) {
      return {
        symbol,
        method: 'typescript',
        candidates: await Promise.all(tsResult.map(async (d) => ({ ...d, text: await preview(d.path, d.line) }))),
      };
    }

    // 2) Heurística
    const resolve = await this.#resolver(snap);
    const found = await findDefinitionHeuristic({ snap, path, line, symbol, resolve });
    const useful = found.filter((f) => !(f.path === path && f.line === line) || found.length === 1);
    if (useful.length) return { symbol, method: 'heuristic', candidates: useful };

    if (tsResult.length) {
      return {
        symbol,
        method: 'typescript',
        candidates: await Promise.all(tsResult.map(async (d) => ({ ...d, text: await preview(d.path, d.line) }))),
      };
    }
    return { symbol, method: null, candidates: [] };
  }
}
