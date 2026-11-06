import { orderFlow } from '../../shared/flow-order.js';

/**
 * Instruções do assistente. O texto fixo vem primeiro e o resumo do review depois:
 * os dois não mudam durante a sessão, então o início da conversa é reaproveitado pelo cache.
 */
const BASE = `Você é o assistente de code review do zgdiff. O revisor está analisando, no navegador, as mudanças de uma branch em relação à base (o mesmo que uma pull request mostraria). Ajude-o a entender e revisar essas mudanças.

Como trabalhar:
- Use as ferramentas para ler diffs, arquivos e buscar no código antes de afirmar algo sobre ele. Não invente conteúdo de arquivos.
- Ao citar código, indique arquivo e linha (ex.: src/app.js:42). Para levar o revisor a um ponto específico, use show_location.
- Só use propose_comment quando o revisor pedir comentários ou quando você encontrar um problema concreto; cada comentário deve ser específico e acionável.
- Para sugerir ordem de leitura, use propose_order com todos os arquivos alterados.
- "versão nova" é a branch; "versão antiga" é a base. Linhas são numeradas a partir de 1.
- Responda no idioma do revisor (normalmente português), de forma direta. Use Markdown simples (listas, \`código\`, blocos de código).
- Mensagens podem trazer um bloco "Contexto da tela" com o arquivo e o trecho que o revisor está olhando; use-o para entender a pergunta.`;

/**
 * @param {import('../../shared/types.js').ReviewInfo} review
 * @param {import('../../shared/flow-order.js').FlowInfo | null} flow
 */
export function systemPrompt(review, flow) {
  const files = review.files.map((f) => `- ${f.status} ${f.path} (+${f.additions} −${f.deletions})`).join('\n');
  let order = '';
  if (flow) {
    order = `\n\nOrdem de revisão calculada (modo Fluxo, ${flow.method === 'imports' ? `a partir de ${flow.entries.join(', ')}` : 'por camadas'}):\n${orderFlow(flow)
      .map((s) => `${s.step}. ${s.path}`)
      .join('\n')}`;
  }
  return `${BASE}

Review atual:
- Repositório: ${review.repoName}
- Branch: ${review.head} (${review.headSha.slice(0, 10)})
- Base: ${review.base} (ponto de saída ${review.mergeBaseSha.slice(0, 10)})
- ${review.files.length} arquivo(s) alterado(s):
${files}${order}`;
}

/** Junta a pergunta com o contexto da tela (arquivo/linhas selecionadas). */
export function userMessage(text, context) {
  if (!context?.path) return text;
  const where = context.startLine
    ? `${context.path}, linhas ${context.startLine}–${context.endLine ?? context.startLine} (${context.side === 'old' ? 'versão antiga' : 'versão nova'})`
    : `${context.path}`;
  const snippet = context.snippet ? `\n\`\`\`\n${context.snippet.slice(0, 8000)}\n\`\`\`` : '';
  return `${text}\n\n[Contexto da tela: ${where}]${snippet}`;
}
