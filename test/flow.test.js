import { describe, expect, it } from 'vitest';
import { orderFlow } from '../src/shared/flow-order.js';
import { isTestFile, layerOf, testTarget } from '../src/server/flow/classify.js';
import { findEntries } from '../src/server/flow/entries.js';
import { extractImports, stripComments } from '../src/server/flow/imports.js';
import { classifyKind } from '../src/server/flow/kind.js';
import { createResolver } from '../src/server/flow/resolve.js';

describe('extractImports', () => {
  it('lê import, export from, import(), require e ignora comentários', () => {
    const src = `
      import a from './a';
      import { b, c } from "../b";
      import * as d from '@/d';
      import './side-effect.css';
      export { e } from './e';
      export * from './f';
      const g = require('./g');
      const h = await import('./h');
      // import x from './comentado';
      /* require('./bloco') */
      const s = "import y from './string'";
    `;
    expect(extractImports(src).sort()).toEqual(['../b', './a', './e', './f', './g', './h', './side-effect.css', '@/d'].sort());
  });

  it('stripComments preserva posições e quebras de linha', () => {
    const src = 'a // x\n/* y\n z */b';
    const out = stripComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n')).toHaveLength(3);
    expect(out.trim().endsWith('b')).toBe(true);
  });
});

describe('createResolver', () => {
  const files = new Set(['src/app.js', 'src/routes/index.js', 'src/util.ts', 'src/comp/Card.vue', 'web/package.json', 'web/src/main.js', 'data.json']);
  const resolve = createResolver(files);

  it('resolve relativo com extensão implícita, index e .js apontando para .ts', () => {
    expect(resolve('src/server.js', './app')).toBe('src/app.js');
    expect(resolve('src/app.js', './routes')).toBe('src/routes/index.js');
    expect(resolve('src/app.js', './util.js')).toBe('src/util.ts');
    expect(resolve('src/app.js', './comp/Card.vue')).toBe('src/comp/Card.vue');
    expect(resolve('src/app.js', '../data.json')).toBe('data.json');
  });

  it('resolve alias @/ dentro do pacote do arquivo e ignora pacotes externos', () => {
    expect(resolve('src/routes/index.js', '@/app')).toBe('src/app.js');
    expect(resolve('web/src/x.js', '@/main')).toBe('web/src/main.js');
    expect(resolve('src/app.js', 'express')).toBeNull();
    expect(resolve('src/app.js', '../../fora')).toBeNull();
  });
});

describe('classificação', () => {
  it('camadas por nome, sufixo e pasta', () => {
    expect(layerOf('src/server.js').id).toBe('entry');
    expect(layerOf('src/app.js').id).toBe('app');
    expect(layerOf('src/routes/index.js').id).toBe('routes');
    expect(layerOf('src/modules/users/users.controller.js').id).toBe('controllers');
    expect(layerOf('src/services/billing/invoice.js').id).toBe('services');
    expect(layerOf('src/dao/users.js').id).toBe('data');
    expect(layerOf('src/whatever/thing.js').id).toBe('other');
  });

  it('tipo do arquivo: teste, configuração, código, outros', () => {
    expect(classifyKind('src/a.test.js')).toBe('test');
    expect(classifyKind('tests/services/a.js')).toBe('test');
    expect(classifyKind('package.json')).toBe('config');
    expect(classifyKind('vite.config.js')).toBe('config');
    expect(classifyKind('.github/workflows/ci.yml')).toBe('config');
    expect(classifyKind('src/a.js')).toBe('code');
    expect(classifyKind('README.md')).toBe('other');
    expect(isTestFile('src/__tests__/x.js')).toBe(true);
  });

  it('testTarget liga o teste ao arquivo de mesmo nome mais próximo', () => {
    const code = ['src/services/users.service.js', 'src/controllers/users.controller.js', 'src/users.js'];
    expect(testTarget('tests/services/users.service.test.js', code)).toBe('src/services/users.service.js');
    expect(testTarget('src/__tests__/users.js', code)).toBe('src/users.js');
    expect(testTarget('tests/other.test.js', code)).toBeNull();
  });
});

describe('findEntries', () => {
  const read = (map) => async (p) => map[p] ?? null;

  it('usa o script start do package.json', async () => {
    const files = new Set(['package.json', 'src/server.js', 'src/index.js']);
    const entries = await findEntries(files, read({ 'package.json': JSON.stringify({ scripts: { start: 'node src/server.js' } }) }));
    expect(entries).toEqual(['src/server.js']);
  });

  it('usa o index.html do Vite e o .zgdiff.json tem prioridade', async () => {
    const files = new Set(['web/package.json', 'web/index.html', 'web/src/main.js', 'src/boot.js']);
    const map = { 'web/package.json': '{}', 'web/index.html': '<script type="module" src="/src/main.js"></script>' };
    expect(await findEntries(files, read(map))).toEqual(['web/src/main.js']);
    expect(await findEntries(files, read(map), ['src/boot.js'])).toEqual(['src/boot.js']);
  });

  it('sem package.json, pega só o primeiro nome convencional', async () => {
    const files = new Set(['src/server.js', 'src/app.js', 'src/main.js']);
    expect(await findEntries(files, read({}))).toEqual(['src/server.js']);
  });
});

describe('orderFlow', () => {
  const layer = (index, label = 'x') => ({ index, id: label, label });
  const flow = {
    method: 'imports',
    entries: ['src/server.js'],
    files: [
      { path: 'README.md', kind: 'other', depth: null, chain: [], layer: layer(99), testOf: null },
      { path: 'src/services/a.js', kind: 'code', depth: 3, chain: [], layer: layer(6), testOf: null },
      { path: 'src/server.js', kind: 'code', depth: 0, chain: [], layer: layer(0), testOf: null },
      { path: 'tests/a.test.js', kind: 'test', depth: null, chain: [], layer: layer(6), testOf: 'src/services/a.js' },
      { path: 'tests/solto.test.js', kind: 'test', depth: null, chain: [], layer: layer(99), testOf: null },
      { path: 'src/routes/r.js', kind: 'code', depth: 2, chain: [], layer: layer(3), testOf: null },
      { path: 'src/scripts/x.js', kind: 'code', depth: null, chain: [], layer: layer(13), testOf: null },
      { path: 'package.json', kind: 'config', depth: null, chain: [], layer: layer(99), testOf: null },
    ],
  };

  it('ordena por profundidade, coloca o teste junto e agrupa o resto no fim', () => {
    expect(orderFlow(flow).map((s) => `${s.step}:${s.group}:${s.nested ? '↳' : ''}${s.path}`)).toEqual([
      '1:flow:src/server.js',
      '2:flow:src/routes/r.js',
      '3:flow:src/services/a.js',
      '4:flow:↳tests/a.test.js',
      '5:loose:src/scripts/x.js',
      '6:tests:tests/solto.test.js',
      '7:config:package.json',
      '8:other:README.md',
    ]);
  });

  it('com testes no fim, todos vão para o grupo Testes', () => {
    const steps = orderFlow(flow, { tests: 'end' });
    expect(steps.filter((s) => s.group === 'tests').map((s) => s.path)).toEqual(['tests/a.test.js', 'tests/solto.test.js']);
    expect(steps.some((s) => s.nested)).toBe(false);
  });
});
