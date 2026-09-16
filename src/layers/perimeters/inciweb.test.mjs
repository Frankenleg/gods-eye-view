import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInciwebIndex,
  findInciwebLink,
  createInciwebIndexSource,
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

test('an ambiguous name with no state match yields no link rather than a guess', () => {
  const entries = parseInciwebIndex(rss);
  assert.equal(findInciwebLink(entries, { name: 'Coyote', state: 'US-AZ' }), null);
  assert.equal(findInciwebLink(entries, { name: 'Coyote', state: null }), null);
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
