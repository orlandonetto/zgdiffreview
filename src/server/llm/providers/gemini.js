import { ApiError, createPartFromFunctionResponse, GoogleGenAI } from '@google/genai';
import { historyFor } from '../history.js';
import { LlmError } from '../errors.js';

/**
 * @param {{ apiKey: string | null, model: string, vertex: { vertex: boolean, project: string | null, location: string } }} opts
 */
export function createGeminiProvider({ apiKey, model, vertex }) {
  let ai;
  if (vertex.vertex) {
    if (!vertex.project) throw new LlmError('Para usar o Vertex AI, configure o projeto: zgdiff config set gemini.project <projeto>', 400);
    // Autenticação pelo login do gcloud (Application Default Credentials).
    ai = new GoogleGenAI({ vertexai: true, project: vertex.project, location: vertex.location });
  } else {
    if (!apiKey) throw new LlmError('Configure a chave do Gemini (GEMINI_API_KEY ou zgdiff config set-key gemini).', 401);
    ai = new GoogleGenAI({ apiKey });
  }

  return {
    id: 'gemini',
    model,

    async listModels() {
      const ids = [];
      try {
        const pager = await ai.models.list();
        for await (const m of pager) {
          const actions = m.supportedActions ?? [];
          if (actions.length && !actions.includes('generateContent')) continue;
          const id = (m.name ?? '').replace(/^(publishers\/google\/)?models\//, '');
          if (id && /gemini/i.test(id)) ids.push(id);
        }
      } catch (err) {
        throw toLlmError(err);
      }
      return ids.sort();
    },

    async *stream({ system, messages, tools, signal }) {
      const contents = toGemini(historyFor('gemini', messages));
      const config = {
        systemInstruction: system,
        tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema })) }],
        abortSignal: signal,
      };

      let text = '';
      let finish = null;
      const parts = [];
      try {
        const stream = await ai.models.generateContentStream({ model, contents, config });
        for await (const chunk of stream) {
          const cand = chunk.candidates?.[0];
          for (const part of cand?.content?.parts ?? []) {
            parts.push(part);
            if (part.text && !part.thought) {
              text += part.text;
              yield { type: 'text', delta: part.text };
            }
          }
          if (cand?.finishReason) finish = cand.finishReason;
        }
      } catch (err) {
        throw toLlmError(err);
      }

      if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finish)) {
        yield { type: 'end', stopReason: 'refusal', text: '', toolCalls: [], raw: null };
        return;
      }
      const toolCalls = parts
        .filter((p) => p.functionCall)
        .map((p, k) => ({ id: p.functionCall.id ?? `gemini_${Date.now()}_${k}`, nativeId: p.functionCall.id ?? null, name: p.functionCall.name, input: p.functionCall.args ?? {} }));
      const stopReason = toolCalls.length ? 'tool_use' : finish === 'MAX_TOKENS' ? 'max_tokens' : 'end';
      // As partes originais (com thoughtSignature) precisam voltar sem alteração.
      yield { type: 'end', stopReason, text, toolCalls, raw: parts };
    },
  };
}

function toGemini(items) {
  return items.map((it) => {
    if (!it.native) return { role: it.role === 'assistant' ? 'model' : 'user', parts: [{ text: it.text }] };
    const m = it.native;
    if (m.role === 'assistant') {
      if (m.raw?.length) return { role: 'model', parts: m.raw };
      const parts = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { ...(c.nativeId ? { id: c.nativeId } : {}), name: c.name, args: c.input } });
      return { role: 'model', parts: parts.length ? parts : [{ text: '…' }] };
    }
    return {
      role: 'user',
      parts: m.results.map((r) =>
        createPartFromFunctionResponse(r.nativeId ?? undefined, r.name, r.isError ? { error: r.content } : { output: r.content }),
      ),
    };
  });
}

function toLlmError(err) {
  if (err?.name === 'AbortError') return new LlmError('Cancelado.', 499);
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return new LlmError('Credencial do Gemini inválida ou sem acesso a este modelo.', 401);
    if (err.status === 404) return new LlmError('Modelo não encontrado no Gemini.', 404);
    if (err.status === 429) return new LlmError('Limite de uso do Gemini atingido. Tente de novo em instantes.', 429);
    if (err.status === 400) return new LlmError(`Requisição recusada pelo Gemini: ${err.message}`, 400);
    return new LlmError(`Erro do Gemini (${err.status}): ${err.message}`, 502);
  }
  return err;
}
