/**
 * Formato interno das mensagens do chat, independente de provedor:
 *
 *   { role: 'user', text }
 *   { role: 'assistant', provider, text, toolCalls: [{ id, name, input, nativeId? }], raw }
 *   { role: 'tool', provider, results: [{ id, name, content, isError, nativeId? }] }
 *
 * `raw` guarda o conteúdo nativo da resposta (blocos de raciocínio, assinaturas etc.), que
 * alguns provedores exigem de volta sem alteração. Ele só é reenviado ao mesmo provedor.
 */

const MAX_FOREIGN_RESULT = 4000;

/**
 * Prepara o histórico para um provedor: mensagens do próprio provedor seguem no formato
 * nativo; mensagens de outro provedor (quando você troca no meio da conversa) viram texto.
 * Mensagens de usuário seguidas são unidas.
 *
 * @returns {Array<{ role: 'user' | 'assistant', text?: string, native?: object }>}
 */
export function historyFor(provider, messages) {
  const out = [];
  const push = (item) => {
    const last = out[out.length - 1];
    if (last && !last.native && !item.native && last.role === item.role) {
      last.text = `${last.text}\n\n${item.text}`;
      return;
    }
    out.push(item);
  };
  for (const m of messages) {
    if (m.role === 'user') {
      push({ role: 'user', text: m.text });
    } else if (m.role === 'assistant') {
      if (m.provider === provider) {
        out.push({ role: 'assistant', native: m });
      } else {
        const calls = m.toolCalls?.length ? `\n\n[Ferramentas usadas: ${m.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join(', ')}]` : '';
        const text = `${m.text ?? ''}${calls}`.trim();
        if (text) push({ role: 'assistant', text });
      }
    } else if (m.role === 'tool') {
      if (m.provider === provider) {
        out.push({ role: 'user', native: m });
      } else {
        const body = m.results
          .map((r) => {
            const content = r.content.length > MAX_FOREIGN_RESULT ? `${r.content.slice(0, MAX_FOREIGN_RESULT)}\n[… resultado resumido]` : r.content;
            return `Resultado de ${r.name}${r.isError ? ' (erro)' : ''}:\n${content}`;
          })
          .join('\n\n');
        push({ role: 'user', text: `[Resultados de ferramentas de uma etapa anterior]\n${body}` });
      }
    }
  }
  return out;
}

/**
 * Depois de um cancelamento, garante que toda chamada de ferramenta tenha resultado
 * (os provedores recusam histórico com chamada sem resposta).
 */
export function closeDanglingToolCalls(messages) {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.toolCalls?.length) {
    messages.push({
      role: 'tool',
      provider: last.provider,
      results: last.toolCalls.map((c) => ({ id: c.id, nativeId: c.nativeId, name: c.name, content: 'Cancelado pelo usuário.', isError: true })),
    });
  }
}
