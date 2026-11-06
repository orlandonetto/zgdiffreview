// Formatos de dados compartilhados entre o servidor (CLI) e a interface web.
// Só documentação (JSDoc): o editor usa para autocompletar, nada aqui roda.

/** @typedef {'added' | 'deleted' | 'modified' | 'renamed' | 'copied'} FileStatus */
/** @typedef {'context' | 'add' | 'del'} LineType */
/** @typedef {'old' | 'new'} Side */

/**
 * @typedef {object} DiffLine
 * @property {LineType} type
 * @property {string} content
 * @property {number} [oldNo] Número da linha na versão antiga (base). Ausente em linhas adicionadas.
 * @property {number} [newNo] Número da linha na versão nova (branch). Ausente em linhas removidas.
 */

/**
 * @typedef {object} Hunk
 * @property {number} oldStart
 * @property {number} oldLines
 * @property {number} newStart
 * @property {number} newLines
 * @property {string} section Texto após o segundo `@@` (normalmente a função onde está a mudança).
 * @property {DiffLine[]} lines
 */

/**
 * @typedef {object} DiffFile
 * @property {string} path Caminho exibido e usado como chave (o novo, exceto em arquivos removidos).
 * @property {string | null} oldPath
 * @property {string | null} newPath
 * @property {FileStatus} status
 * @property {boolean} binary
 * @property {number} additions
 * @property {number} deletions
 * @property {Hunk[]} hunks
 * @property {string} patchHash Muda quando o arquivo muda na branch (invalida o "visto").
 */

/**
 * @typedef {object} ReviewInfo
 * @property {string} repoName
 * @property {string} base
 * @property {string} head
 * @property {string} baseSha
 * @property {string} headSha
 * @property {string} mergeBaseSha
 * @property {DiffFile[]} files
 */

/**
 * @typedef {object} ReviewComment
 * @property {string} id
 * @property {string} path
 * @property {Side} side
 * @property {number} startLine
 * @property {number} endLine
 * @property {string} snippet Trecho comentado, guardado para o export e para linhas que saíram do diff.
 * @property {string} body
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ReviewState
 * @property {Record<string, string>} viewed path -> patchHash do momento em que foi marcado como visto.
 * @property {ReviewComment[]} comments
 */

export {};
