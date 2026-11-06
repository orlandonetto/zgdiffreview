<script setup>
import { computed } from 'vue';
import { commentsByFile, isViewed, scrollToFile, store } from '../store.js';

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../src/shared/types.js').DiffFile>} */
  file: { type: Object, required: true },
  label: { type: String, required: true },
  indent: { type: Number, required: true },
  /** Pasta exibida em cinza depois do nome (modo Fluxo). */
  dir: { type: String, default: '' },
  /** Número na ordem de revisão (modo Fluxo). */
  step: { type: Number, default: 0 },
  /** Camada (Rotas, Controllers...) no modo Fluxo. */
  layer: { type: String, default: '' },
  /** Teste exibido logo abaixo do arquivo que testa. */
  nested: { type: Boolean, default: false },
});

const LETTER = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' };

const viewed = computed(() => isViewed(props.file));
const comments = computed(() => commentsByFile.value.get(props.file.path)?.length ?? 0);
const active = computed(() => store.currentPath === props.file.path);
</script>

<template>
  <button
    class="file-entry"
    :class="{ viewed, active, nested }"
    :style="{ paddingLeft: `${indent}px` }"
    :title="file.path"
    @click="scrollToFile(file.path)"
  >
    <span v-if="step" class="file-step">{{ step }}</span>
    <span class="file-letter" :class="file.status">{{ LETTER[file.status] }}</span>
    <span class="file-entry-name">
      <span v-if="nested" class="file-test-icon" title="Teste do arquivo acima">🧪</span>{{ label }}<span v-if="dir" class="file-entry-dir"> {{ dir }}</span>
    </span>
    <span v-if="layer && !nested" class="file-layer">{{ layer }}</span>
    <span v-if="comments" class="file-entry-comments">💬{{ comments }}</span>
    <span class="file-entry-viewed" :title="viewed ? 'Visto' : 'Não visto'">{{ viewed ? '✓' : '' }}</span>
  </button>
</template>
