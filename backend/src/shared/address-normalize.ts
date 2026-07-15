/**
 * Chuẩn hóa địa chỉ hành chính Việt Nam (phường / quận / thành phố).
 */

const ADMIN_PREFIX_RE =
  /^(P|Q|TX|TT|TP|Thành phố|Phường|Quận|Thị trấn|Thị xã)\s*[.:]?\s*/i;

function cleanText(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function removeDiacritics(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeAdminPrefix(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';

  let normalized = text
    .replace(/^(P|Q|TX|TT|TP)\.(?=\S)/i, '$1. ')
    .replace(/^(P|Q|TX|TT|TP)\s+(?=\S)/i, (match) => `${match.trim()}. `)
    .replace(/\s+/g, ' ')
    .trim();

  const prefixMatch = normalized.match(/^(P|Q|TX|TT|TP)\.\s+/i);
  if (!prefixMatch) return normalized;

  const prefix = prefixMatch[0];
  const name = normalized.slice(prefix.length).trim();
  if (!name) return normalized;

  const titledName = name
    .split(' ')
    .map((part) => {
      if (!part) return part;
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');

  return `${prefix}${titledName}`;
}

function stripAdminSuffix(address: string, units: string[]): string {
  let result = cleanText(address);
  const ordered = [...units].reverse().filter(Boolean);

  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of ordered) {
      const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = cleanText(
        result.replace(new RegExp(`,?\\s*${escaped}$`, 'i'), ''),
      );
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function buildStreetLine(
  address: unknown,
  ward: unknown,
  district: unknown,
  province: unknown,
): string {
  const units = [ward, district, province].map(normalizeAdminPrefix).filter(Boolean);
  const stripped = stripAdminSuffix(cleanText(address), units);
  return stripped || cleanText(address);
}

function asciiLower(value: unknown): string {
  return removeDiacritics(value).toLowerCase();
}

/** House / plot number or relative position note — not a street name. */
function isHouseNoPart(part: string): boolean {
  const text = cleanText(part);
  if (!text) return false;
  const ascii = asciiLower(text);

  if (/^(so\s*)?\d+[a-z]?(\/\d+[a-z]?)*(\s*\([^)]*\))?$/i.test(ascii)) return true;
  if (/^[a-z]\d+[a-z]?(\s*\([^)]*\))?$/i.test(ascii)) return true;
  if (/^so\s+/.test(ascii)) return true;
  if (/^nha khong so/.test(ascii)) return true;
  if (/^ke (ben )?(nha )?/.test(ascii)) return true;
  if (/^doi dien/.test(ascii)) return true;
  if (/^canh nha/.test(ascii)) return true;
  if (/^\(.*\)$/.test(text)) return true;
  return false;
}

/** Alley / lane segment that precedes the actual street name. */
function isAlleyPart(part: string): boolean {
  const ascii = asciiLower(part);
  return /^(ngo|ngach|hem)(\s|\/|$)/.test(ascii);
}

/** Trailing admin leftovers embedded in address (e.g. "Phường An Phú"). */
function isExtraAdminPart(part: string): boolean {
  const ascii = asciiLower(part);
  return (
    /^(phuong|quan|xa|thi tran|thi xa|huyen|tp\.?|thanh pho)(\s|$)/.test(ascii) ||
    /^(p|q|x|tt|tx|h|tp)\.\s/.test(ascii)
  );
}

export type StreetExtraction = {
  street_line: string;
  street_name: string;
  alley: string;
  house_no: string;
};

/**
 * Tách tên đường từ address thửa đất.
 */
export function extractStreetName(
  address: unknown,
  ward: unknown,
  district: unknown,
  province: unknown,
): StreetExtraction {
  const streetLine = buildStreetLine(address, ward, district, province);
  if (!streetLine) {
    return { street_line: '', street_name: '', alley: '', house_no: '' };
  }

  const parts = streetLine
    .split(',')
    .map((part) => cleanText(part))
    .filter(Boolean);

  while (parts.length && isExtraAdminPart(parts[parts.length - 1])) {
    parts.pop();
  }

  let houseNo = '';
  let alley = '';

  if (parts.length && isHouseNoPart(parts[0])) {
    houseNo = parts.shift()!;
  }

  while (parts.length && isAlleyPart(parts[0])) {
    const next = parts.shift()!;
    alley = alley ? `${alley}, ${next}` : next;
  }

  return {
    street_line: streetLine,
    street_name: parts.join(', '),
    alley,
    house_no: houseNo,
  };
}

export function normalizeSearchQuery(query: unknown): string {
  const text = cleanText(query);
  if (!text) return '';

  const parts = text
    .split(',')
    .map((part) => cleanText(part))
    .filter(Boolean)
    .map((part) => {
      if (ADMIN_PREFIX_RE.test(part)) return normalizeAdminPrefix(part);
      return part;
    });

  const joined = parts.join(' ');
  return removeDiacritics(joined).toLowerCase();
}

/** Tối thiểu 2 ký tự chữ/số sau normalize — chặn space / % / _ / punctuation dump search. */
export const MIN_SEARCH_ALNUM = 2;

export function isUsableSearchQuery(query: unknown): boolean {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return false;
  const alnum = normalized.replace(/[^a-z0-9]/g, '');
  return alnum.length >= MIN_SEARCH_ALNUM;
}

/** Escape % _ \ cho PostgreSQL ILIKE ... ESCAPE '\'. */
export function escapeIlikePattern(value: unknown): string {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export type ParcelSearchInput = {
  address?: unknown;
  ward?: unknown;
  district?: unknown;
  province?: unknown;
  property_code?: unknown;
};

export function buildParcelSearchDoc(input: ParcelSearchInput) {
  const address = cleanText(input.address);
  const ward = normalizeAdminPrefix(input.ward);
  const district = normalizeAdminPrefix(input.district);
  const province = normalizeAdminPrefix(input.province || 'TP. Hồ Chí Minh');

  const extracted = extractStreetName(address, ward, district, province);
  const streetLine = extracted.street_line;
  const streetName = extracted.street_name;
  const fullAddress = [streetLine, ward, district, province].filter(Boolean).join(', ');

  const searchParts = [
    streetName,
    streetLine,
    removeDiacritics(streetName),
    removeDiacritics(streetLine),
  ];

  const searchText = [...new Set(searchParts.filter(Boolean))].join(' ');

  return {
    address,
    street_line: streetLine,
    street_name: streetName,
    street_name_norm: asciiLower(streetName),
    full_address: fullAddress,
    ward,
    district,
    province,
    ward_norm: asciiLower(ward),
    district_norm: asciiLower(district),
    province_norm: asciiLower(province),
    search_text: searchText,
    search_query_norm: normalizeSearchQuery(streetName || fullAddress),
  };
}
