import { DefinitionFinder } from './definition/index.js';
import { NotFoundError, ValidationError } from './errors.js';
import { computeFlow } from './flow/index.js';
import { ChatEngine, ChatStore, llmStatus, providerFor } from './llm/chat.js';
import { updateConfig } from './llm/config.js';
import { ReviewRepo } from './repo.js';

/** @typedef {import('../shared/types.js').ReviewInfo} ReviewInfo */

const MAX_PATH = 1000;

function intParam(url, name, min = 0) {
  const v = Number(url.searchParams.get(name));
  if (!Number.isInteger(v) || v < min) throw new ValidationError(`"${name}" deve ser um inteiro ≥ ${min}.`);
  return v;
}

function pathParam(v) {
  if (typeof v !== 'string' || !v || v.length > MAX_PATH || v.includes('\0')) throw new ValidationError('"path" inválido.');
  return v.replace(/^\/+/, '');
}

function sideParam(v) {
  if (v !== 'old' && v !== 'new') throw new ValidationError('"side" deve ser "old" ou "new".');
  return v;
}

function parseChatInput(body) {
  const ctx = body.context;
  let context = null;
  if (ctx && typeof ctx === 'object') {
    context = { path: pathParam(ctx.path), side: ctx.side === 'old' ? 'old' : 'new' };
    for (const k of ['startLine', 'endLine']) {
      if (ctx[k] !== undefined && ctx[k] !== null) {
        if (!Number.isInteger(ctx[k]) || ctx[k] < 1) throw new ValidationError(`"context.${k}" inválido.`);
        context[k] = ctx[k];
      }
    }
    if (typeof ctx.snippet === 'string') context.snippet = ctx.snippet.slice(0, 20_000);
  }
  const opt = (v, name) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || v.length > 120) throw new ValidationError(`"${name}" inválido.`);
    return v;
  };
  return { text: body.text, context, provider: opt(body.provider, 'provider'), model: opt(body.model, 'model') };
}

/**
 * Rotas do Fluxo, do "ir para a definição" e do chat.
 *
 * @param {{ root: string, store: import('./store.js').ReviewStore, current: () => Promise<ReviewInfo>, json: Function, readJson: Function }} deps
 */
export function createFeatures({ root, store, current, json, readJson }) {
  const repo = new ReviewRepo(root);
  const finder = new DefinitionFinder();
  const chatStore = new ChatStore(store.path);
  let flowCache = { key: null, promise: null };

  const snapshots = async () => {
    const review = await current();
    return { review, head: repo.snapshot(review.headSha), base: repo.snapshot(review.mergeBaseSha) };
  };
  const snapFor = async (side) => {
    const { head, base } = await snapshots();
    return side === 'old' ? base : head;
  };

  const flow = async () => {
    const { review, head, base } = await snapshots();
    const key = `${review.mergeBaseSha}..${review.headSha}`;
    if (flowCache.key !== key) {
      const promise = computeFlow(review, head, base);
      flowCache = { key, promise };
      promise.catch(() => {
        if (flowCache.promise === promise) flowCache = { key: null, promise: null };
      });
    }
    return flowCache.promise;
  };

  const engine = new ChatEngine({
    store: chatStore,
    flow,
    toolContext: async () => ({ ...(await snapshots()), flow, finder, comments: () => store.get().comments }),
  });

  return {
    async init() {
      await chatStore.load();
    },

    /** Chamado a cada review calculado: prepara Fluxo e TypeScript em segundo plano. */
    onReview(review) {
      finder.warmUp(repo.snapshot(review.headSha));
      flow().catch(() => undefined);
    },

    /** Rotas de leitura. Devolve true se tratou a requisição. */
    async read(method, path, url, res) {
      if (method !== 'GET') return false;

      if (path === '/api/flow') {
        json(res, 200, { flow: await flow() });
        return true;
      }

      if (path === '/api/definition') {
        const side = sideParam(url.searchParams.get('side'));
        const filePath = pathParam(url.searchParams.get('path'));
        const line = intParam(url, 'line', 1);
        const col = intParam(url, 'col', 0);
        const result = await finder.find(await snapFor(side), filePath, line, col);
        json(res, 200, { side, ...result });
        return true;
      }

      if (path === '/api/blob') {
        const side = sideParam(url.searchParams.get('side'));
        const filePath = pathParam(url.searchParams.get('path'));
        const snap = await snapFor(side);
        if (!(await snap.has(filePath))) throw new NotFoundError(`Arquivo não existe nesta versão: ${filePath}`);
        const text = await snap.text(filePath);
        if (text === null) throw new ValidationError('Arquivo binário ou grande demais para mostrar.');
        const lines = text.split('\n');
        if (lines.at(-1) === '') lines.pop();
        json(res, 200, { path: filePath, side, lines });
        return true;
      }

      if (path === '/api/llm/status') {
        json(res, 200, await llmStatus());
        return true;
      }

      if (path === '/api/llm/models') {
        const providerId = url.searchParams.get('provider') ?? undefined;
        const { provider } = await providerFor(providerId, 'listagem');
        json(res, 200, { provider: provider.id, models: await provider.listModels() });
        return true;
      }

      if (path === '/api/chat') {
        json(res, 200, { display: chatStore.state.display, busy: engine.busy });
        return true;
      }
      return false;
    },

    /** Rotas que alteram estado (já passaram pela checagem do cabeçalho da interface). */
    async write(method, path, req, res) {
      if (method === 'PUT' && path === '/api/llm/settings') {
        const body = await readJson(req);
        await updateConfig({
          provider: body.provider,
          model: body.model,
          modelProvider: body.modelProvider,
          effort: body.effort,
          autoDefinitionFallback: body.autoDefinitionFallback,
        });
        json(res, 200, await llmStatus());
        return true;
      }

      if (method === 'POST' && path === '/api/chat/reset') {
        if (engine.busy) throw new ValidationError('Espere a resposta atual terminar.');
        await chatStore.reset();
        json(res, 200, { display: [] });
        return true;
      }

      const sm = /^\/api\/chat\/suggestions\/([\w-]{1,64})$/.exec(path);
      if (sm && method === 'PATCH') {
        const body = await readJson(req);
        if (!['accepted', 'dismissed'].includes(body.status)) throw new ValidationError('"status" deve ser accepted ou dismissed.');
        await chatStore.setSuggestionStatus(sm[1], body.status);
        json(res, 200, { ok: true });
        return true;
      }

      if (method === 'POST' && path === '/api/chat') {
        const input = parseChatInput(await readJson(req));
        // Validações antes de abrir o stream, para o erro chegar como resposta HTTP normal.
        if (engine.busy) throw new ValidationError('Já existe uma resposta em andamento.');
        if (typeof input.text !== 'string' || !input.text.trim()) throw new ValidationError('Mensagem vazia.');
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) controller.abort();
        });
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const emit = (event) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        await engine.run(input, emit, controller.signal);
        res.end();
        return true;
      }
      return false;
    },

    close() {
      repo.close();
    },
  };
}
