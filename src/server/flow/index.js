import { classifyKind } from './kind.js';
import { layerOf, testTarget } from './classify.js';
import { findEntries } from './entries.js';
import { extractImports, isCodeFile } from './imports.js';
import { createResolver } from './resolve.js';

/** @typedef {import('../repo.js').Snapshot} Snapshot */
/** @typedef {import('../../shared/types.js').ReviewInfo} ReviewInfo */
/** @typedef {import('../../shared/flow-order.js').FlowInfo} FlowInfo */

/** Limite de arquivos percorridos no grafo, para repositórios muito grandes. */
const MAX_VISITED = 6000;

/**
 * Grafo de imports alcançável a partir das entradas: profundidade e "pai" de cada arquivo.
 *
 * @param {Snapshot} snap
 * @param {string[]} entries
 * @param {(from: string, spec: string) => string | null} resolve
 */
export async function walkImports(snap, entries, resolve) {
  const depth = new Map();
  const parent = new Map();
  let frontier = [];
  for (const e of entries) {
    if (!depth.has(e)) {
      depth.set(e, 0);
      frontier.push(e);
    }
  }
  while (frontier.length && depth.size < MAX_VISITED) {
    const next = [];
    // Lê um nível inteiro em paralelo (o leitor de blobs serializa por baixo).
    const sources = await Promise.all(frontier.map((f) => snap.text(f)));
    frontier.forEach((file, k) => {
      const src = sources[k];
      if (!src) return;
      for (const spec of extractImports(src)) {
        const target = resolve(file, spec);
        if (!target || depth.has(target) || !isCodeFile(target)) continue;
        depth.set(target, depth.get(file) + 1);
        parent.set(target, file);
        next.push(target);
      }
    });
    frontier = next;
  }
  return { depth, parent };
}

function chainOf(parent, path) {
  const chain = [path];
  let cur = path;
  while (parent.has(cur)) {
    cur = parent.get(cur);
    chain.unshift(cur);
  }
  return chain;
}

/**
 * Lê o .zgdiff.json da raiz do commit (opcional). Campos desconhecidos são ignorados.
 * @returns {Promise<{ entry: string[], aliases: Record<string, string>, layers: string[] | null }>}
 */
export async function readRepoConfig(snap) {
  const empty = { entry: [], aliases: {}, layers: null };
  const raw = await snap.text('.zgdiff.json');
  if (!raw) return empty;
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    return empty;
  }
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const aliases = {};
  if (cfg.aliases && typeof cfg.aliases === 'object') {
    for (const [k, v] of Object.entries(cfg.aliases)) if (typeof v === 'string') aliases[k] = v;
  }
  const layers = strings(cfg.layers);
  return { entry: strings(cfg.entry), aliases, layers: layers.length ? layers : null };
}

/** Converte a lista de camadas do .zgdiff.json (nomes de pasta, na ordem) no formato interno. */
function customLayers(names) {
  return names.map((n) => ({ id: n, label: n, names: [n] }));
}

/**
 * Calcula as informações do modo Fluxo para os arquivos alterados.
 *
 * @param {ReviewInfo} review
 * @param {Snapshot} head ponta da branch
 * @param {Snapshot} base ponto de saída (para arquivos removidos)
 * @returns {Promise<FlowInfo>}
 */
export async function computeFlow(review, head, base) {
  const cfg = await readRepoConfig(head);
  const layers = cfg.layers ? customLayers(cfg.layers) : undefined;

  const headFiles = await head.files();
  const entries = await findEntries(headFiles, (p) => head.text(p), cfg.entry);
  const walkHead = await walkImports(head, entries, createResolver(headFiles, cfg.aliases));

  // Arquivos removidos só existem na base: calcula a posição deles lá.
  let walkBase = null;
  if (review.files.some((f) => f.status === 'deleted' && isCodeFile(f.path))) {
    const baseFiles = await base.files();
    const baseEntries = await findEntries(baseFiles, (p) => base.text(p), cfg.entry);
    walkBase = await walkImports(base, baseEntries, createResolver(baseFiles, cfg.aliases));
  }

  const changedCode = review.files.filter((f) => classifyKind(f.path) === 'code').map((f) => f.path);
  const files = review.files.map((f) => {
    const kind = classifyKind(f.path);
    const walk = f.status === 'deleted' ? walkBase : walkHead;
    const depth = kind === 'code' && walk?.depth.has(f.path) ? walk.depth.get(f.path) : null;
    return {
      path: f.path,
      kind,
      depth,
      chain: depth === null ? [] : chainOf(walk.parent, f.path),
      layer: layerOf(f.path, layers),
      testOf: kind === 'test' ? testTarget(f.path, changedCode) : null,
    };
  });

  return { method: entries.length ? 'imports' : 'layers', entries, files };
}
