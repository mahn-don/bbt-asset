/**
 * Reference instant for one server render.
 *
 * Server Components render once per request and are never re-rendered on the
 * client, so reading the clock during render is safe here — but React's purity
 * lint rule (correctly) cannot tell the two cases apart. Encapsulating the read
 * in one non-component module keeps the rule enforced everywhere it matters,
 * instead of scattering suppressions across every page.
 *
 * Pass the returned value down so every timestamp on a page is relative to the
 * same instant rather than drifting between rows.
 */
export function renderNow(): number {
  return Date.now();
}
