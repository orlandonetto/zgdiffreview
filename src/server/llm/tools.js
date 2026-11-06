import { orderFlow } from '../../shared/flow-order.js';

/**
 * Ferramentas que o modelo pode chamar. Todas leem só os dois commits do review;
 * as que "fazem" algo (propose_*, show_location) apenas enviam uma sugestão para a tela —
 * quem decide é você.
 *
 * @typedef {object} ToolContext
 * @property {import('../../shared/types.js').ReviewInfo} review
 * @property {import('../repo.js').Snapshot} head
 * @property {import('../repo.js').Snapshot} base
 * @property {() => Promise<import('../../shared/flow-order.js').FlowInfo>} flow
 * @property {import('../definition/index.js').DefinitionFinder} finder
 * @property {() => import('../../shared/types.js').ReviewComment[]} comments
 * @property {(event: object) => void} emit evento para a interface
 */

const MAX_RESULT_CHARS = 60_000;
const MAX_LINES_PER_READ = 800;

const side = { type: 'string', enum: ['new', 'old'], description: '"new" = versão da branch (padrão); "old" = versão da base, antes da mudança.' };

export const TOOLS = [
  {
    name: 'list_changed_files',
    description: 'Lista os arquivos alterados no review, com status (A adicionado, M modificado, D removido, R renomeado) e linhas +/−.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_review_flow',
    description: 'Ordem de revisão calculada pelo zgdiff (modo Fluxo): arquivos do ponto de entrada da aplicação para dentro, com a camada e o caminho de imports até cada um.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_file_diff',
    description: 'Diff unificado de um arquivo alterado no review.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Caminho do arquivo, como em list_changed_files.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_file_content',
    description: `Conteúdo de qualquer arquivo versionado do repositório, numerado, na versão nova ou antiga. Até ${MAX_LINES_PER_READ} linhas por chamada; use start_line/end_line para arquivos grandes.`,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        side,
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_code',
    description: 'Busca no repositório (git grep, expressão regular estendida POSIX). Útil para achar quem chama uma função ou onde algo é usado.',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expressão regular estendida (ERE). Para texto literal, escape os caracteres especiais.' },
        side,
        ignore_case: { type: 'boolean' },
        path_prefix: { type: 'string', description: 'Opcional: limita a busca a uma pasta, ex.: "src/services".' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_definition',
    description: 'Encontra onde um símbolo usado num arquivo é definido (mesmo mecanismo do ⌘+clique: TypeScript language service e, se não achar, heurística).',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        symbol: { type: 'string', description: 'Nome do símbolo que aparece nessa linha.' },
        side,
      },
      required: ['path', 'line', 'symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_review_comments',
    description: 'Comentários que o revisor já escreveu neste review.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_comment',
    description: 'Sugere um comentário de review em linhas de um arquivo alterado. Aparece para o revisor, que decide se aceita. Use só quando ele pedir comentários ou quando encontrar um problema concreto.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        side,
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
        body: { type: 'string', description: 'Texto do comentário, claro e acionável, no idioma do revisor.' },
      },
      required: ['path', 'start_line', 'end_line', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_order',
    description: 'Sugere uma ordem de revisão para os arquivos alterados. Aparece como "Fluxo (IA)" para o revisor aceitar.',
    schema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Todos os arquivos alterados, na ordem sugerida.' },
        rationale: { type: 'string', description: 'Por que esta ordem, em poucas linhas.' },
      },
      required: ['paths', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_location',
    description: 'Mostra ao revisor um link clicável para um arquivo e linha (por exemplo, onde algo é definido).',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, side, label: { type: 'string' } },
      required: ['path', 'line'],
      additionalProperties: false,
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Validação simples contra o schema (tipos, obrigatórios, enum, campos extras). */
export function validateInput(name, input) {
  const tool = BY_NAME.get(name);
  if (!tool) return `Ferramenta desconhecida: ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'A entrada deve ser um objeto JSON.';
  if ('__invalid_json' in input) return 'JSON inválido nos argumentos.';
  const { properties, required = [] } = tool.schema;
  for (const r of required) if (input[r] === undefined) return `Campo obrigatório ausente: ${r}`;
  for (const [k, v] of Object.entries(input)) {
    const p = properties[k];
    if (!p) return `Campo desconhecido: ${k}`;
    if (p.type === 'string' && typeof v !== 'string') return `"${k}" deve ser texto.`;
    if (p.type === 'integer' && (!Number.isInteger(v) || v < (p.minimum ?? -Infinity))) return `"${k}" deve ser um inteiro${p.minimum ? ` ≥ ${p.minimum}` : ''}.`;
    if (p.type === 'boolean' && typeof v !== 'boolean') return `"${k}" deve ser booleano.`;
    if (p.type === 'array' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) return `"${k}" deve ser uma lista de textos.`;
    if (p.enum && !p.enum.includes(v)) return `"${k}" deve ser um de: ${p.enum.join(', ')}.`;
  }
  return null;
}

const STATUS_LETTER = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' };

function cap(text) {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[Resultado cortado em ${MAX_RESULT_CHARS} caracteres: peça um trecho menor.]`;
}

export function patchText(file) {
  const out = [`--- ${file.oldPath ?? '/dev/null'}`, `+++ ${file.newPath ?? '/dev/null'}`];
  if (file.binary) out.push('(arquivo binário)');
  for (const h of file.hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ ${h.section}`.trimEnd());
    for (const l of h.lines) out.push(`${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${l.content}`);
  }
  if (!file.hunks.length && !file.binary) out.push('(sem mudanças de conteúdo)');
  return out.join('\n');
}

function changedFile(ctx, path) {
  const f = ctx.review.files.find((x) => x.path === path || x.oldPath === path || x.newPath === path);
  if (!f) throw new ToolInputError(`Arquivo não está no review: ${path}. Use list_changed_files.`);
  return f;
}

class ToolInputError extends Error {}

/**
 * Executa uma ferramenta. Erros de entrada voltam como resultado de erro (o modelo corrige e tenta de novo).
 * @param {ToolContext} ctx
 * @returns {Promise<{ content: string, isError: boolean }>}
 */
export async function runTool(ctx, name, input) {
  const invalid = validateInput(name, input);
  if (invalid) return { content: invalid, isError: true };
  try {
    return { content: cap(await execute(ctx, name, input)), isError: false };
  } catch (err) {
    if (err instanceof ToolInputError) return { content: err.message, isError: true };
    return { content: `Falha ao executar ${name}: ${err.message}`, isError: true };
  }
}

async function execute(ctx, name, input) {
  const snapOf = (s) => (s === 'old' ? ctx.base : ctx.head);
  switch (name) {
    case 'list_changed_files':
      return ctx.review.files
        .map((f) => `${STATUS_LETTER[f.status]} ${f.oldPath && f.newPath && f.oldPath !== f.newPath ? `${f.oldPath} -> ` : ''}${f.path} (+${f.additions} −${f.deletions})`)
        .join('\n');

    case 'get_review_flow': {
      const flow = await ctx.flow();
      const byPath = new Map(flow.files.map((f) => [f.path, f]));
      const lines = [`Método: ${flow.method === 'imports' ? `grafo de imports a partir de ${flow.entries.join(', ')}` : 'camadas (sem entrada detectada)'}`];
      for (const s of orderFlow(flow)) {
        const f = byPath.get(s.path);
        lines.push(`${s.step}. ${s.nested ? '(teste) ' : ''}${s.path} [${f.layer.label}]${f.chain.length > 1 ? ` via ${f.chain.join(' → ')}` : ''} {grupo: ${s.group}}`);
      }
      return lines.join('\n');
    }

    case 'get_file_diff':
      return patchText(changedFile(ctx, input.path));

    case 'get_file_content': {
      const snap = snapOf(input.side);
      const text = await snap.text(input.path);
      if (text === null) throw new ToolInputError(`Arquivo não encontrado (ou binário) na versão ${input.side ?? 'new'}: ${input.path}`);
      const lines = text.split('\n');
      const start = input.start_line ?? 1;
      const end = Math.min(input.end_line ?? start + MAX_LINES_PER_READ - 1, start + MAX_LINES_PER_READ - 1, lines.length);
      const body = lines.slice(start - 1, end).map((l, k) => `${String(start + k).padStart(5)}  ${l}`);
      const more = end < lines.length ? `\n[Arquivo tem ${lines.length} linhas; mostradas ${start}–${end}.]` : '';
      return `${input.path} (${input.side === 'old' ? 'versão antiga' : 'versão nova'})\n${body.join('\n')}${more}`;
    }

    case 'search_code': {
      if (input.pattern.length > 300) throw new ToolInputError('Padrão longo demais.');
      const paths = input.path_prefix ? [input.path_prefix.replace(/^\/+/, '')] : [];
      const hits = await snapOf(input.side).grep(input.pattern, { ignoreCase: input.ignore_case, limit: 150, paths });
      if (!hits.length) return 'Nenhum resultado.';
      return hits.map((h) => `${h.path}:${h.line}: ${h.text.trim().slice(0, 240)}`).join('\n') + (hits.length >= 150 ? '\n[Mais resultados omitidos: refine o padrão.]' : '');
    }

    case 'find_definition': {
      const snap = snapOf(input.side);
      const text = await snap.text(input.path);
      if (text === null) throw new ToolInputError(`Arquivo não encontrado: ${input.path}`);
      const lineText = text.split('\n')[input.line - 1] ?? '';
      const col = findWord(lineText, input.symbol);
      if (col === -1) throw new ToolInputError(`"${input.symbol}" não aparece na linha ${input.line} de ${input.path}.`);
      const r = await ctx.finder.find(snap, input.path, input.line, col);
      if (!r.candidates.length) return 'Definição não encontrada pelo TypeScript nem pela heurística. Tente search_code.';
      return `Encontrado via ${r.method}:\n${r.candidates.map((c) => `${c.path}:${c.line}: ${c.text.trim()}`).join('\n')}`;
    }

    case 'get_review_comments': {
      const list = ctx.comments();
      if (!list.length) return 'Nenhum comentário ainda.';
      return list.map((c) => `${c.path}:${c.startLine}-${c.endLine} (${c.side === 'new' ? 'nova' : 'antiga'}): ${c.body}`).join('\n');
    }

    case 'propose_comment': {
      const f = changedFile(ctx, input.path);
      const s = input.side ?? 'new';
      if (input.end_line < input.start_line) throw new ToolInputError('end_line não pode ser menor que start_line.');
      if (s === 'new' && !f.newPath) throw new ToolInputError('Arquivo removido: use side "old".');
      const snap = snapOf(s);
      const text = (await snap.text(s === 'new' ? f.newPath : f.oldPath)) ?? '';
      const lines = text.split('\n');
      if (input.end_line > lines.length) throw new ToolInputError(`O arquivo tem ${lines.length} linhas.`);
      ctx.emit({
        type: 'suggestion',
        kind: 'comment',
        id: cryptoId(),
        comment: {
          path: f.path,
          side: s,
          startLine: input.start_line,
          endLine: input.end_line,
          snippet: lines.slice(input.start_line - 1, input.end_line).join('\n'),
          body: input.body,
        },
      });
      return 'Sugestão enviada ao revisor (ele decide se aceita).';
    }

    case 'propose_order': {
      const all = new Set(ctx.review.files.map((f) => f.path));
      const seen = new Set();
      const paths = [];
      for (const p of input.paths) {
        if (all.has(p) && !seen.has(p)) {
          seen.add(p);
          paths.push(p);
        }
      }
      const missing = [...all].filter((p) => !seen.has(p));
      paths.push(...missing);
      ctx.emit({ type: 'suggestion', kind: 'order', id: cryptoId(), paths, rationale: input.rationale });
      return `Ordem enviada ao revisor${missing.length ? ` (${missing.length} arquivo(s) que faltavam foram colocados no fim)` : ''}.`;
    }

    case 'show_location': {
      const s = input.side ?? 'new';
      if (!(await snapOf(s).has(input.path))) throw new ToolInputError(`Arquivo não existe na versão ${s}: ${input.path}`);
      ctx.emit({ type: 'location', path: input.path, line: input.line, side: s, label: input.label ?? `${input.path}:${input.line}` });
      return 'Link mostrado ao revisor.';
    }
  }
  throw new ToolInputError(`Ferramenta desconhecida: ${name}`);
}

function findWord(line, word) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_$])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_$])`, 'u');
  const m = re.exec(line);
  return m ? m.index : -1;
}

let seq = 0;
function cryptoId() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}
