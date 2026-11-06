<script setup>
import { nextTick, ref, watch } from 'vue';
import { highlight, partsFor } from '../lib/highlight.js';
import { back, BACK_LABEL, canGoBack, closeViewer, MOD_LABEL, nav } from '../nav.js';
import CodeText from './CodeText.js';

const tokens = ref(null);
watch(
  () => (nav.viewer && !nav.viewer.loading ? nav.viewer.lines : null),
  async (lines) => {
    tokens.value = null;
    if (!lines) return;
    const path = nav.viewer.path;
    const t = await highlight(path, lines.join('\n'));
    if (nav.viewer?.path === path) tokens.value = t;
  },
);

// Ao abrir (ou trocar de arquivo/linha), rola até a linha de destino.
watch(
  () => nav.viewer && !nav.viewer.loading && `${nav.viewer.side}:${nav.viewer.path}:${nav.viewer.line}`,
  async (key) => {
    if (!key) return;
    await nextTick();
    document.querySelector(`.viewer tr[data-viewer-line="${nav.viewer.line}"]`)?.scrollIntoView({ block: 'center' });
  },
);
</script>

<template>
  <div v-if="nav.viewer" class="viewer-backdrop" @click.self="closeViewer">
    <aside class="viewer">
      <header class="viewer-header">
        <button v-if="canGoBack" class="btn small" :title="`Voltar (${BACK_LABEL})`" @click="back">← Voltar</button>
        <code class="viewer-path">{{ nav.viewer.path }}</code>
        <span class="badge">{{ nav.viewer.side === 'old' ? 'versão antiga (base)' : 'versão nova (branch)' }}</span>
        <span class="badge muted">sem mudanças neste review</span>
        <span class="spacer" />
        <span class="viewer-hint">{{ MOD_LABEL }}+clique navega</span>
        <button class="btn small" title="Fechar (Esc)" @click="closeViewer">✕</button>
      </header>
      <div v-if="nav.viewer.loading" class="note">Carregando…</div>
      <div v-else-if="nav.viewer.error" class="note error-text">{{ nav.viewer.error }}</div>
      <div v-else class="viewer-body">
        <table class="diff unified viewer-table">
          <colgroup><col class="col-num" /><col class="col-code" /></colgroup>
          <tbody>
            <tr
              v-for="(text, k) in nav.viewer.lines"
              :key="k"
              :data-viewer-line="k + 1"
              class="line context"
              :class="{ flash: k + 1 === nav.viewer.line }"
            >
              <td class="num">{{ k + 1 }}</td>
              <td class="code" :data-def-path="nav.viewer.path" :data-def-side="nav.viewer.side" :data-def-line="k + 1">
                <CodeText :content="text" :parts="partsFor(tokens, k + 1, text)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </aside>
  </div>
</template>
