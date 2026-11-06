import { langFor } from './languages.js';

/**
 * Realce de sintaxe por linha. A tokenização roda num Web Worker (highlight.worker.js);
 * aqui ficam a fila de pedidos e um cache pequeno.
 *
 * Cada linha vira { text, parts: [[conteúdo, estilo], ...] }. Quem renderiza confere
 * `text === conteúdo da linha` antes de usar, e cai para texto puro se não bater.
 */

/** Arquivos maiores que isso ficam sem cores (o diff continua normal). */
const MAX_CHARS = 400_000;
const MAX_LINES = 10_000;
const CACHE_SIZE = 120;

let worker = null;
let disabled = false;
let seq = 0;
const pending = new Map();
const cache = new Map();

function getWorker() {
  if (worker || disabled) return worker;
  try {
    worker = new Worker(new URL('./highlight.worker.js', import.meta.url), { type: 'module' });
  } catch {
    disabled = true;
    return null;
  }
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    job.resolve(e.data.error ? null : e.data.lines);
  };
  worker.onerror = () => {
    // Sem worker (navegador antigo, erro ao carregar): segue sem cores.
    disabled = true;
    for (const job of pending.values()) job.resolve(null);
    pending.clear();
  };
  return worker;
}

function hash(s) {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Tokens de um arquivo, por linha (índice 0 = linha 1), ou null quando não houver realce.
 * @param {string} path usado para descobrir a linguagem
 * @param {string} code
 * @returns {Promise<Array<{ text: string, parts: Array<[string, string]> }> | null>}
 */
export async function highlight(path, code) {
  const lang = langFor(path);
  if (!lang || !code || code.length > MAX_CHARS) return null;
  const key = `${lang}:${code.length}:${hash(code)}`;
  if (cache.has(key)) return cache.get(key);

  const w = getWorker();
  if (!w) return null;
  const lineCount = code.split('\n', MAX_LINES + 1).length;
  if (lineCount > MAX_LINES) return null;

  const promise = new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve });
    w.postMessage({ id, lang, code });
  }).then((lines) => lines && lines.map((parts) => ({ text: parts.map((p) => p[0]).join(''), parts })));

  cache.set(key, promise);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return promise;
}

/** Partes de uma linha, só se os tokens correspondem exatamente ao conteúdo exibido. */
export function partsFor(lines, lineNo, content) {
  const line = lines?.[lineNo - 1];
  return line && line.text === content ? line.parts : null;
}
