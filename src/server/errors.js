/** Erros tipados da CLI/servidor. `status` é o código HTTP quando o erro chega na API. */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   */
  constructor(message, status) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** Falha ao executar um comando git (repositório inválido, ref inexistente etc.). */
export class GitError extends AppError {
  constructor(message, stderr = '') {
    super(message, 500);
    this.stderr = stderr;
  }
}

/** Entrada inválida vinda da linha de comando ou do corpo/query da requisição. */
export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, 404);
  }
}
