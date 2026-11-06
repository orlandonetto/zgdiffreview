import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../web/src/lib/markdown.js';
import { ChatEngine, ChatStore } from '../src/server/llm/chat.js';
import { getApiKey, loadConfig, setApiKey, updateConfig } from '../src/server/llm/config.js';
import { closeDanglingToolCalls, historyFor } from '../src/server/llm/history.js';
import { patchText, runTool, validateInput } from '../src/server/llm/tools.js';

let home;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'zgdiff-test-'));
  process.env.ZGDIFF_HOME = home;
});
afterAll(async () => {
  delete process.env.ZGDIFF_HOME;
  await rm(home, { recursive: true, force: true });
});

describe('configuração', () => {
  it('padrão é Anthropic com Sonnet 5.5; valida e grava mudanças', async () => {
    const cfg = await loadConfig();
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.models.anthropic).toBe('claude-sonnet-5-5');
    await updateConfig({ provider: 'gemini', model: 'gemini-x', effort: 'low' });
    const after = await loadConfig();
    expect(after).toMatchObject({ provider: 'gemini', effort: 'low' });
    expect(after.models.gemini).toBe('gemini-x');
    await expect(updateConfig({ provider: 'outro' })).rejects.toThrow('Provedor inválido');
    await expect(updateConfig({ effort: 'max' })).rejects.toThrow('Esforço inválido');
  });

  it('chave gravada com permissão 600; variável de ambiente tem prioridade', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await setApiKey('openai', 'sk-arquivo');
    expect(await getApiKey('openai')).toBe('sk-arquivo');
    expect((await stat(join(home, 'credentials.json'))).mode & 0o777).toBe(0o600);
    process.env.OPENAI_API_KEY = 'sk-env';
    expect(await getApiKey('openai')).toBe('sk-env');
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });
});

describe('historyFor', () => {
  const msgs = [
    { role: 'user', text: 'oi' },
    { role: 'assistant', provider: 'openai', text: 'vou ver', toolCalls: [{ id: 'c1', name: 'list_changed_files', input: {} }], raw: null },
    { role: 'tool', provider: 'openai', results: [{ id: 'c1', name: 'list_changed_files', content: 'M a.js', isError: false }] },
    { role: 'assistant', provider: 'openai', text: 'pronto', toolCalls: [], raw: null },
    { role: 'user', text: 'e agora?' },
  ];

  it('mantém nativo para o mesmo provedor', () => {
    const h = historyFor('openai', msgs);
    expect(h.map((x) => (x.native ? `${x.role}:native` : `${x.role}:text`))).toEqual([
      'user:text',
      'assistant:native',
      'user:native',
      'assistant:native',
      'user:text',
    ]);
  });

  it('vira texto para outro provedor e une mensagens de usuário seguidas', () => {
    const h = historyFor('anthropic', msgs);
    expect(h.every((x) => !x.native)).toBe(true);
    expect(h.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(h[1].text).toContain('list_changed_files');
    expect(h[2].text).toContain('M a.js');
  });

  it('closeDanglingToolCalls fecha chamadas sem resultado', () => {
    const m = [{ role: 'assistant', provider: 'x', text: '', toolCalls: [{ id: 'a', name: 't', input: {} }] }];
    closeDanglingToolCalls(m);
    expect(m[1]).toMatchObject({ role: 'tool', results: [{ id: 'a', isError: true }] });
  });
});

const review = {
  repoName: 'r',
  base: 'develop',
  head: 'feat',
  baseSha: 'b'.repeat(40),
  headSha: 'h'.repeat(40),
  mergeBaseSha: 'm'.repeat(40),
  files: [
    {
      path: 'src/a.js',
      oldPath: 'src/a.js',
      newPath: 'src/a.js',
      status: 'modified',
      binary: false,
      additions: 1,
      deletions: 1,
      patchHash: '1',
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, section: '', lines: [{ type: 'del', content: 'x', oldNo: 1 }, { type: 'add', content: 'y', newNo: 1 }] }],
    },
  ],
};
const snap = (files) => ({
  text: async (p) => files[p] ?? null,
  has: async (p) => p in files,
  grep: async () => [{ path: 'src/a.js', line: 1, text: 'y' }],
});

describe('ferramentas', () => {
  const events = [];
  const ctx = {
    review,
    head: snap({ 'src/a.js': 'y\nz' }),
    base: snap({ 'src/a.js': 'x\nz' }),
    flow: async () => ({ method: 'layers', entries: [], files: [] }),
    finder: null,
    comments: () => [],
    emit: (e) => events.push(e),
  };

  it('valida entrada contra o schema', () => {
    expect(validateInput('get_file_diff', {})).toMatch('obrigatório');
    expect(validateInput('get_file_content', { path: 'a', start_line: 0 })).toMatch('inteiro');
    expect(validateInput('get_file_content', { path: 'a', side: 'meio' })).toMatch('um de');
    expect(validateInput('get_file_diff', { path: 'a', extra: 1 })).toMatch('desconhecido');
    expect(validateInput('nao_existe', {})).toMatch('desconhecida');
    expect(validateInput('get_file_diff', { path: 'a' })).toBeNull();
  });

  it('get_file_diff e get_file_content leem só o review', async () => {
    expect((await runTool(ctx, 'get_file_diff', { path: 'src/a.js' })).content).toContain('-x\n+y');
    expect((await runTool(ctx, 'get_file_diff', { path: 'outro.js' })).isError).toBe(true);
    expect((await runTool(ctx, 'get_file_content', { path: 'src/a.js', side: 'old' })).content).toContain('    1  x');
    expect(patchText(review.files[0])).toMatch(/^--- src\/a.js/);
  });

  it('propose_comment só emite sugestão (não grava) e valida linhas', async () => {
    const r = await runTool(ctx, 'propose_comment', { path: 'src/a.js', start_line: 1, end_line: 1, body: 'Por quê?' });
    expect(r.isError).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'suggestion', kind: 'comment', comment: { path: 'src/a.js', snippet: 'y', body: 'Por quê?' } });
    expect((await runTool(ctx, 'propose_comment', { path: 'src/a.js', start_line: 1, end_line: 9, body: 'x' })).isError).toBe(true);
  });

  it('propose_order completa a lista com arquivos que faltaram', async () => {
    await runTool(ctx, 'propose_order', { paths: ['inexistente.js'], rationale: 'r' });
    expect(events.at(-1)).toMatchObject({ kind: 'order', paths: ['src/a.js'] });
  });
});

describe('ChatEngine com provedor falso', () => {
  it('executa a ferramenta pedida, devolve o resultado e termina', async () => {
    const store = new ChatStore(join(home, 'review.json'));
    let calls = 0;
    const seen = [];
    const fake = {
      id: 'fake',
      model: 'm1',
      async *stream({ messages }) {
        seen.push(messages.map((m) => m.role).join(','));
        calls++;
        if (calls === 1) {
          yield { type: 'text', delta: 'Vou olhar. ' };
          yield { type: 'end', stopReason: 'tool_use', text: 'Vou olhar. ', toolCalls: [{ id: 't1', name: 'list_changed_files', input: {} }], raw: null };
        } else {
          yield { type: 'text', delta: 'Mudou src/a.js.' };
          yield { type: 'end', stopReason: 'end', text: 'Mudou src/a.js.', toolCalls: [], raw: null };
        }
      },
    };
    const engine = new ChatEngine({
      store,
      flow: async () => null,
      toolContext: async () => ({ review, head: snap({}), base: snap({}), flow: async () => null, finder: null, comments: () => [] }),
      providerFactory: async () => ({ provider: fake, needsModel: false }),
    });
    const events = [];
    await engine.run({ text: 'O que mudou?' }, (e) => events.push(e), new AbortController().signal);

    expect(seen).toEqual(['user', 'user,assistant,tool']);
    expect(events.map((e) => e.type)).toEqual(['start', 'model', 'text', 'tool', 'tool_done', 'text', 'done']);
    const [, reply] = store.state.display;
    expect(reply).toMatchObject({ role: 'assistant', text: 'Vou olhar. Mudou src/a.js.', status: 'done', provider: 'fake' });
    const saved = JSON.parse(await readFile(join(home, 'review.chat.json'), 'utf8'));
    expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('erro do provedor vira evento de erro e a pergunta sai do histórico', async () => {
    const store = new ChatStore(join(home, 'review2.json'));
    const engine = new ChatEngine({
      store,
      flow: async () => null,
      toolContext: async () => ({ review, head: snap({}), base: snap({}), flow: async () => null, finder: null, comments: () => [] }),
      providerFactory: async () => ({
        provider: {
          id: 'fake',
          model: 'm',
          // eslint-disable-next-line require-yield
          async *stream() {
            throw new Error('falhou');
          },
        },
        needsModel: false,
      }),
    });
    const events = [];
    await engine.run({ text: 'oi' }, (e) => events.push(e), new AbortController().signal);
    expect(events.find((e) => e.type === 'error').message).toContain('falhou');
    expect(store.state.messages).toEqual([]);
  });
});

describe('renderMarkdown', () => {
  it('escapa HTML e cria links para arquivo:linha', () => {
    const html = renderMarkdown('Veja `src/a.js:12` e src/b.ts:3 <script>x</script>\n```js\nconst a = "<b>";\n```');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data-path="src/a.js" data-line="12"');
    expect(html).toContain('data-path="src/b.ts" data-line="3"');
    expect(html).toContain('&lt;b&gt;');
  });
});
