import { createFirePerimetersLayer } from '../../layers/perimeters/index.js';
/** Wire WFIGS fire perimeters into the application catalog. */
export function createApplicationFirePerimeters(options) {
  return createFirePerimetersLayer(options);
}
