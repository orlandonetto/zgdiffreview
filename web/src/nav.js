import { computed, reactive } from 'vue';
import { api } from './api.js';
import { askAssistant, chatConfig } from './chat.js';
import { flash, store } from './store.js';

/**
 * "Ir para a definição" (⌘/Ctrl+clique), visualizador de arquivo e Voltar/Avançar.
 *
 * O histórico de navegação usa o History API do navegador: cada salto vira uma entrada
 * (pushState), então os botões voltar/avançar do mouse, ⌘[ / ⌘] e Alt+← / Alt+→ funcionam
 * como no VS Code. Cada entrada guarda o lugar exato (arquivo, lado e linha), e "Voltar"
 * leva ao ponto onde você clicou, com a linha destacada.
 *
 * @typedef {{ kind: 'line' | 'viewer', path: string, side: 'old' | 'new', line: number }} LineEntry
 * @typedef {{ kind: 'scroll', top: number }} ScrollEntry
 */

export const nav = reactive({
  /** Arquivo aberto no visualizador: { side, path, line, lines, loading, error } */
  viewer: null,
  /** Pedido para um FileDiff mostrar uma linha: { filePath, side, line, nonce } */
  reveal: null,
  /** Linha destacada por alguns segundos depois de navegar: { filePath, side, line } */
  highlight: null,
  /** Lista de candidatos quando há mais de uma definição. */
  picker: null,
  /** "Não encontrei" com opção de perguntar à IA. */
  notFound: null,
  /** @type {Array<LineEntry | ScrollEntry>} */
  entries: [{ kind: 'scroll', top: 0 }],
  index: 0,
  busy: false,
});

export const canGoBack = computed(() => nav.index > 0);
export const canGoForward = computed(() => nav.index < nav.entries.length - 1);

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** ⌘ no Mac (Ctrl+clique no Mac é o menu de contexto); Ctrl no Windows/Linux. */
export const isModClick = (e) => (IS_MAC ? e.metaKey : e.ctrlKey);
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';
export const BACK_LABEL = IS_MAC ? '⌃− ou ⌘[' : 'Alt+←';
export const FORWARD_LABEL = IS_MAC ? '⌃⇧− ou ⌘]' : 'Alt+→';

const contentEl = () => document.querySelector('.content');

/** Onde você está agora, quando não há um ponto de clique (ex.: link do chat). */
function currentPosition() {
  if (nav.viewer) return { kind: 'viewer', side: nav.viewer.side, path: nav.viewer.path, line: nav.viewer.line };
  return { kind: 'scroll', top: contentEl()?.scrollTop ?? 0 };
}

/** Arquivo do diff que corresponde a (side, path), considerando renomeações. */
function diffFileFor(side, path) {
  return store.review?.files.find((f) => (side === 'old' ? f.oldPath === path : f.newPath === path)) ?? null;
}

// ---------- Histórico (Voltar / Avançar) ----------

/** Liga o histórico ao navegador. Chamar uma vez. */
export function installHistory() {
  history.replaceState({ ...history.state, zgdiff: 0 }, '');
  window.addEventListener('popstate', (e) => {
    const k = e.state?.zgdiff;
    // Entradas de antes de recarregar a página não valem mais.
    if (typeof k !== 'number' || !nav.entries[k]) return;
    nav.index = k;
    restore(nav.entries[k]);
  });
  // Os botões voltar/avançar do mouse já disparam o histórico do navegador (popstate).
}

export function back() {
  if (canGoBack.value) history.back();
}

export function forward() {
  if (canGoForward.value) history.forward();
}

/** Mostra uma entrada do histórico sem criar outra. */
function restore(entry) {
  nav.picker = null;
  nav.notFound = null;
  if (entry.kind === 'scroll') {
    nav.viewer = null;
    requestAnimationFrame(() => contentEl()?.scrollTo({ top: entry.top }));
  } else {
    show(entry);
  }
}

/** Leva até a linha: no diff (rola, expande, destaca) ou no visualizador. */
function show(loc) {
  const file = loc.kind === 'viewer' ? null : diffFileFor(loc.side, loc.path);
  if (file && (file.hunks.length || file.binary)) {
    nav.viewer = null;
    store.collapsed.delete(file.path);
    nav.reveal = { filePath: file.path, side: loc.side, line: loc.line, nonce: Date.now() };
  } else {
    openViewer(loc.side, loc.path, loc.line);
  }
}

/**
 * Vai até um local, guardando de onde você saiu para poder voltar.
 * @param {{ path: string, side: 'old' | 'new', line: number }} loc destino
 * @param {LineEntry} [origin] ponto do clique (sem isso, guarda a posição atual da tela)
 */
export function navigate(loc, origin) {
  nav.entries[nav.index] = origin ?? currentPosition();
  const file = diffFileFor(loc.side, loc.path);
  const target = { kind: file && (file.hunks.length || file.binary) ? 'line' : 'viewer', path: loc.path, side: loc.side, line: loc.line };
  nav.entries.splice(nav.index + 1);
  nav.entries.push(target);
  nav.index = nav.entries.length - 1;
  history.pushState({ ...history.state, zgdiff: nav.index }, '');
  restore(target);
}

export async function openViewer(side, path, line = 1) {
  if (nav.viewer && nav.viewer.side === side && nav.viewer.path === path && !nav.viewer.error) {
    nav.viewer.line = line;
    return;
  }
  nav.viewer = { side, path, line, lines: [], loading: true, error: '' };
  try {
    const data = await api.blob(side, path);
    if (nav.viewer?.path !== path || nav.viewer.side !== side) return;
    nav.viewer.lines = data.lines;
  } catch (err) {
    if (nav.viewer) nav.viewer.error = err.message;
  } finally {
    if (nav.viewer?.path === path) nav.viewer.loading = false;
  }
}

export function closeViewer() {
  nav.viewer = null;
}

/** Destaca a linha de destino por alguns segundos. */
export function highlightLine(filePath, side, line) {
  const h = { filePath, side, line };
  nav.highlight = h;
  setTimeout(() => {
    if (nav.highlight === h) nav.highlight = null;
  }, 2500);
}

// ---------- Ir para a definição ----------

/**
 * Cascata: TypeScript → heurística (no servidor) → IA (aqui, com confirmação).
 * @param {{ side: 'old' | 'new', path: string, line: number, col: number, lineText: string, inViewer: boolean }} at
 * @param {{ x: number, y: number }} point posição do clique (para a lista de candidatos)
 */
export async function goToDefinition(at, point) {
  if (nav.busy) return;
  nav.busy = true;
  nav.picker = null;
  nav.notFound = null;
  const origin = { kind: at.inViewer ? 'viewer' : 'line', path: at.path, side: at.side, line: at.line };
  try {
    const r = await api.definition(at);
    if (!r.symbol) return;
    const candidates = r.candidates.filter((c) => !(c.path === at.path && c.line === at.line));
    if (candidates.length === 1) {
      navigate({ path: candidates[0].path, side: at.side, line: candidates[0].line }, origin);
      flash(`${r.symbol.name}: ${r.method === 'typescript' ? 'via análise do código' : 'via busca'}`);
    } else if (candidates.length > 1) {
      nav.picker = { symbol: r.symbol.name, method: r.method, side: at.side, origin, candidates, x: point.x, y: point.y };
    } else if (r.candidates.length) {
      flash(`Você já está na definição de ${r.symbol.name}.`);
    } else {
      const question = definitionQuestion(r.symbol.name, at);
      if (chatConfig.autoDefinitionFallback) askAssistant(question.text, question.context);
      else nav.notFound = { symbol: r.symbol.name, question, x: point.x, y: point.y };
    }
  } catch (err) {
    flash(err.message);
  } finally {
    nav.busy = false;
  }
}

/** Escolha na lista de candidatos (guarda o ponto do clique original para voltar). */
export function pickCandidate(c) {
  const p = nav.picker;
  if (!p) return;
  navigate({ path: c.path, side: p.side, line: c.line }, p.origin);
}

function definitionQuestion(symbol, at) {
  return {
    text: `Onde está definido \`${symbol}\`, usado em ${at.path}:${at.line} (${at.side === 'old' ? 'versão antiga' : 'versão nova'})? Use find_definition e search_code, e mostre o local com show_location.`,
    context: { path: at.path, side: at.side, startLine: at.line, endLine: at.line, snippet: at.lineText },
  };
}

export function askAiForDefinition() {
  const nf = nav.notFound;
  if (!nf) return;
  nav.notFound = null;
  askAssistant(nf.question.text, nf.question.context);
}

// ---------- Sublinhado ao segurar ⌘/Ctrl e clique ----------

const ID_CHAR = /[\p{L}\p{N}_$]/u;

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** Nós de texto da linha (com realce, o texto fica dividido em vários spans). */
function textNodes(root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
}

/** Converte uma posição no texto da linha em (nó, deslocamento). */
function pointAt(nodes, pos) {
  let acc = 0;
  for (const n of nodes) {
    if (pos <= acc + n.data.length) return { node: n, offset: pos - acc };
    acc += n.data.length;
  }
  const last = nodes[nodes.length - 1];
  return { node: last, offset: last.data.length };
}

/**
 * Palavra sob o mouse dentro de uma célula de código marcada com data-def-*.
 * @returns {{ cell: HTMLElement, col: number, text: string, rect: DOMRect } | null}
 */
function wordAt(x, y) {
  const caret = caretAt(x, y);
  if (!caret || caret.node?.nodeType !== Node.TEXT_NODE) return null;
  const lineEl = caret.node.parentElement?.closest('.text');
  if (!lineEl) return null;
  const cell = lineEl.closest('[data-def-path]');
  if (!cell) return null;

  const nodes = textNodes(lineEl);
  let col = 0;
  for (const n of nodes) {
    if (n === caret.node) break;
    col += n.data.length;
  }
  col += caret.offset;
  const text = lineEl.textContent;

  let c = col;
  if (!ID_CHAR.test(text[c] ?? '') && ID_CHAR.test(text[c - 1] ?? '')) c -= 1;
  if (!ID_CHAR.test(text[c] ?? '')) return null;
  let start = c;
  let end = c + 1;
  while (start > 0 && ID_CHAR.test(text[start - 1])) start--;
  while (end < text.length && ID_CHAR.test(text[end])) end++;
  if (/^\p{N}/u.test(text.slice(start, end))) return null;

  const a = pointAt(nodes, start);
  const b = pointAt(nodes, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const rect = range.getBoundingClientRect();
  // Confere se o mouse está mesmo sobre a palavra (e não no espaço depois do fim da linha).
  if (x < rect.left - 1 || x > rect.right + 1 || y < rect.top - 1 || y > rect.bottom + 1) return null;
  return { cell, col: start, text, rect };
}

let underline = null;

function showUnderline(rect) {
  if (!underline) {
    underline = document.createElement('div');
    underline.className = 'def-underline';
    document.body.appendChild(underline);
  }
  underline.style.left = `${rect.left}px`;
  underline.style.top = `${rect.bottom - 2}px`;
  underline.style.width = `${rect.width}px`;
  underline.style.display = 'block';
  document.body.classList.add('def-hover');
}

function hideUnderline() {
  if (underline) underline.style.display = 'none';
  document.body.classList.remove('def-hover');
}

/** Liga os eventos globais de ⌘/Ctrl+clique. Chamar uma vez. */
export function installDefinitionClicks() {
  let lastMouse = null;
  const refresh = (e) => {
    if (!lastMouse || !isModClick(e)) return hideUnderline();
    const w = wordAt(lastMouse.x, lastMouse.y);
    if (w) showUnderline(w.rect);
    else hideUnderline();
  };
  window.addEventListener('mousemove', (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    refresh(e);
  });
  window.addEventListener('keydown', (e) => refresh(e));
  window.addEventListener('keyup', (e) => refresh(e));
  window.addEventListener('blur', hideUnderline);
  window.addEventListener('scroll', hideUnderline, true);

  // Impede seleção de texto e o início de comentário no clique com a tecla.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 0 && isModClick(e) && wordAt(e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  window.addEventListener(
    'click',
    (e) => {
      if (e.button !== 0 || !isModClick(e)) return;
      const w = wordAt(e.clientX, e.clientY);
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      hideUnderline();
      const { defPath, defSide, defLine } = w.cell.dataset;
      goToDefinition(
        { side: defSide, path: defPath, line: Number(defLine), col: w.col, lineText: w.text, inViewer: !!w.cell.closest('.viewer') },
        { x: e.clientX, y: e.clientY },
      );
    },
    true,
  );
}
