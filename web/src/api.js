export class ApiError extends Error {}

const HEADERS = { 'x-zgdiff': '1' };

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...HEADERS, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined;
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error ?? `Erro ${res.status}`);
  return data;
}

const q = (params) => new URLSearchParams(params).toString();

export const api = {
  review: () => request('GET', '/api/review'),
  fileLines: (path, side) => request('GET', `/api/file?${q({ side, path })}`).then((r) => r.lines),
  setViewed: (path, viewed) => request('PUT', '/api/viewed', { path, viewed }),
  addComment: (input) => request('POST', '/api/comments', input).then((r) => r.comment),
  updateComment: (id, body) => request('PATCH', `/api/comments/${id}`, { body }).then((r) => r.comment),
  deleteComment: (id) => request('DELETE', `/api/comments/${id}`),
  exportMarkdown: async () => {
    const res = await fetch('/api/export.md');
    if (!res.ok) throw new ApiError(`Erro ${res.status}`);
    return res.text();
  },

  flow: () => request('GET', '/api/flow').then((r) => r.flow),
  definition: ({ side, path, line, col }) => request('GET', `/api/definition?${q({ side, path, line, col })}`),
  blob: (side, path) => request('GET', `/api/blob?${q({ side, path })}`),

  llmStatus: () => request('GET', '/api/llm/status'),
  llmModels: (provider) => request('GET', `/api/llm/models?${q({ provider })}`).then((r) => r.models),
  llmSettings: (patch) => request('PUT', '/api/llm/settings', patch),
  chatHistory: () => request('GET', '/api/chat'),
  chatReset: () => request('POST', '/api/chat/reset', {}),
  suggestionStatus: (id, status) => request('PATCH', `/api/chat/suggestions/${id}`, { status }),

  /**
   * Envia uma mensagem e recebe a resposta em streaming (SSE sobre POST).
   * @param {object} body
   * @param {(event: object) => void} onEvent
   * @param {AbortSignal} signal
   */
  async chat(body, onEvent, signal) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error ?? `Erro ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)));
        }
      }
    }
  },
};
