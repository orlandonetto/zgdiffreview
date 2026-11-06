<script setup>
import { computed } from 'vue';
import { setSuggestionStatus } from '../chat.js';
import { renderMarkdown } from '../lib/markdown.js';
import { navigate } from '../nav.js';
import { addComment, flash, useAiOrder } from '../store.js';

const props = defineProps({
  /** Item do histórico exibido (usuário ou assistente). */
  item: { type: Object, required: true },
});

const html = computed(() => renderMarkdown(props.item.text ?? ''));
const suggestions = computed(() => (props.item.events ?? []).filter((e) => e.type === 'suggestion'));
const locations = computed(() => (props.item.events ?? []).filter((e) => e.type === 'location'));

const contextLabel = computed(() => {
  const c = props.item.context;
  if (!c) return '';
  return c.startLine ? `${c.path}:${c.startLine}${c.endLine && c.endLine !== c.startLine ? `–${c.endLine}` : ''}` : c.path;
});

/** Links arquivo:linha dentro do texto da resposta. */
function onTextClick(e) {
  const a = e.target.closest?.('a.loc');
  if (!a) return;
  e.preventDefault();
  navigate({ path: a.dataset.path, side: 'new', line: Number(a.dataset.line) });
}

async function acceptComment(ev) {
  if (await addComment(ev.comment)) {
    await setSuggestionStatus(ev, 'accepted');
    flash('Comentário adicionado ao review.');
  }
}

function acceptOrder(ev) {
  useAiOrder(ev.paths, ev.rationale);
  setSuggestionStatus(ev, 'accepted');
}

const lines = (c) => (c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}–${c.endLine}`);
</script>

<template>
  <div class="chat-msg" :class="item.role">
    <template v-if="item.role === 'user'">
      <div class="chat-bubble">{{ item.text }}</div>
      <div v-if="contextLabel" class="chat-context-tag">📎 {{ contextLabel }}</div>
    </template>

    <template v-else>
      <div v-if="item.tools?.length" class="chat-tools">
        <span v-for="(t, k) in item.tools" :key="k" class="chat-tool" :class="{ error: t.isError, pending: t.pending }" :title="t.summary">
          {{ t.pending ? '⏳' : t.isError ? '⚠' : '🔧' }} {{ t.name }}<template v-if="t.summary"> · {{ t.summary }}</template>
        </span>
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -- HTML gerado por renderMarkdown, com todo o texto escapado -->
      <div v-if="item.text" class="chat-text md" @click="onTextClick" v-html="html" />
      <div v-else-if="item.status === 'streaming'" class="chat-thinking">Pensando…</div>

      <div v-for="loc in locations" :key="`${loc.path}:${loc.line}`" class="chat-location">
        <button class="link-btn" @click="navigate({ path: loc.path, side: loc.side, line: loc.line })">📍 {{ loc.label }}</button>
      </div>

      <div v-for="ev in suggestions" :key="ev.id" class="chat-suggestion" :class="ev.status">
        <template v-if="ev.kind === 'comment'">
          <div class="chat-suggestion-title">
            Sugestão de comentário ·
            <button class="link-btn" @click="navigate({ path: ev.comment.path, side: ev.comment.side, line: ev.comment.startLine })">
              {{ ev.comment.path }}:{{ lines(ev.comment) }}
            </button>
          </div>
          <pre v-if="ev.comment.snippet" class="comment-snippet">{{ ev.comment.snippet }}</pre>
          <div class="chat-suggestion-body">{{ ev.comment.body }}</div>
        </template>
        <template v-else-if="ev.kind === 'order'">
          <div class="chat-suggestion-title">Sugestão de ordem de revisão ({{ ev.paths.length }} arquivos)</div>
          <div class="chat-suggestion-body">{{ ev.rationale }}</div>
          <ol class="chat-order">
            <li v-for="p in ev.paths.slice(0, 12)" :key="p"><code>{{ p }}</code></li>
            <li v-if="ev.paths.length > 12" class="muted">… mais {{ ev.paths.length - 12 }}</li>
          </ol>
        </template>
        <div class="chat-suggestion-actions">
          <span v-if="ev.status === 'accepted'" class="ok">✓ Aceita</span>
          <span v-else-if="ev.status === 'dismissed'" class="muted">Descartada</span>
          <template v-else>
            <button class="btn small" @click="setSuggestionStatus(ev, 'dismissed')">Descartar</button>
            <button v-if="ev.kind === 'comment'" class="btn small primary" @click="acceptComment(ev)">Adicionar ao review</button>
            <button v-else class="btn small primary" @click="acceptOrder(ev)">Usar esta ordem</button>
          </template>
        </div>
      </div>

      <div v-if="item.notice" class="chat-notice">{{ item.notice }}</div>
      <div v-if="item.status === 'refused'" class="chat-notice">O modelo recusou responder a esta mensagem.</div>
      <div v-if="item.error" class="chat-error">{{ item.error }}</div>
      <div v-if="item.model" class="chat-model">{{ item.provider }} · {{ item.model }}</div>
    </template>
  </div>
</template>
