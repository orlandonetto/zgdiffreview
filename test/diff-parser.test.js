import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/shared/diff-parser.js';

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@ export function main() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
 const e = 6;
@@ -20,3 +21,2 @@ function tail() {
 x();
--- isto é código, não cabeçalho
 y();
`;

describe('parseUnifiedDiff', () => {
  it('lê arquivo modificado com hunks, contagens e números de linha', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file).toBeDefined();
    expect(file.path).toBe('src/app.ts');
    expect(file.status).toBe('modified');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(2);
    expect(file.hunks).toHaveLength(2);

    const h0 = file.hunks[0];
    expect(h0.section).toBe('export function main() {');
    expect(h0.lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['context', 3, 4],
      ['context', 4, 5],
    ]);
  });

  it('não confunde linha removida que começa com "--" com cabeçalho de arquivo', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    const h1 = file.hunks[1];
    expect(h1.lines).toHaveLength(3);
    expect(h1.lines[1]).toEqual({ type: 'del', content: '-- isto é código, não cabeçalho', oldNo: 21 });
  });

  it('lê arquivo adicionado e arquivo removido', () => {
    const raw = `diff --git a/novo.md b/novo.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/novo.md
@@ -0,0 +1,2 @@
+# Título
+texto
diff --git a/velho.txt b/velho.txt
deleted file mode 100644
index 4444444..0000000
--- a/velho.txt
+++ /dev/null
@@ -1 +0,0 @@
-adeus
\\ No newline at end of file
`;
    const [added, deleted] = parseUnifiedDiff(raw);
    expect(added).toMatchObject({ path: 'novo.md', status: 'added', oldPath: null, newPath: 'novo.md', additions: 2 });
    expect(deleted).toMatchObject({ path: 'velho.txt', status: 'deleted', oldPath: 'velho.txt', newPath: null, deletions: 1 });
    expect(deleted.hunks[0].lines).toHaveLength(1);
  });

  it('lê rename sem mudança de conteúdo (sem hunks) e com espaço no nome', () => {
    const raw = `diff --git a/docs/meu arquivo.md b/docs/renomeado.md
similarity index 100%
rename from docs/meu arquivo.md
rename to docs/renomeado.md
`;
    const [file] = parseUnifiedDiff(raw);
    expect(file).toMatchObject({
      path: 'docs/renomeado.md',
      oldPath: 'docs/meu arquivo.md',
      newPath: 'docs/renomeado.md',
      status: 'renamed',
      hunks: [],
    });
  });

  it('lê binário usando o caminho da linha diff --git', () => {
    const raw = `diff --git a/img/logo com espaço.png b/img/logo com espaço.png
index 5555555..6666666 100644
Binary files a/img/logo com espaço.png and b/img/logo com espaço.png differ
`;
    const [file] = parseUnifiedDiff(raw);
    expect(file).toMatchObject({ path: 'img/logo com espaço.png', binary: true, status: 'modified' });
  });

  it('remove aspas de caminhos com caracteres especiais', () => {
    const raw = `diff --git "a/tab\\there.txt" "b/tab\\there.txt"
index 1..2 100644
--- "a/tab\\there.txt"
+++ "b/tab\\there.txt"
@@ -1 +1 @@
-a
+b
`;
    const [file] = parseUnifiedDiff(raw);
    expect(file.path).toBe('tab\there.txt');
  });

  it('gera patchHash diferente quando o patch muda', () => {
    const [a] = parseUnifiedDiff(MODIFIED);
    const [b] = parseUnifiedDiff(MODIFIED.replace('const c = 4;', 'const c = 5;'));
    expect(a.patchHash).not.toBe(b.patchHash);
  });

  it('devolve lista vazia para diff vazio', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
