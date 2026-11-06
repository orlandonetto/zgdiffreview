import { describe, expect, it } from 'vitest';
import { declarationsIn, findDefinitionHeuristic, findImportBinding, isDeclarationLine } from '../src/server/definition/heuristic.js';
import { identifierAt } from '../src/server/definition/symbol.js';
import { vueToScript } from '../src/server/definition/ts-service.js';
import { createResolver } from '../src/server/flow/resolve.js';

describe('identifierAt', () => {
  it('pega o nome sob a coluna e o receptor em acesso a membro', () => {
    const line = '  const users = await usersService.listUsers(id);';
    expect(identifierAt(line, line.indexOf('listUsers') + 3)).toMatchObject({ name: 'listUsers', receiver: 'usersService' });
    expect(identifierAt(line, line.indexOf('usersService'))).toMatchObject({ name: 'usersService', receiver: null });
    expect(identifierAt(line, line.indexOf('(') + 1)).toMatchObject({ name: 'id' });
    expect(identifierAt(line, line.indexOf('='))).toBeNull();
    expect(identifierAt('x = 42;', 5)).toBeNull();
  });
});

describe('heurística', () => {
  it('reconhece declarações e não confunde com chamadas', () => {
    expect(isDeclarationLine('export async function listUsers() {', 'listUsers')).toBe(true);
    expect(isDeclarationLine('const listUsers = async () => {', 'listUsers')).toBe(true);
    expect(isDeclarationLine('  listUsers(req, res) {', 'listUsers')).toBe(true);
    expect(isDeclarationLine('  listUsers: async (req) => x,', 'listUsers')).toBe(true);
    expect(isDeclarationLine('exports.listUsers = function () {}', 'listUsers')).toBe(true);
    expect(isDeclarationLine('class UserService {', 'UserService')).toBe(true);
    expect(isDeclarationLine('  listUsers(req, res);', 'listUsers')).toBe(false);
    expect(isDeclarationLine("const { listUsers } = require('./x');", 'listUsers')).toBe(false);
  });

  it('acha o import de um nome (default, nomeado, alias, require)', () => {
    const src = [
      "import express from 'express';",
      "import { a, b as c } from './ab';",
      "const svc = require('../services/svc');",
      "const { d } = require('./d');",
    ].join('\n');
    expect(findImportBinding(src, 'express')).toMatchObject({ spec: 'express', kind: 'default' });
    expect(findImportBinding(src, 'a')).toMatchObject({ spec: './ab', kind: 'named', exported: 'a' });
    expect(findImportBinding(src, 'c')).toMatchObject({ spec: './ab', kind: 'named', exported: 'b' });
    expect(findImportBinding(src, 'svc')).toMatchObject({ spec: '../services/svc', kind: 'default', line: 3 });
    expect(findImportBinding(src, 'd')).toMatchObject({ spec: './d', kind: 'named' });
  });

  it('declarationsIn devolve as linhas', () => {
    expect(declarationsIn('a\nfunction foo() {}\nfoo();', 'foo')).toEqual([{ line: 2, text: 'function foo() {}' }]);
  });

  it('segue obj.metodo até o arquivo importado (inclusive por reexport)', async () => {
    const files = {
      'src/controller.js': "const svc = require('./services');\nasync function list() { return svc.listUsers(); }",
      'src/services/index.js': "export * from './users';",
      'src/services/users.js': 'export async function listUsers() {\n  return [];\n}',
    };
    const snap = { text: async (p) => files[p] ?? null, grep: async () => [] };
    const resolve = createResolver(new Set(Object.keys(files)));
    const found = await findDefinitionHeuristic({ snap, path: 'src/controller.js', line: 2, symbol: { name: 'listUsers', receiver: 'svc' }, resolve });
    expect(found).toEqual([{ path: 'src/services/users.js', line: 1, text: 'export async function listUsers() {' }]);
  });
});

describe('vueToScript', () => {
  it('mantém só o <script> e as posições das linhas', () => {
    const src = '<template>\n  <div>{{ a }}</div>\n</template>\n<script setup lang="ts">\nconst a = 1;\n</script>\n';
    const { text, lang } = vueToScript(src);
    expect(lang).toBe('ts');
    expect(text.length).toBe(src.length);
    expect(text.split('\n')[4]).toBe('const a = 1;');
    expect(text.split('\n')[1].trim()).toBe('');
  });
});
