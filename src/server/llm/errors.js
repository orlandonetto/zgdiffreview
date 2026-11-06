import { AppError } from '../errors.js';

/** Erro vindo de um provedor de LLM, já com mensagem legível para a tela. */
export class LlmError extends AppError {
  constructor(message, status = 502) {
    super(message, status);
  }
}
