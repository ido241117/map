/** Khớp backend `isUsableSearchQuery` — tối thiểu 2 chữ/số sau normalize. */
export function isUsableStreetSearchQuery(query: string): boolean {
  const normalized = String(query ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
  if (!normalized) return false;
  const alnum = normalized.replace(/[^a-z0-9]/g, '');
  return alnum.length >= 2;
}
