import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findInciwebLink,
  resolveInciwebNodeLink,
  createInciwebIndexSource,
} from './inciweb.js';

const catalog = [
  {
    incident_id: '322812',
    tau: 'NMSNF Gobernador Pile Burn Coyote Ranger District',
    incident_title: 'Gobernador Pile Burn - Coyote Ranger District',
  },
  {
    incident_id: '327504',
    tau: 'SDBKF Coyote Flats Fire',
    incident_title: 'Coyote Flats Fire',
  },
  { incident_id: '328922', tau: 'OR95S Coyote Fire', incident_title: 'Coyote Fire' },
  { incident_id: '329195', tau: 'ORBUD Second Flat', incident_title: 'Second Flat' },
  {
    incident_id: '329273',
    tau: 'ORBUD 2026 Coleman Creek',
    incident_title: '2026 Coleman Creek',
  },
  {
    incident_id: '328923',
    tau: 'ORPRD Rowe Creek Complex',
    incident_title: 'Rowe Creek Complex',
  },
  { incident_id: '291765', tau: 'CALPF Timber Fire', incident_title: 'Timber Fire' },
];

test('incidents resolve by exact normalized title to a node link', () => {
  // Title formats vary: with/without a 'Fire' suffix, with/without a year
  // prefix ('2026 Coleman Creek'). All normalize to the WFIGS name.
  assert.equal(
    resolveInciwebNodeLink(catalog, { name: 'Second Flat', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/node/329195',
  );
  assert.equal(
    resolveInciwebNodeLink(catalog, { name: 'Coleman Creek', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/node/329273',
  );
  assert.equal(
    resolveInciwebNodeLink(catalog, { name: 'Timber', state: 'US-CA' }),
    'https://inciweb.wildfire.gov/node/291765',
  );
  assert.equal(
    resolveInciwebNodeLink(catalog, { name: 'Coyote', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/node/328922',
  );
  // Substring-style near-misses never match.
  assert.equal(
    resolveInciwebNodeLink(catalog, { name: 'Gobernador', state: 'US-NM' }),
    null,
  );
  assert.equal(resolveInciwebNodeLink(catalog, { name: 'Nope', state: null }), null);
  assert.equal(resolveInciwebNodeLink(null, { name: 'Coyote', state: 'US-OR' }), null);
});

test('ambiguous titles disambiguate by state, then newest id', () => {
  const twoCoyotes = [
    { incident_id: '100', tau: 'AZASF Coyote Fire', incident_title: 'Coyote Fire' },
    { incident_id: '328922', tau: 'OR95S Coyote Fire', incident_title: 'Coyote Fire' },
  ];
  assert.equal(
    resolveInciwebNodeLink(twoCoyotes, { name: 'Coyote', state: 'US-AZ' }),
    'https://inciweb.wildfire.gov/node/100',
  );
  assert.equal(
    resolveInciwebNodeLink(twoCoyotes, { name: 'Coyote', state: null }),
    null,
  );
  const twoSameState = [
    { incident_id: '100', tau: 'ORXXX Coyote Fire', incident_title: 'Coyote Fire' },
    { incident_id: '328922', tau: 'OR95S Coyote Fire', incident_title: 'Coyote Fire' },
  ];
  // Same-state duplicates are usually reburns of the same name — newest wins.
  assert.equal(
    resolveInciwebNodeLink(twoSameState, { name: 'Coyote', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/node/328922',
  );
});

test('a complex member falls back to its complex page', () => {
  assert.equal(
    findInciwebLink(catalog, {
      name: 'Crosswhite',
      state: 'US-OR',
      complexName: 'ROWE CREEK COMPLEX',
    }),
    'https://inciweb.wildfire.gov/node/328923',
  );
  // A fire with its own page keeps it even when it belongs to a complex.
  assert.equal(
    findInciwebLink(catalog, {
      name: 'Timber',
      state: 'US-CA',
      complexName: 'SOME COMPLEX',
    }),
    'https://inciweb.wildfire.gov/node/291765',
  );
  assert.equal(
    findInciwebLink(catalog, { name: 'Nope', state: 'US-NM', complexName: null }),
    null,
  );
});

test('the index source posts an empty title for the full catalog', async () => {
  let request;
  const source = createInciwebIndexSource({
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => catalog };
    },
  });
  const rows = await source.getIndex();
  assert.equal(rows.length, catalog.length);
  assert.match(request.url, /single-publication/);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { title: '' });
});

test('the index source rejects failures and honors cancellation', async () => {
  const failing = createInciwebIndexSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(failing.getIndex(), /InciWeb HTTP 503/);

  const malformed = createInciwebIndexSource({
    fetchImpl: async () => ({ ok: true, json: async () => ({ nope: 1 }) }),
  });
  assert.deepEqual(await malformed.getIndex(), []);

  const abort = new AbortController();
  const cancelled = createInciwebIndexSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        abort.abort();
        return catalog;
      },
    }),
  });
  await assert.rejects(cancelled.getIndex({ signal: abort.signal }), {
    name: 'AbortError',
  });
});
