import { computed, reactive, watch } from 'vue';
import { GROUP_LABELS, orderFlow } from '../../src/shared/flow-order.js';
import { api } from './api.js';
import { buildTree, flattenTree } from './lib/tree.js';

/** @typedef {import('../../src/shared/types.js').DiffFile} DiffFile */

/**
 * Comentário sendo escrito (ainda não salvo).
 * @typedef {{ path: string, side: 'old' | 'new', startLine: number, endLine: number, snippet: string }} Draft
 */

/** Diffs com mais linhas alteradas que isso começam recolhidos, como no GitHub. */
const BIG_DIFF = 1500;

const pref = (key, fallback, allowed) => {
  const v = localStorage.getItem(`zgdiff.${key}`);
  return v !== null && (!allowed || allowed.includes(v)) ? v : fallback;
};

export const store = reactive({
  loading: true,
  error: '',
  review: null,
  state: { viewed: {}, comments: [] },
  storePath: '',
  collapsed: new Set(),
  closedDirs: new Set(),
  /** 'split' | 'unified' */
  viewMode: pref('viewMode', 'split', ['split', 'unified']),
  /** 'flow' | 'tree' | 'list' */
  listMode: pref('listMode', 'flow', ['flow', 'tree', 'list']),
  /** Testes no Fluxo: 'together' (logo depois do arquivo testado) | 'end' */
  testsPlacement: pref('testsPlacement', 'together', ['together', 'end']),
  /** @type {import('../../src/shared/flow-order.js').FlowInfo | null} */
  flow: null,
  flowError: '',
  /** Ordem sugerida pela IA e aceita por você: { paths, rationale } */
  aiOrder: null,
  /** 'auto' (calculada) | 'ai' (sugerida pela IA) */
  flowSource: 'auto',
  /** Arquivo no topo da área de leitura (para n/p/v e destaque no painel). */
  currentPath: null,
  /** @type {Draft | null} */
  draft: null,
  toast: '',
});

for (const key of ['viewMode', 'listMode', 'testsPlacement']) {
  watch(
    () => store[key],
    (v) => localStorage.setItem(`zgdiff.${key}`, v),
  );
}

export const tree = computed(() => buildTree(store.review?.files ?? []));

export const flowByPath = computed(() => new Map((store.flow?.files ?? []).map((f) => [f.path, f])));

/** Passos do modo Fluxo (calculado ou da IA), com grupo e número. */
export const flowSteps = computed(() => {
  if (store.flowSource === 'ai' && store.aiOrder) {
    return store.aiOrder.paths.map((path, k) => ({ path, group: 'ai', step: k + 1, nested: false }));
  }
  if (!store.flow) return [];
  return orderFlow(store.flow, { tests: store.testsPlacement });
});

export const groupLabel = (group) => (group === 'ai' ? 'Ordem sugerida pela IA' : GROUP_LABELS[group] ?? group);

/** Ordem do painel principal: segue o modo do painel lateral. */
export const orderedFiles = computed(() => {
  const files = store.review?.files ?? [];
  if (store.listMode === 'flow' && flowSteps.value.length) {
    const byPath = new Map(files.map((f) => [f.path, f]));
    const ordered = flowSteps.value.map((s) => byPath.get(s.path)).filter(Boolean);
    // Garante que nenhum arquivo suma, mesmo se a ordem da IA estiver incompleta.
    const seen = new Set(ordered.map((f) => f.path));
    return [...ordered, ...files.filter((f) => !seen.has(f.path))];
  }
  if (store.listMode === 'tree') return flattenTree(tree.value);
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
});

export const commentsByFile = computed(() => {
  const map = new Map();
  for (const c of store.state.comments) map.set(c.path, [...(map.get(c.path) ?? []), c]);
  return map;
});

export const viewedCount = computed(() => (store.review?.files ?? []).filter(isViewed).length);

/** @param {DiffFile} file */
export function isViewed(file) {
  return store.state.viewed[file.path] === file.patchHash;
}

/** Marcado como visto antes, mas o arquivo mudou na branch desde então. */
export function changedSinceViewed(file) {
  const h = store.state.viewed[file.path];
  return h !== undefined && h !== file.patchHash;
}

export async function load() {
  store.loading = true;
  store.error = '';
  try {
    const data = await api.review();
    store.review = data.review;
    store.state = data.state;
    store.storePath = data.storePath;
    store.collapsed = new Set(data.review.files.filter((f) => isViewed(f) || f.additions + f.deletions > BIG_DIFF).map((f) => f.path));
    loadFlow();
  } catch (err) {
    store.error = err.message;
  } finally {
    store.loading = false;
  }
}

async function loadFlow() {
  store.flowError = '';
  try {
    store.flow = await api.flow();
  } catch (err) {
    store.flowError = err.message;
  }
}

export function flash(message) {
  store.toast = message;
  setTimeout(() => {
    if (store.toast === message) store.toast = '';
  }, 3500);
}

/** Executa uma chamada à API mostrando o erro no toast; devolve undefined se falhar. */
export async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    flash(err.message);
    return undefined;
  }
}

export function toggleCollapsed(path) {
  if (store.collapsed.has(path)) store.collapsed.delete(path);
  else store.collapsed.add(path);
}

export function collapseAll() {
  store.collapsed = new Set((store.review?.files ?? []).map((f) => f.path));
}

export function expandAll() {
  store.collapsed = new Set();
}

export async function setViewed(file, viewed) {
  const res = await guarded(() => api.setViewed(file.path, viewed));
  if (!res) return false;
  store.state.viewed = res.state.viewed;
  // Igual ao GitHub: marcar como visto recolhe; desmarcar abre.
  if (viewed) store.collapsed.add(file.path);
  else store.collapsed.delete(file.path);
  return true;
}

export async function saveDraft(body) {
  const draft = store.draft;
  if (!draft) return false;
  const comment = await guarded(() => api.addComment({ ...draft, body }));
  if (!comment) return false;
  store.state.comments.push(comment);
  store.draft = null;
  return true;
}

export async function addComment(input) {
  const comment = await guarded(() => api.addComment(input));
  if (comment) store.state.comments.push(comment);
  return comment;
}

export async function updateComment(id, body) {
  const updated = await guarded(() => api.updateComment(id, body));
  if (!updated) return false;
  const k = store.state.comments.findIndex((c) => c.id === id);
  if (k >= 0) store.state.comments[k] = updated;
  return true;
}

export async function deleteComment(id) {
  const ok = await guarded(async () => {
    await api.deleteComment(id);
    return true;
  });
  if (ok) store.state.comments = store.state.comments.filter((c) => c.id !== id);
}

export function fileDomId(path) {
  return `file-${encodeURIComponent(path)}`;
}

export function scrollToFile(path, behavior = 'smooth') {
  document.getElementById(fileDomId(path))?.scrollIntoView({ behavior, block: 'start' });
}

// ---------- Navegação entre arquivos (n / p / v) ----------

function neighbor(delta) {
  const files = orderedFiles.value;
  if (!files.length) return null;
  const k = files.findIndex((f) => f.path === store.currentPath);
  if (k === -1) return files[delta > 0 ? 0 : files.length - 1];
  return files[Math.max(0, Math.min(files.length - 1, k + delta))];
}

export function goNext() {
  const f = neighbor(1);
  if (f) scrollToFile(f.path);
}

export function goPrev() {
  const f = neighbor(-1);
  if (f) scrollToFile(f.path);
}

/** Próximo arquivo ainda não visto, a partir do atual (na ordem do painel). */
export function goNextUnviewed() {
  const files = orderedFiles.value;
  const k = Math.max(0, files.findIndex((f) => f.path === store.currentPath));
  const next = [...files.slice(k + 1), ...files.slice(0, k + 1)].find((f) => !isViewed(f));
  if (!next) {
    flash('Todos os arquivos foram vistos. ✓');
    return;
  }
  store.collapsed.delete(next.path);
  scrollToFile(next.path);
}

/** `v`: marca o arquivo atual como visto e vai para o próximo não visto. */
export async function toggleCurrentViewed() {
  const file = store.review?.files.find((f) => f.path === store.currentPath);
  if (!file) return;
  const viewed = !isViewed(file);
  if ((await setViewed(file, viewed)) && viewed) goNextUnviewed();
}

/** Usa a ordem sugerida pela IA no modo Fluxo. */
export function useAiOrder(paths, rationale) {
  store.aiOrder = { paths, rationale };
  store.flowSource = 'ai';
  store.listMode = 'flow';
}
