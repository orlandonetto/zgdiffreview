import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/shared/diff-parser.js';
import { buildRows, expandGap, snippetFor, toSplitRows} from '../web/src/lib/rows.js';

// Arquivo novo com 60 linhas "n1".."n60"; o diff mudou a linha 30 (contexto de 3).
const content = Array.from({ length: 60 }, (_, k) => `n${k + 1}`);
const RAW = `diff --git a/f.ts b/f.ts
index 1..2 100644
--- a/f.ts
+++ b/f.ts
@@ -27,7 +27,7 @@
 n27
 n28
 n29
-velho30
+n30
 n31
 n32
 n33
`;
const file = parseUnifiedDiff(RAW)[0];

const gaps = (rows) => rows.filter((r) => r.kind === 'gap');
const lines = (rows) => rows.filter((r) => r.kind === 'line');

describe('buildRows', () => {
  it('sem o arquivo carregado mostra o gap de cima com tamanho e o de baixo como desconhecido', () => {
    const rows = buildRows(file, [], null);
    const [top, bottom] = gaps(rows);
    expect(top).toMatchObject({ index: 0, hidden: 26, canExpandUp: true, canExpandDown: false });
    expect(bottom).toMatchObject({ index: 1, hidden: null, canExpandDown: true, canExpandUp: false });
    expect(lines(rows)).toHaveLength(8);
  });

  it('expandir para cima revela as 20 linhas logo acima do hunk', () => {
    const state = [expandGap({ top: 0, bottom: 0 }, 'up'), { top: 0, bottom: 0 }];
    const rows = buildRows(file, state, content);
    expect(gaps(rows)[0]).toMatchObject({ hidden: 6 });
    const revealed = lines(rows).filter((l) => l.expanded && l.newNo < 27);
    expect(revealed.map((l) => l.newNo)).toEqual(Array.from({ length: 20 }, (_, k) => k + 7));
    expect(revealed[0]).toMatchObject({ content: 'n7', oldNo: 7 });
  });

  it('expandir para baixo no fim do arquivo respeita o tamanho real', () => {
    const state = [{ top: 0, bottom: 0 }, expandGap(expandGap({ top: 0, bottom: 0 }, 'down'), 'down')];
    const rows = buildRows(file, state, content);
    // Depois da linha 33 sobram 27 linhas: 40 pedidas, 27 mostradas, sem gap no fim.
    expect(gaps(rows).map((g) => g.index)).toEqual([0]);
    expect(lines(rows).at(-1)).toMatchObject({ newNo: 60, oldNo: 60, content: 'n60' });
  });

  it('expandir tudo some com o gap e mostra o arquivo inteiro', () => {
    const all = expandGap({ top: 0, bottom: 0 }, 'all');
    const rows = buildRows(file, [all, all], content);
    expect(gaps(rows)).toHaveLength(0);
    expect(lines(rows).filter((l) => l.type !== 'del').map((l) => l.newNo)).toEqual(
      Array.from({ length: 60 }, (_, k) => k + 1),
    );
  });

  it('arquivo adicionado não tem gaps', () => {
    const [added] = parseUnifiedDiff(`diff --git a/a b/a
new file mode 100644
--- /dev/null
+++ b/a
@@ -0,0 +1,1 @@
+x
`);
    expect(gaps(buildRows(added, [], null))).toHaveLength(0);
  });
});

describe('toSplitRows', () => {
  it('pareia remoções com adições e mantém contexto dos dois lados', () => {
    const split = toSplitRows(buildRows(file, [], null)).filter((r) => r.kind === 'split');
    expect(split).toHaveLength(7);
    expect(split[3]).toMatchObject({
      left: { type: 'del', no: 30, content: 'velho30' },
      right: { type: 'add', no: 30, content: 'n30' },
    });
  });
});

describe('snippetFor', () => {
  it('pega o texto do lado certo', () => {
    const rows = buildRows(file, [], null);
    expect(snippetFor(rows, 'new', 29, 31)).toBe('n29\nn30\nn31');
    expect(snippetFor(rows, 'old', 30, 30)).toBe('velho30');
  });
});
