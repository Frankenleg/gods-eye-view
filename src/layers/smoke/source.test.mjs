import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmokeSource } from './source.js';
import { hmsSmokeProxy } from '../../../server/providers/smoke.js';

const kml = (body) =>
  `<?xml version="1.0"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
const placemark = `<Placemark><description><![CDATA[Start Time: 2026266 1200UTC<br>End Time: 2026266 1500UTC<br>Density: Heavy<br>Satellite: GOES-WEST]]></description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>
  -84.1,31.1,0 -84.2,31.1,0 -84.2,31.2,0 -84.1,31.1,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;

function serve(plugin) {
  let handler;
  plugin.configureServer({
    middlewares: {
      use: (_path, callback) => {
        handler = callback;
      },
    },
  });
  return async (url = '/') => {
    let payload, status;
    await handler(
      { url, method: 'GET' },
      {
        writeHead(code) {
          status = code;
        },
        end(body) {
          payload = JSON.parse(body);
        },
      },
    );
    return { status, payload };
  };
}

test("the proxy serves today's file as normalized rows", async () => {
  const requested = [];
  const request = serve(
    hmsSmokeProxy({
      now: () => Date.UTC(2026, 8, 23, 18, 0),
      fetchImpl: async (url) => {
        requested.push(String(url));
        return new Response(kml(placemark), { status: 200 });
      },
    }),
  );
  const { status, payload } = await request('/');
  assert.equal(status, 200);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].density, 'Heavy');
  assert.equal(payload.rows[0].stableId, '20260923:0');
  assert.match(requested[0], /KML\/2026\/09\/hms_smoke20260923\.kml$/);
});

test("early UTC, before today's file exists, falls back to the previous day", async () => {
  const requested = [];
  const request = serve(
    hmsSmokeProxy({
      // 00:30 UTC on Oct 1: today's file is a 404, yesterday's exists —
      // and the fallback crosses a month boundary.
      now: () => Date.UTC(2026, 9, 1, 0, 30),
      fetchImpl: async (url) => {
        requested.push(String(url));
        return String(url).includes('20261001')
          ? new Response('Not Found', { status: 404 })
          : new Response(kml(placemark), { status: 200 });
      },
    }),
  );
  const { status, payload } = await request('/');
  assert.equal(status, 200);
  assert.equal(payload.rows[0].stableId, '20260930:0');
  assert.match(requested[0], /hms_smoke20261001\.kml$/);
  assert.match(requested[1], /KML\/2026\/09\/hms_smoke20260930\.kml$/);
});

test('a non-KML upstream payload is a 502, never an empty snapshot', async () => {
  const request = serve(
    hmsSmokeProxy({
      now: () => Date.UTC(2026, 8, 23, 18, 0),
      fetchImpl: async () =>
        new Response('<html>maintenance</html>', { status: 200 }),
    }),
  );
  const { status, payload } = await request('/');
  assert.equal(status, 502);
  assert.equal(payload.error, 'smoke_unavailable');
});

test('the client source fetches the proxy and validates the row shape', async () => {
  let requested;
  const source = createSmokeSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({ rows: [{ stableId: 'd:0' }] });
    },
  });
  const rows = await source.getSnapshot();
  assert.equal(requested, '/api/smoke');
  assert.equal(rows.length, 1);

  const malformed = createSmokeSource({
    fetchImpl: async () => Response.json({ rows: {} }),
  });
  await assert.rejects(malformed.getSnapshot(), /Malformed smoke snapshot/);

  const failing = createSmokeSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(failing.getSnapshot(), /HMS HTTP 503/);

  const abort = new AbortController();
  const cancelled = createSmokeSource({
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers(),
      text: async () => {
        abort.abort();
        return JSON.stringify({ rows: [] });
      },
    }),
  });
  await assert.rejects(cancelled.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
});
