import { normalizeFirePerimeterSnapshot } from './records.js';

// NIFC WFIGS current interagency fire perimeters (public, keyless).
// maxAllowableOffset trades ~100 m of boundary fidelity for a payload small
// enough to refresh continuously (~1 MB for a typical fire season).
const API_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?' +
  new URLSearchParams({
    where: '1=1',
    outFields: [
      'poly_IncidentName',
      'attr_UniqueFireIdentifier',
      'attr_IncidentSize',
      'attr_PercentContained',
      'attr_POOState',
      'attr_IncidentTypeCategory',
      'attr_FireDiscoveryDateTime',
      'poly_DateCurrent',
      'attr_FireCause',
      'attr_FireBehaviorGeneral',
      'attr_TotalIncidentPersonnel',
      'attr_POOCounty',
      'attr_EstimatedCostToDate',
      'attr_IncidentComplexityLevel',
    ].join(','),
    maxAllowableOffset: '0.001',
    outSR: '4326',
    f: 'geojson',
  }).toString();

/** Request and validate a complete WFIGS snapshot before it can replace displayed perimeters. */
export function createWfigsPerimeterSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(API_URL, { signal });
      if (!response.ok) throw new Error(`WFIGS HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeFirePerimeterSnapshot(payload);
      if (!rows) throw new Error('Malformed perimeter snapshot');
      return rows;
    },
  };
}
