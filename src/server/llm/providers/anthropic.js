import Anthropic from '@anthropic-ai/sdk';
import { historyFor } from '../history.js';
import { LlmError } from '../errors.js';

/** Modelos que aceitam `output_config.effort` (Claude 4.6+ e família 5). */
const SUPPORTS_EFFORT = /^claude-(?:(?:opus|sonnet|fable|mythos)-(?:5|4-[6-9])|haiku-5)/;
/** Modelos com fallback de recusa no servidor (`fallbacks: "default"`). */
const SUPPORTS_FALLBACK = /^claude-(?:sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/;

/**
 * @param {{ apiKey: string | null, model: string, effort: string }} opts
 */
export function createAnthropicProvider({ apiKey, model, effort }) {
  // Sem chave explícita o SDK usa ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN ou o perfil do `ant auth login`.
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();

  return {
    id: 'anthropic',
    model,

    async listModels() {
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    },

    /**
     * @param {{ system: string, messages: object[], tools: object[], signal: AbortSignal }} req
     */
    async *stream({ system, messages, tools, signal }) {
      const params = {
        model,
        max_tokens: 64000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true })),
        messages: toAnthropic(historyFor('anthropic', messages)),
        // Cache automático do fim da conversa: cada rodada reaproveita a anterior.
        cache_control: { type: 'ephemeral' },
      };
      if (SUPPORTS_EFFORT.test(model)) params.output_config = { effort };
      if (SUPPORTS_FALLBACK.test(model)) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }

      let message;
      try {
        const stream = client.beta.messages.stream(params, { signal });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
        }
        message = await stream.finalMessage();
      } catch (err) {
        throw toLlmError(err);
      }

      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (message.stop_reason === 'refusal') {
        yield { type: 'end', stopReason: 'refusal', text: '', toolCalls: [], raw: null };
        return;
      }
      const toolCalls = message.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const stopReason = message.stop_reason === 'tool_use' ? 'tool_use' : message.stop_reason === 'max_tokens' ? 'max_tokens' : 'end';
      yield { type: 'end', stopReason, text, toolCalls, raw: message.content, usage: message.usage };
    },
  };
}

function toAnthropic(items) {
  return items.map((it) => {
    if (!it.native) return { role: it.role, content: it.text };
    const m = it.native;
    if (m.role === 'assistant') {
      if (m.raw) return { role: 'assistant', content: m.raw };
      const content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] };
    }
    return {
      role: 'user',
      content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })),
    };
  });
}

function toLlmError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new LlmError('Chave da Anthropic inválida ou ausente.', 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError('A chave da Anthropic não tem acesso a este modelo.', 403);
  if (err instanceof Anthropic.NotFoundError) return new LlmError('Modelo não encontrado na Anthropic.', 404);
  if (err instanceof Anthropic.RateLimitError) return new LlmError('Limite de uso da Anthropic atingido. Tente de novo em instantes.', 429);
  if (err instanceof Anthropic.BadRequestError) return new LlmError(`Requisição recusada pela Anthropic: ${err.message}`, 400);
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError('Cancelado.', 499);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('Sem conexão com a API da Anthropic.', 502);
  if (err instanceof Anthropic.APIError) return new LlmError(`Erro da Anthropic (${err.status}): ${err.message}`, 502);
  return err;
}
