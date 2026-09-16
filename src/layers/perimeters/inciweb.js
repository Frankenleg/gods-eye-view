/** InciWeb incident catalog: full-index fetch and WFIGS-name matching. */

// InciWeb's publication search; an empty title returns the full incident
// catalog (~2k rows, ~200 KB). Permissive CORS, so the browser fetches it
// directly. This supersedes the site's RSS feed, which only carries the
// ~50 most recently updated incidents.
const SEARCH_URL = 'https://inciweb.wildfire.gov/api/single-publication/';

/**
 * Normalize an incident title for matching: lowercase, collapsed whitespace,
 * a leading year dropped ('2026 Coleman Creek'), a trailing 'Fire' dropped
 * ('Coyote Fire') — InciWeb titles carry both decorations inconsistently and
 * WFIGS names carry neither.
 */
function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(19|20)\d{2} /, '')
    .replace(/ fire$/, '');
}

/**
 * Resolve one WFIGS incident against the publication catalog.
 * Only rows whose normalized title equals the incident's normalized name
 * count. Ambiguity resolves by the tau dispatch unit's state prefix, then
 * by newest incident id (same-state duplicates are usually reburns of the
 * same name). The `/node/{id}` link 301s to the canonical page, so no slug
 * construction is needed.
 * @param {?Array} publications - Publication catalog rows.
 * @param {{name: ?string, state: ?string}} incident - WFIGS row facts.
 * @returns {?string} InciWeb node URL.
 */
export function resolveInciwebNodeLink(publications, { name, state }) {
  if (!Array.isArray(publications) || !name) return null;
  const wanted = normalizeName(name);
  let candidates = publications.filter(
    (row) =>
      typeof row?.incident_title === 'string' &&
      /^\d+$/.test(String(row?.incident_id ?? '')) &&
      normalizeName(row.incident_title) === wanted,
  );
  if (candidates.length > 1) {
    const statePrefix =
      typeof state === 'string' && /^US-[A-Za-z]{2}$/.test(state)
        ? state.slice(3).toLowerCase()
        : null;
    if (!statePrefix) return null;
    candidates = candidates.filter(
      (row) =>
        typeof row.tau === 'string' &&
        row.tau.slice(0, 2).toLowerCase() === statePrefix,
    );
    if (candidates.length > 1) {
      candidates = [
        candidates.reduce((a, b) =>
          Number(a.incident_id) >= Number(b.incident_id) ? a : b,
        ),
      ];
    }
  }
  return candidates.length === 1
    ? `https://inciweb.wildfire.gov/node/${candidates[0].incident_id}`
    : null;
}

/**
 * Resolve one WFIGS incident to its InciWeb page, or null.
 * The incident's own name is tried first; a member of a complex whose own
 * name has no page falls back to the complex's page (InciWeb tracks the
 * managing complex, not each member fire). Anything ambiguous yields null
 * rather than a wrong page.
 * @param {?Array} publications - Publication catalog rows.
 * @param {{name: ?string, state: ?string, complexName: ?string}} incident
 *   - WFIGS row facts.
 * @returns {?string} InciWeb URL.
 */
export function findInciwebLink(publications, { name, state, complexName }) {
  return (
    resolveInciwebNodeLink(publications, { name, state }) ??
    resolveInciwebNodeLink(publications, { name: complexName, state })
  );
}

/** Fetch the full InciWeb incident catalog. */
export function createInciwebIndexSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getIndex({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
        signal,
      });
      if (!response.ok) throw new Error(`InciWeb HTTP ${response.status}`);
      const rows = await response.json();
      signal?.throwIfAborted();
      return Array.isArray(rows) ? rows : [];
    },
  };
}
