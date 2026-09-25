import { readResponseJsonCapped } from '../../sources/httpBody.js';

/** Request a normalized smoke snapshot through the bounded, same-origin HMS proxy. */
export function createSmokeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/smoke', { signal });
      if (!response.ok) throw new Error(`HMS HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        32 * 1024 * 1024,
        signal,
      );
      signal?.throwIfAborted();
      if (!Array.isArray(payload?.rows))
        throw new Error('Malformed smoke snapshot');
      return payload.rows;
    },
  };
}
