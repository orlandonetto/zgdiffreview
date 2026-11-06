<script setup>
import { computed } from 'vue';
import { askAiForDefinition, nav, navigate } from '../nav.js';

const style = (p) => ({
  left: `${Math.min(p.x + 6, window.innerWidth - 520)}px`,
  top: `${Math.min(p.y + 14, window.innerHeight - 320)}px`,
});

const methodLabel = computed(() => (nav.picker?.method === 'typescript' ? 'análise do código' : 'busca por declaração'));

function pick(c) {
  navigate({ path: c.path, side: nav.picker.side, line: c.line });
}
</script>

<template>
  <div v-if="nav.picker || nav.notFound" class="popup-backdrop" @mousedown.self="nav.picker = null; nav.notFound = null" />

  <div v-if="nav.picker" class="def-popup" :style="style(nav.picker)">
    <div class="def-popup-header">
      <strong>{{ nav.picker.symbol }}</strong> · {{ nav.picker.candidates.length }} definições possíveis ({{ methodLabel }})
    </div>
    <button v-for="c in nav.picker.candidates" :key="`${c.path}:${c.line}`" class="def-candidate" @click="pick(c)">
      <span class="def-candidate-loc">{{ c.path }}:{{ c.line }}</span>
      <code class="def-candidate-text">{{ c.text.trim() }}</code>
    </button>
  </div>

  <div v-if="nav.notFound" class="def-popup" :style="style(nav.notFound)">
    <div class="def-popup-header">
      Não encontrei a definição de <strong>{{ nav.notFound.symbol }}</strong> pela análise do código nem pela busca.
    </div>
    <div class="def-popup-actions">
      <button class="btn small" @click="nav.notFound = null">Fechar</button>
      <button class="btn small primary" @click="askAiForDefinition">✨ Perguntar à IA</button>
    </div>
  </div>

  <div v-if="nav.busy" class="def-busy">Procurando definição…</div>
</template>
