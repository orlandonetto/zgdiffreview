<script setup>
import { onMounted, ref } from 'vue';

const props = defineProps({
  label: { type: String, default: '' },
  initial: { type: String, default: '' },
  submitLabel: { type: String, required: true },
});
const emit = defineEmits(['save', 'cancel']);

const body = ref(props.initial);
const textarea = ref(null);

onMounted(() => textarea.value?.focus());

function submit() {
  if (body.value.trim()) emit('save', body.value);
}

function onKeydown(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Escape') {
    emit('cancel');
  }
}
</script>

<template>
  <div class="comment-form">
    <div v-if="label" class="comment-form-label">{{ label }}</div>
    <textarea ref="textarea" v-model="body" rows="4" placeholder="Escreva o comentário… (⌘+Enter salva, Esc cancela)" @keydown="onKeydown" />
    <div class="comment-form-actions">
      <button class="btn" @click="emit('cancel')">Cancelar</button>
      <button class="btn primary" :disabled="!body.trim()" @click="submit">{{ submitLabel }}</button>
    </div>
  </div>
</template>
