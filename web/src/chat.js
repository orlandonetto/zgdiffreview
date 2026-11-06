import { nextTick, reactive } from 'vue';
import { api } from './api.js';
import { flash, guarded, store } from './store.js';

/** Estado do painel de chat. */
export const chat = reactive({
  open: false,
  loaded: false,
  /** Itens exibidos: { id, role, text, context?, tools, events, status, error, provider, model } */
  display: [],
  busy: false,
  controller: null,
  input: '',
  /** Contexto explícito (trecho selecionado) para a próxima mensagem. */
  context: null,
  /** Incluir o arquivo atual como contexto quando não há trecho selecionado. */
  includeCurrentFile: true,
  status: null,
  models: {},
  modelsLoading: false,
});

/** Configuração lida do servidor (provedor, modelo, esforço...). */
export const chatConfig = reactive({ provider: 'anthropic', effort: 'medium', autoDefinitionFallback: false, providers: [] });

export async function loadChatStatus() {
  const s = await guarded(() => api.llmStatus());
  if (!s) return;
  Object.assign(chatConfig, s);
  chat.status = s;
}

export async function openChat() {
  chat.open = true;
  if (!chat.loaded) {
    chat.loaded = true;
    await loadChatStatus();
    const h = await guarded(() => api.chatHistory());
    if (h) chat.display = h.display;
  }
  await nextTick();
  document.querySelector('.chat-input textarea')?.focus();
}

export function currentProvider() {
  return chatConfig.providers.find((p) => p.id === chatConfig.provider) ?? null;
}

export async function setProvider(id) {
  const s = await guarded(() => api.llmSettings({ provider: id }));
  if (s) Object.assign(chatConfig, s);
  if (!currentProvider()?.model) loadModels(id);
}

export async function setModel(model) {
  const s = await guarded(() => api.llmSettings({ model, modelProvider: chatConfig.provider }));
  if (s) Object.assign(chatConfig, s);
}

export async function setEffort(effort) {
  const s = await guarded(() => api.llmSettings({ effort }));
  if (s) Object.assign(chatConfig, s);
}

export async function loadModels(provider = chatConfig.provider) {
  chat.modelsLoading = true;
  try {
    chat.models[provider] = await api.llmModels(provider);
  } catch (err) {
    flash(err.message);
  } finally {
    chat.modelsLoading = false;
  }
}

export async function resetChat() {
  const r = await guarded(() => api.chatReset());
  if (r) chat.display = [];
}

/** Abre o chat e envia uma pergunta (usado pela seleção e pela definição via IA). */
export async function askAssistant(text, context = null) {
  await openChat();
  chat.context = context;
  chat.input = text;
  send();
}

/** Pergunta sobre um trecho: abre o chat com o trecho como contexto, para você escrever a pergunta. */
export async function askAboutSelection(context) {
  chat.context = context;
  await openChat();
}

export function stop() {
  chat.controller?.abort();
}

export async function send() {
  const text = chat.input.trim();
  if (!text || chat.busy) return;
  let context = chat.context;
  if (!context && chat.includeCurrentFile && store.currentPath) context = { path: store.currentPath, side: 'new' };
  chat.input = '';
  chat.context = null;
  chat.busy = true;
  const controller = new AbortController();
  chat.controller = controller;

  let reply = null;
  const onEvent = (ev) => {
    switch (ev.type) {
      case 'start':
        chat.display.push(ev.user);
        reply = reactive({ id: ev.reply.id, role: 'assistant', text: '', tools: [], events: [], status: 'streaming' });
        chat.display.push(reply);
        break;
      case 'model':
        reply.provider = ev.provider;
        reply.model = ev.model;
        break;
      case 'text':
        reply.text += ev.delta;
        break;
      case 'tool':
        reply.tools.push({ name: ev.name, summary: ev.summary, pending: true });
        break;
      case 'tool_done': {
        const t = [...reply.tools].reverse().find((x) => x.name === ev.name && x.pending);
        if (t) {
          t.pending = false;
          t.isError = ev.isError;
        }
        break;
      }
      case 'suggestion':
      case 'location':
        reply.events.push(ev);
        break;
      case 'notice':
        reply.notice = ev.message;
        break;
      case 'refused':
        reply.status = 'refused';
        break;
      case 'error':
        reply.error = ev.message;
        reply.status = ev.cancelled ? 'cancelled' : 'error';
        break;
      case 'done':
        reply.status = ev.status;
        break;
    }
  };

  try {
    await api.chat(
      { text, context, provider: chatConfig.provider, model: currentProvider()?.model ?? undefined },
      onEvent,
      controller.signal,
    );
  } catch (err) {
    if (controller.signal.aborted) {
      if (reply) reply.status = 'cancelled';
    } else {
      flash(err.message);
      if (reply) {
        reply.status = 'error';
        reply.error = err.message;
      } else {
        chat.input = text;
      }
    }
  } finally {
    chat.busy = false;
    chat.controller = null;
  }
}

export async function setSuggestionStatus(ev, status) {
  ev.status = status;
  await guarded(() => api.suggestionStatus(ev.id, status));
}

export const QUICK_ACTIONS = [
  { label: 'Ordem de revisão', text: 'Sugira a melhor ordem para eu revisar estes arquivos (use propose_order) e explique em poucas linhas o porquê.' },
  { label: 'Resumir mudanças', text: 'Resuma o que esta branch muda, agrupando por assunto (não por commit). Aponte os pontos que merecem mais atenção.' },
  { label: 'Descrição da PR', text: 'Escreva a descrição da pull request desta branch em Markdown: contexto, o que mudou, como testar e riscos.' },
  { label: 'Revisar arquivo atual', text: 'Revise o arquivo atual: procure bugs, casos não tratados e problemas de segurança. Sugira comentários com propose_comment onde houver problema concreto.', needsFile: true },
];
