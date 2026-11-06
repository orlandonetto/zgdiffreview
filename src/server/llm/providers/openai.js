import OpenAI from 'openai';
import { historyFor } from '../history.js';
import { LlmError } from '../errors.js';

/** Modelos da lista que não servem para chat (embeddings, áudio, imagem...). */
const NOT_CHAT = /embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|davinci|babbage|codex-mini/i;

/**
 * @param {{ apiKey: string | null, model: string, effort: string }} opts
 */
export function createOpenAIProvider({ apiKey, model, effort }) {
  if (!apiKey) throw new LlmError('Configure a chave da OpenAI (OPENAI_API_KEY ou zgdiff config set-key openai).', 401);
  const client = new OpenAI({ apiKey });

  return {
    id: 'openai',
    model,

    async listModels() {
      const ids = [];
      try {
        for await (const m of client.models.list()) if (!NOT_CHAT.test(m.id)) ids.push(m.id);
      } catch (err) {
        throw toLlmError(err);
      }
      return ids.sort();
    },

    async *stream({ system, messages, tools, signal }) {
      const params = {
        model,
        messages: [{ role: 'system', content: system }, ...toOpenAI(historyFor('openai', messages))],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
        stream: true,
        stream_options: { include_usage: true },
      };
      // Modelos de raciocínio (o*, gpt-5*) aceitam reasoning_effort.
      if (/^(o\d|gpt-5)/.test(model)) params.reasoning_effort = effort;

      let text = '';
      let finish = null;
      const calls = new Map();
      try {
        const stream = await client.chat.completions.create(params, { signal });
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};
          if (delta.content) {
            text += delta.content;
            yield { type: 'text', delta: delta.content };
          }
          for (const tc of delta.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(tc.index, cur);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
      } catch (err) {
        throw toLlmError(err);
      }

      if (finish === 'content_filter') {
        yield { type: 'end', stopReason: 'refusal', text: '', toolCalls: [], raw: null };
        return;
      }
      const toolCalls = [...calls.values()].map((c, k) => ({ id: c.id || `call_${k}`, name: c.name, input: parseArgs(c.args) }));
      const stopReason = toolCalls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end';
      yield { type: 'end', stopReason, text, toolCalls, raw: null };
    },
  };
}

function parseArgs(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { __invalid_json: raw };
  }
}

function toOpenAI(items) {
  const out = [];
  for (const it of items) {
    if (!it.native) {
      out.push({ role: it.role, content: it.text });
      continue;
    }
    const m = it.native;
    if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } }));
      }
      out.push(msg);
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}

function toLlmError(err) {
  if (err instanceof OpenAI.AuthenticationError) return new LlmError('Chave da OpenAI inválida ou ausente.', 401);
  if (err instanceof OpenAI.PermissionDeniedError) return new LlmError('A chave da OpenAI não tem acesso a este modelo.', 403);
  if (err instanceof OpenAI.NotFoundError) return new LlmError('Modelo não encontrado na OpenAI.', 404);
  if (err instanceof OpenAI.RateLimitError) return new LlmError('Limite de uso da OpenAI atingido. Tente de novo em instantes.', 429);
  if (err instanceof OpenAI.BadRequestError) return new LlmError(`Requisição recusada pela OpenAI: ${err.message}`, 400);
  if (err instanceof OpenAI.APIUserAbortError) return new LlmError('Cancelado.', 499);
  if (err instanceof OpenAI.APIConnectionError) return new LlmError('Sem conexão com a API da OpenAI.', 502);
  if (err instanceof OpenAI.APIError) return new LlmError(`Erro da OpenAI (${err.status}): ${err.message}`, 502);
  return err;
}
