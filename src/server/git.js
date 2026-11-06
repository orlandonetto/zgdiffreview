import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { parseUnifiedDiff } from '../shared/diff-parser.js';
import { GitError, ValidationError } from './errors.js';

/** @typedef {import('../shared/types.js').ReviewInfo} ReviewInfo */

const MAX_BUFFER = 512 * 1024 * 1024;

/** Bases tentadas, em ordem, quando o usuário não informa uma. */
export const DEFAULT_BASES = ['origin/develop', 'develop', 'origin/main', 'main', 'origin/master', 'master'];

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
export function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        reject(new GitError(`git ${args[0]} falhou: ${stderr.trim() || err.message}`, stderr));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function repoRoot(cwd) {
  try {
    return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new ValidationError('Esta pasta não está dentro de um repositório git.');
  }
}

/** Devolve o SHA do commit apontado por `ref`, ou null se a ref não existir. */
export async function resolveCommit(root, ref) {
  if (ref.startsWith('-')) throw new ValidationError(`Ref inválida: ${ref}`);
  try {
    return (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || null;
  } catch {
    return null;
  }
}

export async function currentBranch(root) {
  const name = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  // Em HEAD destacado o git devolve "HEAD"; aí o próprio commit é a "branch".
  return name === 'HEAD' ? (await git(root, ['rev-parse', 'HEAD'])).trim() : name;
}

export async function defaultBase(root) {
  for (const candidate of DEFAULT_BASES) {
    if (await resolveCommit(root, candidate)) return candidate;
  }
  throw new ValidationError(`Nenhuma base encontrada (${DEFAULT_BASES.join(', ')}). Informe a base: zgdiff <base> <branch>`);
}

export async function fetchOrigin(root) {
  await git(root, ['fetch', 'origin', '--prune']);
}

/**
 * Calcula o review: diff entre o ponto onde a branch saiu da base (merge-base)
 * e a ponta da branch. É o mesmo que `git diff base...head` e o que a PR mostra.
 *
 * @returns {Promise<ReviewInfo>}
 */
export async function computeReview(root, base, head) {
  const [baseSha, headSha] = await Promise.all([resolveCommit(root, base), resolveCommit(root, head)]);
  if (!baseSha) throw new ValidationError(`Base não encontrada: ${base}`);
  if (!headSha) throw new ValidationError(`Branch não encontrada: ${head}`);

  let mergeBaseSha;
  try {
    mergeBaseSha = (await git(root, ['merge-base', baseSha, headSha])).trim();
  } catch {
    throw new ValidationError(`${head} e ${base} não têm histórico em comum.`);
  }

  const raw = await git(root, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '-M',
    '-U3',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    mergeBaseSha,
    headSha,
  ]);

  return {
    repoName: basename(root),
    base,
    head,
    baseSha,
    headSha,
    mergeBaseSha,
    files: parseUnifiedDiff(raw),
  };
}

/** Conteúdo de um arquivo em um commit, quebrado em linhas. */
export async function fileLines(root, sha, path) {
  const text = await git(root, ['cat-file', '-p', `${sha}:${path}`]);
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
