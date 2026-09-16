/** InciWeb incident index: RSS parsing and WFIGS-name matching. Pure + fetch. */

// Public interagency incident-information site; permissive CORS, so the
// browser fetches it directly.
const RSS_URL = 'https://inciweb.wildfire.gov/incidents/rss.xml';

/**
 * Normalize an incident name for matching: lowercase, collapsed whitespace,
 * trailing "Fire" dropped (InciWeb titles carry it, WFIGS names do not).
 */
function normalizeName(name) {
  const collapsed = String(name).toLowerCase().trim().replace(/\s+/g, ' ');
  return collapsed.replace(/ fire$/, '');
}

/**
 * Parse the InciWeb RSS index into matchable entries.
 * Titles look like "TXTXS Lobo Fire" — a dispatch-unit code (whose first two
 * letters are the state) followed by the incident name.
 * @param {string} rssText - Raw RSS XML.
 * @returns {Array<{name: string, link: string, statePrefix: string|null}>}
 */
export function parseInciwebIndex(rssText) {
  if (typeof rssText !== 'string') return [];
  const entries = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  for (const [, item] of rssText.matchAll(itemPattern)) {
    const title = item.match(/<title>([^<]+)<\/title>/)?.[1];
    const link = item.match(/<link>([^<]+)<\/link>/)?.[1];
    if (!title || !link || !link.includes('/incident-information/')) continue;
    const [unit, ...nameWords] = title.trim().split(/\s+/);
    if (!unit || !nameWords.length) continue;
    entries.push({
      name: normalizeName(nameWords.join(' ')),
      link: link.replace(/^http:\/\//, 'https://'),
      statePrefix: /^[A-Za-z]{2}/.test(unit)
        ? unit.slice(0, 2).toLowerCase()
        : null,
    });
  }
  return entries;
}

function matchByName(entries, name, state) {
  if (!name) return null;
  const wanted = normalizeName(name);
  const candidates = entries.filter((entry) => entry.name === wanted);
  if (candidates.length === 1) return candidates[0].link;
  if (candidates.length > 1) {
    const statePrefix =
      typeof state === 'string' && /^US-[A-Za-z]{2}$/.test(state)
        ? state.slice(3).toLowerCase()
        : null;
    if (!statePrefix) return null;
    const byState = candidates.filter(
      (entry) => entry.statePrefix === statePrefix,
    );
    if (byState.length === 1) return byState[0].link;
  }
  return null;
}

/**
 * Resolve one WFIGS incident to its InciWeb page, or null.
 * The incident's own name is tried first; a member of a complex whose own
 * name has no page falls back to the complex's page (InciWeb tracks the
 * managing complex, not each member fire). A unique name match wins
 * outright; an ambiguous name needs the WFIGS origin state (US-XX) to
 * agree with the dispatch unit's state prefix — anything still ambiguous
 * yields null rather than a wrong page.
 * @param {Array} entries - Parsed index.
 * @param {{name: ?string, state: ?string, complexName: ?string}} incident
 *   - WFIGS row facts.
 * @returns {?string} InciWeb URL.
 */
export function findInciwebLink(entries, { name, state, complexName }) {
  return (
    matchByName(entries, name, state) ??
    matchByName(entries, complexName, state)
  );
}

/** Fetch and parse the current InciWeb index. */
export function createInciwebIndexSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getIndex({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(RSS_URL, { signal });
      if (!response.ok) throw new Error(`InciWeb HTTP ${response.status}`);
      const text = await response.text();
      signal?.throwIfAborted();
      return parseInciwebIndex(text);
    },
  };
}
