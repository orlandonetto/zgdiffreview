/**
 * Ordem de revisão (modo Fluxo) a partir das informações calculadas pelo servidor.
 * Puro: usado pela interface para trocar "testes junto | no fim" sem recalcular.
 *
 * @typedef {object} FlowFile
 * @property {string} path
 * @property {'code' | 'test' | 'config' | 'other'} kind
 * @property {number | null} depth distância (em imports) até a entrada; null = não alcançado
 * @property {string[]} chain caminho da entrada até o arquivo (inclusive), vazio se não alcançado
 * @property {{ index: number, id: string, label: string }} layer
 * @property {string | null} testOf para testes: arquivo alterado que ele testa
 *
 * @typedef {object} FlowInfo
 * @property {'imports' | 'layers'} method
 * @property {string[]} entries
 * @property {FlowFile[]} files
 *
 * @typedef {object} FlowStep
 * @property {string} path
 * @property {string} group
 * @property {number} step número exibido (1, 2, 3...)
 * @property {boolean} nested teste mostrado logo abaixo do arquivo que testa
 */

export const GROUP_LABELS = {
  flow: 'Fluxo de execução',
  loose: 'Fora do fluxo de imports (por camada)',
  layers: 'Por camadas',
  tests: 'Testes',
  config: 'Configuração e build',
  other: 'Outros',
};

const segs = (p) => p.split('/').length;

const byLayerThenPath = (a, b) => a.layer.index - b.layer.index || segs(a.path) - segs(b.path) || a.path.localeCompare(b.path);

/**
 * @param {FlowInfo} flow
 * @param {{ tests?: 'together' | 'end' }} [opts]
 * @returns {FlowStep[]}
 */
export function orderFlow(flow, { tests = 'together' } = {}) {
  const code = flow.files.filter((f) => f.kind === 'code');
  const testFiles = flow.files.filter((f) => f.kind === 'test');

  let groups;
  if (flow.method === 'imports') {
    const reached = code
      .filter((f) => f.depth !== null)
      .sort((a, b) => a.depth - b.depth || a.layer.index - b.layer.index || a.path.localeCompare(b.path));
    const loose = code.filter((f) => f.depth === null).sort(byLayerThenPath);
    groups = [
      ['flow', reached],
      ['loose', loose],
    ];
  } else {
    groups = [['layers', [...code].sort(byLayerThenPath)]];
  }

  const codePaths = new Set(code.map((f) => f.path));
  const nestedTests = new Map();
  const restTests = [];
  for (const t of testFiles.sort((a, b) => a.path.localeCompare(b.path))) {
    if (tests === 'together' && t.testOf && codePaths.has(t.testOf)) {
      nestedTests.set(t.testOf, [...(nestedTests.get(t.testOf) ?? []), t]);
    } else {
      restTests.push(t);
    }
  }

  groups.push(['tests', restTests]);
  groups.push(['config', flow.files.filter((f) => f.kind === 'config').sort((a, b) => a.path.localeCompare(b.path))]);
  groups.push(['other', flow.files.filter((f) => f.kind === 'other').sort((a, b) => a.path.localeCompare(b.path))]);

  const out = [];
  let step = 1;
  for (const [group, files] of groups) {
    for (const f of files) {
      out.push({ path: f.path, group, step: step++, nested: false });
      for (const t of nestedTests.get(f.path) ?? []) out.push({ path: t.path, group, step: step++, nested: true });
    }
  }
  return out;
}
