/**
 * Facts the closing scene quotes about the project itself. They are the
 * counts of the last full verification run (README.md / ARCHITECTURE.md §9);
 * update them together when the suites change.
 */
export const FACTS = {
  unitTests: 181,
  e2eChecks: 170,
  glossaryTerms: 16,
  csvColumns: 26,
  /** JPL Horizons validation, README: maximum error of the ephemerides, degrees. */
  horizonsMaxErrDeg: 0.0023,
  siteDemResM: 20,
};
