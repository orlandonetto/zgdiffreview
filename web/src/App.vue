<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from './api.js';
import { chat, loadChatStatus, openChat } from './chat.js';
import ChatPanel from './components/ChatPanel.vue';
import DefinitionPopups from './components/DefinitionPopups.vue';
import FileDiff from './components/FileDiff.vue';
import FileSidebar from './components/FileSidebar.vue';
import FileViewer from './components/FileViewer.vue';
import {
  back,
  BACK_LABEL,
  canGoBack,
  canGoForward,
  closeViewer,
  forward,
  FORWARD_LABEL,
  installDefinitionClicks,
  installHistory,
  IS_MAC,
  MOD_LABEL,
  nav,
} from './nav.js';
import {
  collapseAll,
  expandAll,
  flash,
  goNext,
  goNextUnviewed,
  goPrev,
  load,
  orderedFiles,
  store,
  toggleCurrentViewed,
  viewedCount,
} from './store.js';

const content = ref(null);

const SHORTCUTS = [
  ['n / p', 'próximo / anterior arquivo (na ordem do painel)'],
  ['v', 'marcar como visto e ir ao próximo não visto'],
  [`${MOD_LABEL}+clique`, 'ir para a definição'],
  [`${BACK_LABEL} · botão voltar do mouse`, 'voltar ao ponto do clique'],
  [`${FORWARD_LABEL} · botão avançar do mouse`, 'avançar'],
  ['Esc', 'fechar visualizador e popups'],
];
const shortcutsTitle = SHORTCUTS.map(([k, v]) => `${k}  —  ${v}`).join('\n');

// ---------- Arquivo atual (o que está no topo da área de leitura) ----------

let rafId = 0;
function updateCurrent() {
  rafId = 0;
  const el = content.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top + 48;
  let current = null;
  for (const section of el.querySelectorAll('section.file')) {
    const r = section.getBoundingClientRect();
    if (r.top <= top) current = section;
    if (r.top > top) break;
  }
  current ??= el.querySelector('section.file');
  store.currentPath = current ? decodeURIComponent(current.id.slice('file-'.length)) : null;
}
const onScroll = () => {
  if (!rafId) rafId = requestAnimationFrame(updateCurrent);
};

// ---------- Atalhos de teclado ----------

function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function onKeydown(e) {
  // Voltar/avançar como no VS Code do Mac: ⌃− e ⌃⇧−. (⌘[ / ⌘], Alt+← / Alt+→ e os botões
  // do mouse são do próprio navegador e chegam pelo histórico.)
  if (IS_MAC && e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'Minus' || e.key === '-' || e.key === '_')) {
    if (isTyping(e)) return;
    e.preventDefault();
    if (e.shiftKey) forward();
    else back();
    return;
  }
  if (e.key === 'Escape') {
    if (nav.picker || nav.notFound) {
      nav.picker = null;
      nav.notFound = null;
    } else if (nav.viewer) closeViewer();
    return;
  }
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n') goNext();
  else if (e.key === 'p') goPrev();
  else if (e.key === 'v') toggleCurrentViewed();
  else return;
  e.preventDefault();
}

onMounted(async () => {
  installDefinitionClicks();
  installHistory();
  window.addEventListener('keydown', onKeydown);
  await load();
  loadChatStatus();
  requestAnimationFrame(updateCurrent);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

// ---------- Topo ----------

const totals = computed(() => {
  const files = store.review?.files ?? [];
  return { adds: files.reduce((s, f) => s + f.additions, 0), dels: files.reduce((s, f) => s + f.deletions, 0) };
});
const progress = computed(() => {
  const total = store.review?.files.length ?? 0;
  return total ? Math.round((viewedCount.value / total) * 100) : 0;
});

const exportText = ref(null);

async function openExport() {
  try {
    exportText.value = await api.exportMarkdown();
  } catch (err) {
    flash(err.message);
  }
}

async function copyExport() {
  if (exportText.value === null) return;
  await navigator.clipboard.writeText(exportText.value);
  flash('Markdown copiado.');
}

function downloadExport() {
  if (exportText.value === null || !store.review) return;
  const blob = new Blob([exportText.value], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `review-${store.review.head.replace(/[^\w.-]+/g, '-')}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toggleChat() {
  if (chat.open) chat.open = false;
  else openChat();
}
</script>

<template>
  <div v-if="store.loading && !store.review" class="center">Carregando review…</div>
  <div v-else-if="store.error" class="center error">
    <p>{{ store.error }}</p>
    <button class="btn" @click="load">Tentar de novo</button>
  </div>
  <div v-else-if="store.review" class="layout" :class="{ 'with-chat': chat.open }">
    <header class="topbar">
      <div class="topbar-title">
        <strong>{{ store.review.repoName }}</strong>
        <span class="refs">
          <code>{{ store.review.head }}</code> → <code>{{ store.review.base }}</code>
        </span>
        <span class="shas" :title="`merge-base ${store.review.mergeBaseSha} · head ${store.review.headSha}`">
          {{ store.review.mergeBaseSha.slice(0, 7) }}…{{ store.review.headSha.slice(0, 7) }}
        </span>
        <span class="stats">
          <span class="add">+{{ totals.adds }}</span> <span class="del">−{{ totals.dels }}</span>
        </span>
      </div>
      <div class="topbar-actions">
        <div class="nav-buttons">
          <button class="btn" :disabled="!canGoBack" :title="`Voltar ao ponto do clique (${BACK_LABEL} ou botão voltar do mouse)`" @click="back">←</button>
          <button class="btn" :disabled="!canGoForward" :title="`Avançar (${FORWARD_LABEL} ou botão avançar do mouse)`" @click="forward">→</button>
        </div>
        <div class="progress" :title="`${viewedCount} de ${store.review.files.length} arquivos vistos`">
          <span>{{ viewedCount }}/{{ store.review.files.length }} vistos</span>
          <div class="progress-bar"><div :style="{ width: `${progress}%` }" /></div>
        </div>
        <button class="btn" title="Ir para o próximo arquivo não visto" @click="goNextUnviewed">Próximo não visto</button>
        <button class="btn" @click="collapseAll">Recolher todos</button>
        <button class="btn" @click="expandAll">Abrir todos</button>
        <div class="segmented">
          <button :class="{ active: store.viewMode === 'split' }" @click="store.viewMode = 'split'">Lado a lado</button>
          <button :class="{ active: store.viewMode === 'unified' }" @click="store.viewMode = 'unified'">Unificado</button>
        </div>
        <button class="btn" @click="openExport">Exportar ({{ store.state.comments.length }})</button>
        <button class="btn" :class="{ primary: chat.open }" title="Assistente (IA)" @click="toggleChat">✨ Chat</button>
        <button class="btn" :title="`Atalhos:\n${shortcutsTitle}`">⌨</button>
        <button class="btn" title="Recalcular o diff (pega commits novos da branch)" @click="load">⟳</button>
      </div>
    </header>

    <FileSidebar />

    <main ref="content" class="content" @scroll="onScroll">
      <div v-if="!store.review.files.length" class="center">Nenhuma diferença entre a branch e a base.</div>
      <FileDiff v-for="file in orderedFiles" :key="`${file.path}:${file.patchHash}`" :file="file" />
      <p class="store-path">
        Comentários e arquivos vistos ficam salvos em <code>{{ store.storePath }}</code> · {{ MOD_LABEL }}+clique num nome vai para a definição
      </p>
    </main>

    <ChatPanel v-if="chat.open" />
    <FileViewer />
    <DefinitionPopups />

    <div v-if="exportText !== null" class="modal-backdrop" @click.self="exportText = null">
      <div class="modal">
        <header class="modal-header">
          <strong>Comentários em Markdown</strong>
          <span class="spacer" />
          <button class="btn" @click="copyExport">Copiar</button>
          <button class="btn" @click="downloadExport">Baixar .md</button>
          <button class="btn" @click="exportText = null">Fechar</button>
        </header>
        <textarea class="modal-text" readonly :value="exportText" />
      </div>
    </div>

    <div v-if="store.toast" class="toast">{{ store.toast }}</div>
  </div>
</template>
