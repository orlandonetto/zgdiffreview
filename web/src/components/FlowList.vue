<script setup>
import { computed } from 'vue';
import { flowByPath, flowSteps, groupLabel, store } from '../store.js';
import FileEntry from './FileEntry.vue';

const files = computed(() => new Map((store.review?.files ?? []).map((f) => [f.path, f])));

/** Passos agrupados na ordem em que aparecem (Fluxo de execução, Testes, Configuração...). */
const groups = computed(() => {
  const out = [];
  for (const s of flowSteps.value) {
    if (!files.value.has(s.path)) continue;
    let g = out[out.length - 1];
    if (!g || g.id !== s.group) {
      g = { id: s.group, label: groupLabel(s.group), steps: [] };
      out.push(g);
    }
    g.steps.push(s);
  }
  return out;
});

const split = (path) => {
  const k = path.lastIndexOf('/');
  return k === -1 ? { name: path, dir: '' } : { name: path.slice(k + 1), dir: path.slice(0, k) };
};
</script>

<template>
  <div class="flow-panel">
    <div class="flow-meta">
      <template v-if="store.flowSource === 'ai' && store.aiOrder">
        <div>✨ Ordem sugerida pela IA · <button class="link-btn" @click="store.flowSource = 'auto'">usar a calculada</button></div>
        <p class="flow-rationale">{{ store.aiOrder.rationale }}</p>
      </template>
      <template v-else-if="store.flow">
        <div v-if="store.flow.method === 'imports'">
          A partir de
          <code v-for="e in store.flow.entries" :key="e" class="flow-entry">{{ e }}</code>
        </div>
        <div v-else>Sem ponto de entrada detectado: ordem por camadas. Configure em <code>.zgdiff.json</code>.</div>
        <button v-if="store.aiOrder" class="link-btn" @click="store.flowSource = 'ai'">usar a ordem da IA</button>
      </template>
      <div v-else-if="store.flowError" class="flow-error">Não consegui calcular a ordem: {{ store.flowError }}</div>
      <div v-else>Calculando a ordem de revisão…</div>
    </div>

    <div v-if="store.flowSource === 'auto' && store.flow" class="flow-options">
      <span>Testes:</span>
      <div class="segmented">
        <button :class="{ active: store.testsPlacement === 'together' }" title="Logo depois do arquivo que testam" @click="store.testsPlacement = 'together'">
          junto
        </button>
        <button :class="{ active: store.testsPlacement === 'end' }" title="Todos no fim" @click="store.testsPlacement = 'end'">no fim</button>
      </div>
    </div>

    <div v-for="g in groups" :key="g.id" class="flow-group">
      <div class="flow-group-label">{{ g.label }}</div>
      <ul class="file-list">
        <li v-for="s in g.steps" :key="s.path">
          <FileEntry
            :file="files.get(s.path)"
            :label="split(s.path).name"
            :dir="split(s.path).dir"
            :indent="s.nested ? 26 : 8"
            :step="s.step"
            :nested="s.nested"
            :layer="flowByPath.get(s.path)?.layer.label ?? ''"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
