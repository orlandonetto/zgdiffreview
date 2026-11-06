import { isCodePath, isConfigFile, isTestFile } from './classify.js';

/**
 * Tipo de um arquivo para o Fluxo. Testes vêm antes de tudo (um teste também é código);
 * configuração antes de código (vite.config.js é configuração, não fluxo da aplicação).
 *
 * @returns {'test' | 'config' | 'code' | 'other'}
 */
export function classifyKind(path) {
  if (isTestFile(path)) return 'test';
  if (isConfigFile(path)) return 'config';
  if (isCodePath(path)) return 'code';
  return 'other';
}
