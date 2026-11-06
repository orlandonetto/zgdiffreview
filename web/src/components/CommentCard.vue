<script setup>
import { computed, ref } from 'vue';
import { deleteComment, updateComment } from '../store.js';
import CommentForm from './CommentForm.vue';

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../src/shared/types.js').ReviewComment>} */
  comment: { type: Object, required: true },
  showLocation: { type: Boolean, default: false },
});

const editing = ref(false);
const confirmingDelete = ref(false);

const location = computed(() => {
  const c = props.comment;
  const lines = c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}–L${c.endLine}`;
  return `${lines} · ${c.side === 'new' ? 'versão nova' : 'versão antiga'}`;
});

const when = computed(() => new Date(props.comment.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));

async function save(body) {
  if (await updateComment(props.comment.id, body)) editing.value = false;
}
</script>

<template>
  <div class="comment-card">
    <div class="comment-meta">
      <span class="comment-location">{{ location }}</span>
      <span class="comment-when">{{ when }}</span>
      <span class="spacer" />
      <template v-if="!editing">
        <button class="link-btn" @click="editing = true">Editar</button>
        <button v-if="!confirmingDelete" class="link-btn danger" @click="confirmingDelete = true">Excluir</button>
        <template v-else>
          <button class="link-btn danger" @click="deleteComment(comment.id)">Confirmar exclusão</button>
          <button class="link-btn" @click="confirmingDelete = false">Não</button>
        </template>
      </template>
    </div>
    <pre v-if="showLocation && comment.snippet" class="comment-snippet">{{ comment.snippet }}</pre>
    <CommentForm v-if="editing" :initial="comment.body" submit-label="Salvar" @save="save" @cancel="editing = false" />
    <div v-else class="comment-body">{{ comment.body }}</div>
  </div>
</template>
