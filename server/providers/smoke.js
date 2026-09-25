import { normalizeSmokeKml } from '../../src/layers/smoke/records.js';
import { readResponseTextCapped, coalesceProxyRequest } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

// NOAA OSPO Hazard Mapping System smoke polygons: one KML file per UTC day,
// appended through the day as analysts add plumes (public, keyless).
const BASE_URL =
  'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/';

const MIB = 1024 * 1024;

const utcDay = (ms) => {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return {
    year: String(date.getUTCFullYear()),
    month: pad(date.getUTCMonth() + 1),
    day: `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
  };
};

/** Fixed-origin, bounded HMS smoke route for dev and preview. */
export function hmsSmokeProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });

  async function fetchDay(ms) {
    const { year, month, day } = utcDay(ms);
    const signal = AbortSignal.timeout(30_000);
    const response = await fetchImpl(
      `${BASE_URL}${year}/${month}/hms_smoke${day}.kml`,
      { signal, redirect: 'error' },
    );
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error('upstream_unavailable');
      error.notFound = response.status === 404;
      throw error;
    }
    const kml = await readResponseTextCapped(response, 8 * MIB, signal);
    const rows = normalizeSmokeKml(kml, { day });
    if (!rows) throw new Error('invalid_snapshot');
    return { fetchedAt: now(), day, rows };
  }

  async function fetchSmoke() {
    const current = now();
    try {
      return await fetchDay(current);
    } catch (error) {
      // Right after 00:00 UTC the new day's file does not exist yet;
      // yesterday's file is the complete most-recent analysis.
      if (!error.notFound) throw error;
      return fetchDay(current - 86_400_000);
    }
  }

  async function acquire() {
    const previous = cache.get('smoke');
    if (previous && now() - previous.savedAt < 600_000)
      return { value: previous.value, stale: false };
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'smoke', async () => {
        const value = await fetchSmoke();
        cache.set('smoke', { value, savedAt: now() });
        return value;
      });
      return { value: await promise, stale: false };
    } catch (error) {
      if (previous) return { value: previous.value, stale: true };
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value, stale = false) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...(stale ? { 'X-Data-Stale': 'true' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const { value, stale } = await acquire();
      json(200, stale ? { ...value, stale: true } : value, stale);
    } catch {
      json(502, { error: 'smoke_unavailable' });
    }
  }

  return {
    name: 'smoke',
    configureServer({ middlewares }) {
      middlewares.use('/api/smoke', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/smoke', handler);
    },
  };
}
