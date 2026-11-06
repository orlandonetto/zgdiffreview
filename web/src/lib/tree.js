/** @typedef {import('../../../src/shared/types.js').DiffFile} DiffFile */

/**
 * @typedef {object} TreeDir
 * @property {'dir'} kind
 * @property {string} name nome exibido; pastas com um único filho são compactadas ("src/server")
 * @property {string} path caminho completo, usado como chave para abrir/fechar
 * @property {TreeNode[]} children
 */

/**
 * @typedef {object} TreeFile
 * @property {'file'} kind
 * @property {string} name
 * @property {string} path
 * @property {DiffFile} file
 */

/** @typedef {TreeDir | TreeFile} TreeNode */

/**
 * Monta a árvore de pastas a partir da lista de arquivos alterados.
 * Pastas antes de arquivos, em ordem alfabética.
 *
 * @param {DiffFile[]} files
 * @returns {TreeNode[]}
 */
export function buildTree(files) {
  const root = { kind: 'dir', name: '', path: '', children: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    for (let k = 0; k < parts.length - 1; k++) {
      const name = parts[k];
      const path = parts.slice(0, k + 1).join('/');
      let next = dir.children.find((c) => c.kind === 'dir' && c.name === name);
      if (!next) {
        next = { kind: 'dir', name, path, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ kind: 'file', name: parts[parts.length - 1], path: file.path, file });
  }
  return root.children.map(compact).sort(byKindThenName);
}

function compact(node) {
  if (node.kind === 'file') return node;
  let cur = node;
  let name = node.name;
  while (cur.children.length === 1 && cur.children[0].kind === 'dir') {
    cur = cur.children[0];
    name = `${name}/${cur.name}`;
  }
  return { kind: 'dir', name, path: cur.path, children: cur.children.map(compact).sort(byKindThenName) };
}

function byKindThenName(a, b) {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Ordem dos arquivos como aparecem na árvore, para o painel principal seguir a mesma ordem.
 *
 * @param {TreeNode[]} nodes
 * @returns {DiffFile[]}
 */
export function flattenTree(nodes) {
  const out = [];
  const walk = (ns) => {
    for (const n of ns) {
      if (n.kind === 'file') out.push(n.file);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
