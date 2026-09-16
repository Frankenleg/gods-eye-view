import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInciwebIndex,
  findInciwebLink,
  createInciwebIndexSource,
  resolveInciwebNodeLink,
  createInciwebLookupSource,
} from './inciweb.js';

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<item>
  <title>TXTXS Lobo Fire</title>
  <link>http://inciweb.wildfire.gov/incident-information/txtxs-lobo-fire</link>
</item>
<item>
  <title>CALPF Timber Fire</title>
  <link>http://inciweb.wildfire.gov/incident-information/calpf-timber-fire</link>
</item>
<item>
  <title>ORPRD Rowe Creek Complex</title>
  <link>http://inciweb.wildfire.gov/incident-information/orprd-rowe-creek-complex</link>
</item>
<item>
  <title>OR95S Coyote Fire</title>
  <link>http://inciweb.wildfire.gov/incident-information/or95s-coyote-fire</link>
</item>
<item>
  <title>NMGNF Coyote Fire</title>
  <link>http://inciweb.wildfire.gov/incident-information/nmgnf-coyote-fire</link>
</item>
</channel></rss>`;

test('the RSS index parses into normalized name entries with https links', () => {
  const entries = parseInciwebIndex(rss);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries[0], {
    name: 'lobo',
    link: 'https://inciweb.wildfire.gov/incident-information/txtxs-lobo-fire',
    statePrefix: 'tx',
  });
  assert.equal(entries[2].name, 'rowe creek complex');
});

test('incidents match by name, with the state prefix breaking collisions', () => {
  const entries = parseInciwebIndex(rss);
  assert.equal(
    findInciwebLink(entries, { name: 'Timber', state: 'US-CA' }),
    'https://inciweb.wildfire.gov/incident-information/calpf-timber-fire',
  );
  // Two Coyote fires: the WFIGS state picks the right one.
  assert.equal(
    findInciwebLink(entries, { name: 'Coyote', state: 'US-NM' }),
    'https://inciweb.wildfire.gov/incident-information/nmgnf-coyote-fire',
  );
  assert.equal(
    findInciwebLink(entries, { name: 'Coyote', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/incident-information/or95s-coyote-fire',
  );
  // A complex matches without a Fire suffix.
  assert.equal(
    findInciwebLink(entries, { name: 'Rowe Creek Complex', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/incident-information/orprd-rowe-creek-complex',
  );
  assert.equal(findInciwebLink(entries, { name: 'Nope', state: 'US-NM' }), null);
});

test('a complex member falls back to its complex page when its own name has none', () => {
  const entries = parseInciwebIndex(rss);
  // Crosswhite has no InciWeb page of its own but is managed under the
  // Rowe Creek Complex.
  assert.equal(
    findInciwebLink(entries, {
      name: 'Crosswhite',
      state: 'US-OR',
      complexName: 'ROWE CREEK COMPLEX',
    }),
    'https://inciweb.wildfire.gov/incident-information/orprd-rowe-creek-complex',
  );
  // A fire with its own page keeps it even when it belongs to a complex.
  assert.equal(
    findInciwebLink(entries, {
      name: 'Timber',
      state: 'US-CA',
      complexName: 'SOME COMPLEX',
    }),
    'https://inciweb.wildfire.gov/incident-information/calpf-timber-fire',
  );
});

test('an ambiguous name with no state match yields no link rather than a guess', () => {
  const entries = parseInciwebIndex(rss);
  assert.equal(findInciwebLink(entries, { name: 'Coyote', state: 'US-AZ' }), null);
  assert.equal(findInciwebLink(entries, { name: 'Coyote', state: null }), null);
});

const publications = [
  {
    incident_id: '322812',
    tau: 'NMSNF Gobernador Pile Burn Coyote Ranger District',
    incident_title: 'Gobernador Pile Burn - Coyote Ranger District',
  },
  { incident_id: '327504', tau: 'SDBKF Coyote Flats Fire', incident_title: 'Coyote Flats Fire' },
  { incident_id: '328922', tau: 'OR95S Coyote Fire', incident_title: 'Coyote Fire' },
  { incident_id: '329195', tau: 'ORBUD Second Flat', incident_title: 'Second Flat' },
];

test('publication lookup resolves by exact normalized title to a node link', () => {
  // InciWeb titles vary ('Coyote Fire' vs 'Second Flat'); both formats match
  // their WFIGS incident name.
  assert.equal(
    resolveInciwebNodeLink(publications, { name: 'Second Flat', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/node/329195',
  );
  assert.equal(
    resolveInciwebNodeLink(publications, { name: 'Coyote', state: 'US-OR' }),
    'https://inciweb.wildfire.gov/node/328922',
  );
  // Substring hits with different normalized titles never match.
  assert.equal(
    resolveInciwebNodeLink(publications, { name: 'Gobernador', state: 'US-NM' }),
    null,
  );
  assert.equal(resolveInciwebNodeLink(publications, { name: 'Nope', state: null }), null);
  assert.equal(resolveInciwebNodeLink(null, { name: 'Coyote', state: 'US-OR' }), null);
});

test('ambiguous publication titles disambiguate by state, then newest id', () => {
  const twoCoyotes = [
    { incident_id: '100', tau: 'AZASF Coyote Fire', incident_title: 'Coyote Fire' },
    { incident_id: '328922', tau: 'OR95S Coyote Fire', incident_title: 'Coyote Fire' },
  ];
  assert.equal(
    resolveInciwebNodeLink(twoCoyotes, { name: 'Coyote', state: 'US-AZ' }),
    'https://inciweb.wildfire.gov/node/100',
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

test('the lookup source posts the title and honors cancellation', async () => {
  let request;
  const source = createInciwebLookupSource({
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => publications };
    },
  });
  const rows = await source.lookup('Second Flat');
  assert.equal(rows.length, 4);
  assert.match(request.url, /single-publication/);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { title: 'Second Flat' });

  const failing = createInciwebLookupSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(failing.lookup('x'), /InciWeb HTTP 503/);

  const abort = new AbortController();
  const cancelled = createInciwebLookupSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        abort.abort();
        return publications;
      },
    }),
  });
  await assert.rejects(cancelled.lookup('x', { signal: abort.signal }), {
    name: 'AbortError',
  });
});

test('a malformed feed parses to an empty index instead of throwing', () => {
  assert.deepEqual(parseInciwebIndex('not xml at all'), []);
  assert.deepEqual(parseInciwebIndex(null), []);
});

test('the index source fetches and honors cancellation', async () => {
  const source = createInciwebIndexSource({
    fetchImpl: async () => ({ ok: true, text: async () => rss }),
  });
  const entries = await source.getIndex();
  assert.equal(entries.length, 5);

  const abort = new AbortController();
  const cancelled = createInciwebIndexSource({
    fetchImpl: async () => ({
      ok: true,
      text: async () => {
        abort.abort();
        return rss;
      },
    }),
  });
  await assert.rejects(cancelled.getIndex({ signal: abort.signal }), {
    name: 'AbortError',
  });
});
