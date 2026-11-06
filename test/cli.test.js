import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/server/cli.js';

describe('parseArgs', () => {
  it('lê base e depois branch: zgdiff develop feature/teste1', () => {
    expect(parseArgs(['develop', 'feature/teste1'])).toMatchObject({ base: 'develop', head: 'feature/teste1' });
  });

  it('só a base: compara a branch atual com ela', () => {
    expect(parseArgs(['main'])).toMatchObject({ base: 'main', head: undefined });
  });

  it('sem argumentos usa os padrões', () => {
    expect(parseArgs([])).toMatchObject({ base: undefined, head: undefined, fetch: false, open: true });
  });

  it('lê as opções em qualquer posição', () => {
    expect(parseArgs(['-f', 'develop', '--port', '8000', 'feat', '--no-open'])).toMatchObject({
      base: 'develop',
      head: 'feat',
      fetch: true,
      port: 8000,
      open: false,
    });
  });

  it('reconhece ajuda e versão', () => {
    expect(parseArgs(['develop', '--help'])).toBe('help');
    expect(parseArgs(['-v'])).toBe('version');
  });

  it('recusa opção desconhecida, porta inválida e argumentos demais', () => {
    expect(() => parseArgs(['--xyz'])).toThrow('Opção desconhecida');
    expect(() => parseArgs(['--port', 'abc'])).toThrow('--port');
    expect(() => parseArgs(['a', 'b', 'c'])).toThrow('no máximo');
  });
});
