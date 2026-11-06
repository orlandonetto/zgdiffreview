import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError, NotFoundError, ValidationError } from '../errors.js';
import { credentialSource, ENV_HINT, getApiKey, loadConfig, PROVIDER_LABELS, PROVIDERS } from './config.js';
import { LlmError } from './errors.js';
import { closeDanglingToolCalls } from './history.js';
import { systemPrompt, userMessage } from './prompt.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createOpenAIProvider } from './providers/openai.js';
import { runTool, TOOLS } from './tools.js';

const MAX_TOOL_ROUNDS = 16;
const MAX_MESSAGE = 20_000;

/** Cria o adaptador do provedor/modelo escolhido. */
export async function providerFor(providerId, model) {
  const cfg = await loadConfig();
  const id = providerId ?? cfg.provider;
  if (!PROVIDERS.includes(id)) throw new ValidationError(`Provedor inválido: ${id}`);
  const chosen = model ?? cfg.models[id];
  if (!(await credentialSource(id, cfg))) {
    throw new LlmError(`${PROVIDER_LABELS[id]} sem credencial. No terminal: ${ENV_HINT[id]}`, 401);
  }
  const apiKey = await getApiKey(id);
  const make = (m) => {
    if (id === 'anthropic') return createAnthropicProvider({ apiKey, model: m, effort: cfg.effort });
    if (id === 'openai') return createOpenAIProvider({ apiKey, model: m, effort: cfg.effort });
    return createGeminiProvider({ apiKey, model: m, vertex: cfg.gemini });
  };
  if (!chosen) {
    // Sem modelo escolhido ainda: o adaptador só serve para listar modelos.
    return { provider: make('__none__'), needsModel: true };
  }
  return { provider: make(chosen), needsModel: false };
}

export async function llmStatus() {
  const cfg = await loadConfig();
  const providers = [];
  for (const id of PROVIDERS) {
    providers.push({ id, label: PROVIDER_LABELS[id], model: cfg.models[id], credential: await credentialSource(id, cfg), hint: ENV_HINT[id] });
  }
  return { provider: cfg.provider, effort: cfg.effort, autoDefinitionFallback: cfg.autoDefinitionFallback, gemini: cfg.gemini, providers };
}

/**
 * Histórico do chat de um review, salvo ao lado do arquivo de comentários.
 * `messages` é o que vai para o modelo; `display` é o que a tela mostra.
 */
export class ChatStore {
  #file;
  #state = { messages: [], display: [] };
  #writing = Promise.resolve();

  constructor(reviewStorePath) {
    this.#file = reviewStorePath.replace(/\.json$/, '.chat.json');
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#file, 'utf8'));
      this.#state = { messages: parsed.messages ?? [], display: parsed.display ?? [] };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  get state() {
    return this.#state;
  }

  reset() {
    this.#state = { messages: [], display: [] };
    return this.save();
  }

  save() {
    const snapshot = JSON.stringify(this.#state);
    const file = this.#file;
    const next = this.#writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, snapshot, 'utf8');
      await rename(`${file}.tmp`, file);
    });
    this.#writing = next.catch(() => undefined);
    return next;
  }

  setSuggestionStatus(id, status) {
    for (const item of this.#state.display) {
      const s = item.events?.find((e) => e.id === id);
      if (s) {
        s.status = status;
        return this.save();
      }
    }
    throw new NotFoundError('Sugestão não encontrada.');
  }
}

let idSeq = 0;
const newId = () => `${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/**
 * Uma conversa: envia a pergunta, executa as ferramentas que o modelo pedir e repete
 * até ele terminar. Os eventos vão para a tela por `emit` (streaming).
 */
export class ChatEngine {
  #busy = false;

  /**
   * @param {object} deps
   * @param {ChatStore} deps.store
   * @param {() => Promise<import('./tools.js').ToolContext>} deps.toolContext
   * @param {() => Promise<object | null>} deps.flow
   * @param {typeof providerFor} [deps.providerFactory] troca o provedor (usado nos testes)
   */
  constructor({ store, toolContext, flow, providerFactory = providerFor }) {
    this.store = store;
    this.toolContext = toolContext;
    this.flow = flow;
    this.providerFactory = providerFactory;
  }

  get busy() {
    return this.#busy;
  }

  /**
   * @param {{ text: string, context?: object, provider?: string, model?: string }} input
   * @param {(event: object) => void} emit
   * @param {AbortSignal} signal
   */
  async run(input, emit, signal) {
    if (this.#busy) throw new AppError('Já existe uma resposta em andamento.', 409);
    if (typeof input.text !== 'string' || !input.text.trim()) throw new ValidationError('Mensagem vazia.');
    if (input.text.length > MAX_MESSAGE) throw new ValidationError('Mensagem longa demais.');
    this.#busy = true;

    const { messages, display } = this.store.state;
    const userItem = { id: newId(), role: 'user', text: input.text, context: summarizeContext(input.context) };
    const reply = { id: newId(), role: 'assistant', text: '', tools: [], events: [], status: 'streaming' };
    display.push(userItem, reply);
    emit({ type: 'start', user: userItem, reply: { id: reply.id } });

    try {
      const { provider, needsModel } = await this.providerFactory(input.provider, input.model);
      if (needsModel) throw new LlmError('Escolha um modelo para este provedor no seletor do chat.', 400);
      reply.provider = provider.id;
      reply.model = provider.model;
      emit({ type: 'model', provider: provider.id, model: provider.model });

      messages.push({ role: 'user', text: userMessage(input.text, input.context) });
      const ctx = await this.toolContext();
      const forward = (event) => {
        reply.events.push(event);
        emit(event);
      };
      const toolCtx = { ...ctx, emit: forward };
      const system = systemPrompt(ctx.review, await this.flow().catch(() => null));

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let end = null;
        for await (const ev of provider.stream({ system, messages, tools: TOOLS, signal })) {
          if (ev.type === 'text') {
            reply.text += ev.delta;
            emit({ type: 'text', delta: ev.delta });
          } else if (ev.type === 'end') {
            end = ev;
          }
        }
        if (!end) throw new LlmError('O provedor encerrou a resposta sem concluir.');

        if (end.stopReason === 'refusal') {
          messages.push({ role: 'assistant', provider: provider.id, text: '[O modelo recusou responder a esta mensagem.]', toolCalls: [], raw: null });
          reply.status = 'refused';
          emit({ type: 'refused' });
          break;
        }

        messages.push({ role: 'assistant', provider: provider.id, text: end.text, toolCalls: end.toolCalls, raw: end.raw });
        if (end.stopReason !== 'tool_use' || !end.toolCalls.length) {
          if (end.stopReason === 'max_tokens') emit({ type: 'notice', message: 'A resposta atingiu o limite de tamanho.' });
          reply.status = 'done';
          break;
        }

        // Executa as ferramentas pedidas e devolve todos os resultados de uma vez.
        const results = [];
        for (const call of end.toolCalls) {
          const summary = summarizeCall(call);
          emit({ type: 'tool', name: call.name, summary });
          const r = await runTool(toolCtx, call.name, call.input);
          reply.tools.push({ name: call.name, summary, isError: r.isError });
          emit({ type: 'tool_done', name: call.name, isError: r.isError });
          results.push({ id: call.id, nativeId: call.nativeId, name: call.name, content: r.content, isError: r.isError });
        }
        messages.push({ role: 'tool', provider: provider.id, results });
        if (signal.aborted) throw new LlmError('Cancelado.', 499);
        if (round === MAX_TOOL_ROUNDS - 1) {
          emit({ type: 'notice', message: 'Parei depois de muitas etapas com ferramentas. Peça para continuar se precisar.' });
          reply.status = 'done';
        }
      }
    } catch (err) {
      const cancelled = signal.aborted || (err instanceof LlmError && err.status === 499);
      closeDanglingToolCalls(messages);
      // Sem resposta do modelo, a pergunta sai do histórico enviado (pode ser reenviada).
      const last = messages[messages.length - 1];
      if (last?.role === 'user') messages.pop();
      reply.status = cancelled ? 'cancelled' : 'error';
      reply.error = cancelled ? 'Cancelado.' : err instanceof AppError ? err.message : `Erro inesperado: ${err.message}`;
      if (!cancelled && !(err instanceof AppError)) console.error(err);
      emit({ type: 'error', message: reply.error, cancelled });
    } finally {
      this.#busy = false;
      await this.store.save().catch(() => undefined);
      emit({ type: 'done', status: reply.status });
    }
  }
}

function summarizeContext(ctx) {
  if (!ctx?.path) return null;
  return { path: ctx.path, side: ctx.side ?? 'new', startLine: ctx.startLine ?? null, endLine: ctx.endLine ?? null };
}

function summarizeCall(call) {
  const i = call.input ?? {};
  const parts = [i.path, i.symbol, i.pattern && `"${i.pattern}"`, i.start_line && `L${i.start_line}${i.end_line ? `–${i.end_line}` : ''}`, i.line && `L${i.line}`].filter(Boolean);
  return parts.join(' ');
}
