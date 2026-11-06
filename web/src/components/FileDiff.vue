<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { anchorOf, buildRows, EXPAND_STEP, expandGap, hasGaps, rowHas, snippetFor, toSplitRows } from '../lib/rows.js';
import {
  changedSinceViewed,
  commentsByFile,
  flowByPath,
  flowSteps,
  fileDomId,
  flash,
  isViewed,
  saveDraft,
  setViewed,
  store,
  scrollToFile,
  toggleCollapsed,
} from '../store.js';
import { askAboutSelection } from '../chat.js';
import { highlightLine, nav, navigate } from '../nav.js';
import CommentCard from './CommentCard.vue';
import CommentForm from './CommentForm.vue';
import CodeText from './CodeText.js';
import { highlight, partsFor } from '../lib/highlight.js';

/** @typedef {import('../lib/rows.js').GapRow} GapRow */
/** @typedef {import('../store.js').Draft} Draft */

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../src/shared/types.js').DiffFile>} */
  file: { type: Object, required: true },
});

const gapStates = ref([]);
const newLines = ref(null);
const loadingContent = ref(false);
const wholeFile = ref(false);

const rows = computed(() => buildRows(props.file, gapStates.value, newLines.value));
const splitRows = computed(() => toSplitRows(rows.value));
const isSplit = computed(() => store.viewMode === 'split');
const displayRows = computed(() => (isSplit.value ? splitRows.value : rows.value));
const colspan = computed(() => (isSplit.value ? 4 : 3));

const collapsed = computed(() => store.collapsed.has(props.file.path));
const viewed = computed(() => isViewed(props.file));
const comments = computed(() => commentsByFile.value.get(props.file.path) ?? []);
const expandable = computed(() => hasGaps(props.file));

const STATUS = {
  added: 'Novo',
  deleted: 'Removido',
  modified: 'Modificado',
  renamed: 'Renomeado',
  copied: 'Copiado',
};

// ---------- Comentários: em qual linha da tabela cada um aparece ----------

const placement = computed(() => {
  const byRow = new Map();
  const orphans = [];
  for (const c of comments.value) {
    const idx = displayRows.value.findIndex((r) => rowHas(r, c.side, c.endLine));
    if (idx === -1) orphans.push(c);
    else byRow.set(idx, [...(byRow.get(idx) ?? []), c]);
  }
  return { byRow, orphans };
});

const myDraft = computed(() => (store.draft?.path === props.file.path ? store.draft : null));
const draftRow = computed(() => {
  const d = myDraft.value;
  return d ? displayRows.value.findIndex((r) => rowHas(r, d.side, d.endLine)) : -1;
});

// ---------- Expansão de contexto ----------

async function ensureContent() {
  if (newLines.value) return true;
  loadingContent.value = true;
  try {
    newLines.value = await api.fileLines(props.file.path, 'new');
    return true;
  } catch (err) {
    flash(err.message);
    return false;
  } finally {
    loadingContent.value = false;
  }
}

/** @param {GapRow} gap @param {'up' | 'down' | 'all'} direction */
async function expand(gap, direction) {
  if (!(await ensureContent())) return;
  const next = [...gapStates.value];
  next[gap.index] = expandGap(next[gap.index] ?? { top: 0, bottom: 0 }, direction);
  gapStates.value = next;
}

async function toggleWholeFile() {
  if (wholeFile.value) {
    gapStates.value = [];
    wholeFile.value = false;
    return;
  }
  if (!(await ensureContent())) return;
  gapStates.value = Array.from({ length: props.file.hunks.length + 1 }, () => expandGap({ top: 0, bottom: 0 }, 'all'));
  wholeFile.value = true;
}

function gapLabel(gap) {
  if (gap.hidden === null) return 'Fim do arquivo';
  return `${gap.hidden} ${gap.hidden === 1 ? 'linha oculta' : 'linhas ocultas'}`;
}

// ---------- Seleção para comentar ----------

/** Arrastar pelos números de linha (como no GitHub): { side, anchor, current }. */
const drag = ref(null);
/** Lado onde começou a seleção de texto no modo lado a lado (o outro lado fica não selecionável). */
const selectSide = ref(null);
/** Botão flutuante "Comentar" que aparece depois de selecionar texto: { x, y, draft }. */
const floating = ref(null);

const activeRange = computed(() => {
  if (drag.value) {
    const { side, anchor, current } = drag.value;
    return { side, start: Math.min(anchor, current), end: Math.max(anchor, current) };
  }
  const d = myDraft.value;
  return d ? { side: d.side, start: d.startLine, end: d.endLine } : null;
});

function inRange(side, no) {
  const r = activeRange.value;
  return !!r && no !== undefined && r.side === side && no >= r.start && no <= r.end;
}

function lineSelected(row) {
  return inRange('old', row.type === 'del' ? row.oldNo : undefined) || inRange('new', row.newNo);
}

/** @returns {Draft} */
function makeDraft(side, start, end) {
  return { path: props.file.path, side, startLine: start, endLine: end, snippet: snippetFor(rows.value, side, start, end) };
}

function startDrag(side, no) {
  if (no === undefined) return;
  floating.value = null;
  drag.value = { side, anchor: no, current: no };
  window.addEventListener('mouseup', finishDrag, { once: true });
}

function moveDrag(side, no) {
  if (drag.value && no !== undefined && drag.value.side === side) drag.value.current = no;
}

function finishDrag() {
  const d = drag.value;
  drag.value = null;
  if (!d) return;
  store.draft = makeDraft(d.side, Math.min(d.anchor, d.current), Math.max(d.anchor, d.current));
}

function onCodeMouseDown(side) {
  selectSide.value = side;
  floating.value = null;
}

/** Depois de selecionar texto no código, oferece o botão "Comentar" para as linhas selecionadas. */
function onMouseUp(e) {
  if (drag.value) return;
  requestAnimationFrame(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return;
    const ia = rowIndexOf(sel.anchorNode);
    const ib = rowIndexOf(sel.focusNode);
    if (ia === null || ib === null) return;
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);

    let side;
    let nums;
    if (isSplit.value) {
      side = selectSide.value ?? 'new';
      nums = splitRows.value
        .slice(lo, hi + 1)
        .map((r) => (r.kind === 'split' ? (side === 'old' ? r.left : r.right)?.no : undefined))
        .filter((n) => n !== undefined);
    } else {
      const anchors = rows.value
        .slice(lo, hi + 1)
        .filter((r) => r.kind === 'line')
        .map(anchorOf);
      side = anchors.some((a) => a.side === 'new') ? 'new' : 'old';
      nums = anchors.filter((a) => a.side === side).map((a) => a.line);
    }
    if (!nums.length) return;
    floating.value = { x: e.clientX, y: e.clientY, draft: makeDraft(side, Math.min(...nums), Math.max(...nums)) };
  });
}

function rowIndexOf(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const tr = el?.closest('tr[data-row]');
  if (!tr || !tr.closest(`[id="${fileDomId(props.file.path)}"]`)) return null;
  return Number(tr.dataset.row);
}

function commentFromSelection() {
  if (!floating.value) return;
  store.draft = floating.value.draft;
  floating.value = null;
  window.getSelection()?.removeAllRanges();
}

const hideFloating = (e) => {
  if (!e.target?.closest?.('.floating-actions')) floating.value = null;
};
window.addEventListener('mousedown', hideFloating);
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', hideFloating);
  window.removeEventListener('mouseup', finishDrag);
});

function draftLabel(d) {
  const lines = d.startLine === d.endLine ? `linha ${d.startLine}` : `linhas ${d.startLine}–${d.endLine}`;
  return `Comentando ${lines} (${d.side === 'new' ? 'versão nova' : 'versão antiga'})`;
}

// ---------- Cabeçalho ----------

function onViewedChange(e) {
  setViewed(props.file, e.target.checked);
}

async function copyPath() {
  await navigator.clipboard.writeText(props.file.path);
  flash('Caminho copiado.');
}

const marker = (t) => (t === 'add' ? '+' : t === 'del' ? '-' : ' ');

// ---------- Realce de sintaxe ----------

const sectionEl = ref(null);
/** Já esteve perto da área visível (só então vale tokenizar). */
const nearView = ref(false);
const oldTokens = ref(null);
const newTokens = ref(null);
let observer = null;

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        nearView.value = true;
        observer?.disconnect();
        observer = null;
      }
    },
    { rootMargin: '800px 0px' },
  );
  if (sectionEl.value) observer.observe(sectionEl.value);
});
onBeforeUnmount(() => observer?.disconnect());

/**
 * Texto de um lado do arquivo para tokenizar: o arquivo inteiro quando já foi carregado
 * (lado novo), senão as linhas visíveis nas posições certas (o resto fica em branco).
 */
function sideText(side) {
  if (side === 'new' && newLines.value) return newLines.value.join('\n');
  const arr = [];
  for (const r of rows.value) {
    if (r.kind !== 'line') continue;
    const no = side === 'old' ? (r.type === 'add' ? undefined : r.oldNo) : r.type === 'del' ? undefined : r.newNo;
    if (no) arr[no - 1] = r.content;
  }
  for (let k = 0; k < arr.length; k++) if (arr[k] === undefined) arr[k] = '';
  return arr.join('\n');
}

let tokenRun = 0;
watch(
  () => (nearView.value && !collapsed.value && !props.file.binary ? [sideText('old'), sideText('new')] : null),
  async (texts) => {
    if (!texts) return;
    const run = ++tokenRun;
    const [oldText, newText] = texts;
    const [o, n] = await Promise.all([
      props.file.oldPath && oldText ? highlight(props.file.oldPath, oldText) : null,
      props.file.newPath && newText ? highlight(props.file.newPath, newText) : null,
    ]);
    if (run !== tokenRun) return;
    oldTokens.value = o;
    newTokens.value = n;
  },
  { immediate: true },
);

/** Partes coloridas de uma linha (ou null para texto puro). */
const partsOf = (side, no, content) => partsFor(side === 'old' ? oldTokens.value : newTokens.value, no, content);
const unifiedParts = (row) => (row.type === 'del' ? partsOf('old', row.oldNo, row.content) : partsOf('new', row.newNo, row.content));

// ---------- Fluxo: posição e "como se chega aqui" ----------

const step = computed(() => (store.listMode === 'flow' ? flowSteps.value.find((s) => s.path === props.file.path) : null));
const chain = computed(() => {
  const info = flowByPath.value.get(props.file.path);
  if (!info || info.chain.length < 2) return [];
  const changed = new Set(store.review.files.map((f) => f.path));
  return info.chain.map((p) => ({ path: p, name: p.split('/').pop(), changed: changed.has(p), self: p === props.file.path }));
});

function openChainItem(item) {
  if (item.self) return;
  if (item.changed) scrollToFile(item.path);
  else navigate({ path: item.path, side: 'new', line: 1 });
}

// ---------- Ir para a definição: atributos lidos pelo ⌘/Ctrl+clique ----------

/** Atributos data-def-* de uma célula de código (lado + caminho naquele lado + linha). */
function defAttrs(side, no) {
  const path = side === 'old' ? props.file.oldPath : props.file.newPath;
  if (!path || no === undefined) return {};
  return { 'data-def-path': path, 'data-def-side': side, 'data-def-line': no };
}

function unifiedDefAttrs(row) {
  return row.type === 'del' ? defAttrs('old', row.oldNo) : defAttrs('new', row.newNo);
}

const isFlash = (row) => {
  const h = nav.highlight;
  return !!h && h.filePath === props.file.path && rowHas(row, h.side, h.line);
};
const isFlashCell = (side, no) => {
  const h = nav.highlight;
  return !!h && h.filePath === props.file.path && h.side === side && h.line === no;
};

// Pedido de navegação para uma linha deste arquivo: expande o que for preciso, rola e destaca.
watch(
  () => nav.reveal,
  async (r) => {
    if (!r || r.filePath !== props.file.path) return;
    const find = () => displayRows.value.findIndex((row) => rowHas(row, r.side, r.line));
    let idx = find();
    if (idx === -1 && expandable.value) {
      if (!(await ensureContent())) return;
      gapStates.value = Array.from({ length: props.file.hunks.length + 1 }, () => expandGap({ top: 0, bottom: 0 }, 'all'));
      wholeFile.value = true;
      idx = find();
    }
    await nextTick();
    const section = document.getElementById(fileDomId(props.file.path));
    const el = idx === -1 ? section : section?.querySelector(`tr[data-row="${idx}"]`);
    el?.scrollIntoView({ block: idx === -1 ? 'start' : 'center' });
    if (idx !== -1) highlightLine(props.file.path, r.side, r.line);
  },
);

function askFromSelection() {
  if (!floating.value) return;
  const d = floating.value.draft;
  askAboutSelection({ path: d.path, side: d.side, startLine: d.startLine, endLine: d.endLine, snippet: d.snippet });
  floating.value = null;
  window.getSelection()?.removeAllRanges();
}
</script>

<template>
  <section :id="fileDomId(file.path)" ref="sectionEl" class="file" :class="{ viewed }">
    <header class="file-header">
      <button class="caret" :title="collapsed ? 'Abrir' : 'Recolher'" @click="toggleCollapsed(file.path)">
        {{ collapsed ? '▸' : '▾' }}
      </button>
      <span v-if="step" class="step-badge" :title="`Posição na ordem de revisão`">{{ step.step }}</span>
      <span class="status" :class="file.status">{{ STATUS[file.status] }}</span>
      <span class="path" :title="file.path">
        <template v-if="file.oldPath && file.newPath && file.oldPath !== file.newPath">
          <span class="old-path">{{ file.oldPath }}</span> →
        </template>
        {{ file.path }}
      </span>
      <button class="icon-btn" title="Copiar caminho" @click="copyPath">⧉</button>
      <span class="stats">
        <span class="add">+{{ file.additions }}</span>
        <span class="del">−{{ file.deletions }}</span>
      </span>
      <span class="spacer" />
      <span v-if="changedSinceViewed(file)" class="badge warn" title="O arquivo mudou na branch depois que você marcou como visto">
        Mudou desde que você viu
      </span>
      <span v-if="comments.length" class="badge">💬 {{ comments.length }}</span>
      <button v-if="expandable && !collapsed" class="btn small" :disabled="loadingContent" @click="toggleWholeFile">
        {{ wholeFile ? 'Voltar ao diff' : 'Ver arquivo inteiro' }}
      </button>
      <label class="viewed-toggle" :class="{ on: viewed }">
        <input type="checkbox" :checked="viewed" @change="onViewedChange" />
        Visto
      </label>
    </header>

    <div v-if="chain.length && !collapsed" class="file-chain">
      <span class="file-chain-label">Como se chega aqui:</span>
      <template v-for="(item, k) in chain" :key="item.path">
        <span v-if="k" class="file-chain-sep">→</span>
        <button class="file-chain-item" :class="{ changed: item.changed, self: item.self }" :title="item.path" @click="openChainItem(item)">
          {{ item.name }}
        </button>
      </template>
    </div>

    <div v-if="!collapsed" class="file-body">
      <div v-if="file.binary" class="note">Arquivo binário: sem diff de texto.</div>
      <div v-else-if="!file.hunks.length" class="note">
        {{ file.status === 'renamed' ? 'Renomeado, sem mudanças no conteúdo.' : 'Sem mudanças no conteúdo (arquivo vazio ou só permissões).' }}
      </div>
      <template v-else>
        <div v-if="placement.orphans.length" class="orphans">
          <p>Comentários em linhas que não estão visíveis agora:</p>
          <CommentCard v-for="c in placement.orphans" :key="c.id" :comment="c" show-location />
        </div>

        <table class="diff" :class="[store.viewMode, selectSide ? `select-${selectSide}` : '']" @mouseup="onMouseUp">
          <colgroup v-if="isSplit">
            <col class="col-num" /><col class="col-code" /><col class="col-num" /><col class="col-code" />
          </colgroup>
          <colgroup v-else>
            <col class="col-num" /><col class="col-num" /><col class="col-code" />
          </colgroup>
          <tbody>
            <template v-for="(row, idx) in displayRows" :key="idx">
              <!-- Trecho oculto -->
              <tr v-if="row.kind === 'gap'" class="gap">
                <td class="gap-gutter" :colspan="isSplit ? 1 : 2">
                  <div class="gap-buttons">
                    <button
                      v-if="row.canExpandUp"
                      class="gap-btn"
                      :title="`Mostrar ${EXPAND_STEP} linhas acima`"
                      :disabled="loadingContent"
                      @click="expand(row, 'up')"
                    >
                      ↑
                    </button>
                    <button
                      v-if="row.canExpandDown"
                      class="gap-btn"
                      :title="`Mostrar ${EXPAND_STEP} linhas abaixo`"
                      :disabled="loadingContent"
                      @click="expand(row, 'down')"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td class="gap-text" :colspan="isSplit ? 3 : 1">
                  <button class="link-btn" :disabled="loadingContent" @click="expand(row, 'all')">
                    {{ row.index === 0 ? '⇡ Mostrar tudo até o início' : row.hidden === null || row.index === file.hunks.length ? '⇣ Mostrar tudo até o fim' : '↕ Mostrar todas' }}
                  </button>
                  <span class="gap-info">{{ gapLabel(row) }}</span>
                  <span v-if="row.section" class="section">{{ row.section }}</span>
                </td>
              </tr>

              <!-- Linha no modo unificado -->
              <tr
                v-else-if="row.kind === 'line'"
                :data-row="idx"
                class="line"
                :class="[row.type, { expanded: row.expanded, selected: lineSelected(row), flash: isFlash(row) }]"
              >
                <td
                  class="num"
                  @mousedown.prevent="startDrag(anchorOf(row).side, anchorOf(row).line)"
                  @mouseenter="moveDrag(anchorOf(row).side, anchorOf(row).line)"
                >
                  {{ row.oldNo ?? '' }}
                </td>
                <td
                  class="num"
                  @mousedown.prevent="startDrag(anchorOf(row).side, anchorOf(row).line)"
                  @mouseenter="moveDrag(anchorOf(row).side, anchorOf(row).line)"
                >
                  {{ row.newNo ?? '' }}
                </td>
                <td class="code" v-bind="unifiedDefAttrs(row)" @mousedown="onCodeMouseDown(anchorOf(row).side)">
                  <span class="marker">{{ marker(row.type) }}</span><CodeText :content="row.content" :parts="unifiedParts(row)" />
                </td>
              </tr>

              <!-- Linha no modo lado a lado -->
              <tr v-else :data-row="idx" class="line split-row">
                <td
                  class="num"
                  :class="[row.left?.type ?? 'empty', { selected: inRange('old', row.left?.no), expanded: row.left?.expanded, flash: isFlashCell('old', row.left?.no) }]"
                  @mousedown.prevent="startDrag('old', row.left?.no)"
                  @mouseenter="moveDrag('old', row.left?.no)"
                >
                  {{ row.left?.no ?? '' }}
                </td>
                <td
                  class="code side-old"
                  v-bind="defAttrs('old', row.left?.no)"
                  :class="[row.left?.type ?? 'empty', { selected: inRange('old', row.left?.no), expanded: row.left?.expanded, flash: isFlashCell('old', row.left?.no) }]"
                  @mousedown="onCodeMouseDown('old')"
                >
                  <template v-if="row.left">
                    <span class="marker">{{ marker(row.left.type) }}</span><CodeText :content="row.left.content" :parts="partsOf('old', row.left.no, row.left.content)" />
                  </template>
                </td>
                <td
                  class="num"
                  :class="[row.right?.type ?? 'empty', { selected: inRange('new', row.right?.no), expanded: row.right?.expanded, flash: isFlashCell('new', row.right?.no) }]"
                  @mousedown.prevent="startDrag('new', row.right?.no)"
                  @mouseenter="moveDrag('new', row.right?.no)"
                >
                  {{ row.right?.no ?? '' }}
                </td>
                <td
                  class="code side-new"
                  v-bind="defAttrs('new', row.right?.no)"
                  :class="[row.right?.type ?? 'empty', { selected: inRange('new', row.right?.no), expanded: row.right?.expanded, flash: isFlashCell('new', row.right?.no) }]"
                  @mousedown="onCodeMouseDown('new')"
                >
                  <template v-if="row.right">
                    <span class="marker">{{ marker(row.right.type) }}</span><CodeText :content="row.right.content" :parts="partsOf('new', row.right.no, row.right.content)" />
                  </template>
                </td>
              </tr>

              <!-- Comentários e rascunho ancorados nesta linha -->
              <tr v-for="c in placement.byRow.get(idx) ?? []" :key="c.id" class="comment-row">
                <td :colspan="colspan"><CommentCard :comment="c" /></td>
              </tr>
              <tr v-if="draftRow === idx && myDraft" class="comment-row">
                <td :colspan="colspan">
                  <CommentForm :label="draftLabel(myDraft)" submit-label="Comentar" @save="saveDraft" @cancel="store.draft = null" />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </div>

    <div v-if="floating" class="floating-actions" :style="{ left: `${floating.x + 8}px`, top: `${floating.y + 8}px` }">
      <button class="floating-comment" @click="commentFromSelection">💬 Comentar</button>
      <button class="floating-comment ai" @click="askFromSelection">✨ Perguntar à IA</button>
    </div>
  </section>
</template>
