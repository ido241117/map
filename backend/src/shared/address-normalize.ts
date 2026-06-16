// Re-export shared normalization used by indexer and API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../../../lib/address-normalize.js');

export const buildParcelSearchDoc = lib.buildParcelSearchDoc;
export const normalizeAdminPrefix = lib.normalizeAdminPrefix;
export const normalizeSearchQuery = lib.normalizeSearchQuery;
export const removeDiacritics = lib.removeDiacritics;
