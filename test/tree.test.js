import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree } from '../web/src/lib/tree.js';

const f = (path) => ({
  path,
  oldPath: path,
  newPath: path,
  status: 'modified',
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [],
  patchHash: '0',
});

describe('buildTree', () => {
  it('agrupa por pasta, compacta pastas de filho único e põe pastas antes de arquivos', () => {
    const tree = buildTree([f('README.md'), f('src/server/git.ts'), f('src/server/cli.ts'), f('a/b/c/d.ts')]);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['dir:a/b/c', 'dir:src/server', 'file:README.md']);
    expect(flattenTree(tree).map((x) => x.path)).toEqual([
      'a/b/c/d.ts',
      'src/server/cli.ts',
      'src/server/git.ts',
      'README.md',
    ]);
  });
});
