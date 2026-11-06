<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import {
  chat,
  chatConfig,
  currentProvider,
  loadModels,
  QUICK_ACTIONS,
  resetChat,
  send,
  setEffort,
  setModel,
  setProvider,
  stop,
} from '../chat.js';
import { store } from '../store.js';
import ChatMessage from './ChatMessage.vue';

const list = ref(null);
const provider = computed(() => currentProvider());
const models = computed(() => chat.models[chatConfig.provider] ?? []);
const confirmingReset = ref(false);

// Acompanha o fim da conversa enquanto a resposta chega.
watch(
  () => {
    const last = chat.display[chat.display.length - 1];
    return `${chat.display.length}:${last?.text?.length ?? 0}:${last?.tools?.length ?? 0}:${last?.events?.length ?? 0}`;
  },
  async () => {
    await nextTick();
    const el = list.value;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  },
);

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

function quick(action) {
  if (action.needsFile && !store.currentPath) return;
  chat.input = action.text;
  send();
}

function onModelChange(e) {
  const v = e.target.value;
  if (v) setModel(v);
}

const contextLabel = computed(() => {
  const c = chat.context;
  if (c) return c.startLine ? `${c.path}:${c.startLine}${c.endLine !== c.startLine ? `–${c.endLine}` : ''}` : c.path;
  return '';
});

async function doReset() {
  confirmingReset.value = false;
  await resetChat();
}
</script>

<template>
  <aside class="chat">
    <header class="chat-header">
      <strong>✨ Assistente</strong>
      <span class="spacer" />
      <template v-if="chat.display.length">
        <button v-if="!confirmingReset" class="btn small" :disabled="chat.busy" title="Começar uma conversa nova" @click="confirmingReset = true">Nova conversa</button>
        <template v-else>
          <button class="btn small danger" @click="doReset">Apagar conversa</button>
          <button class="btn small" @click="confirmingReset = false">Não</button>
        </template>
      </template>
      <button class="btn small" title="Fechar" @click="chat.open = false">✕</button>
    </header>

    <div class="chat-settings">
      <select :value="chatConfig.provider" title="Provedor" @change="setProvider($event.target.value)">
        <option v-for="p in chatConfig.providers" :key="p.id" :value="p.id">{{ p.label }}{{ p.credential ? '' : ' (sem credencial)' }}</option>
      </select>
      <select :value="provider?.model ?? ''" title="Modelo" @focus="models.length || loadModels()" @change="onModelChange">
        <option v-if="!provider?.model" value="" disabled>Escolha o modelo…</option>
        <option v-if="provider?.model && !models.includes(provider.model)" :value="provider.model">{{ provider.model }}</option>
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
      <button class="icon-btn" :disabled="chat.modelsLoading" title="Atualizar a lista de modelos" @click="loadModels()">{{ chat.modelsLoading ? '…' : '⟳' }}</button>
      <select :value="chatConfig.effort" title="Esforço (raciocínio)" @change="setEffort($event.target.value)">
        <option value="low">esforço baixo</option>
        <option value="medium">esforço médio</option>
        <option value="high">esforço alto</option>
      </select>
    </div>

    <div v-if="provider && !provider.credential" class="chat-setup">
      <strong>{{ provider.label }} sem credencial.</strong>
      <p>No terminal:</p>
      <code>{{ provider.hint }}</code>
      <p>Depois recarregue esta página. A chave fica só no seu computador e nunca passa pelo navegador.</p>
    </div>
    <div v-else-if="provider" class="chat-privacy">
      Suas mensagens e os trechos de código que o assistente ler são enviados para {{ provider.label }}.
    </div>

    <div ref="list" class="chat-list">
      <div v-if="!chat.display.length" class="chat-empty">
        <p>Pergunte sobre as mudanças desta branch. O assistente lê os diffs e os arquivos do repositório quando precisa.</p>
        <p class="muted">Dica: selecione um trecho de código e clique em "✨ Perguntar à IA".</p>
      </div>
      <ChatMessage v-for="item in chat.display" :key="item.id" :item="item" />
    </div>

    <div class="chat-quick">
      <button
        v-for="a in QUICK_ACTIONS"
        :key="a.label"
        class="chip"
        :disabled="chat.busy || (a.needsFile && !store.currentPath)"
        @click="quick(a)"
      >
        {{ a.label }}
      </button>
    </div>

    <div class="chat-input">
      <div class="chat-context">
        <span v-if="contextLabel" class="chip on">📎 {{ contextLabel }} <button class="chip-x" title="Remover" @click="chat.context = null">×</button></span>
        <label v-else-if="store.currentPath" class="chat-context-toggle">
          <input v-model="chat.includeCurrentFile" type="checkbox" />
          incluir arquivo atual ({{ store.currentPath.split('/').pop() }})
        </label>
      </div>
      <textarea v-model="chat.input" rows="3" placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)" @keydown="onKeydown" />
      <div class="chat-input-actions">
        <button v-if="chat.busy" class="btn small danger" @click="stop">■ Parar</button>
        <button v-else class="btn small primary" :disabled="!chat.input.trim()" @click="send">Enviar</button>
      </div>
    </div>
  </aside>
</template>
