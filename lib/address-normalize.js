/**
 * Chuẩn hóa địa chỉ hành chính Việt Nam (phường / quận / thành phố).
 * Dùng chung cho index Elasticsearch và tìm kiếm backend.
 */

const ADMIN_PREFIX_RE = /^(P|Q|TX|TT|TP|Thành phố|Phường|Quận|Thị trấn|Thị xã)\s*[.:]?\s*/i;

function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function removeDiacritics(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeAdminPrefix(value) {
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

function expandAdminPrefix(value) {
  const normalized = normalizeAdminPrefix(value);
  if (!normalized) return '';

  return normalized
    .replace(/^P\.\s+/i, 'Phường ')
    .replace(/^Q\.\s+/i, 'Quận ')
    .replace(/^TX\.\s+/i, 'Thị xã ')
    .replace(/^TT\.\s+/i, 'Thị trấn ')
    .replace(/^TP\.\s+/i, 'Thành phố ');
}

function stripAdminSuffix(address, units) {
  let result = cleanText(address);
  const ordered = [...units].reverse().filter(Boolean);

  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of ordered) {
      const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = cleanText(result.replace(new RegExp(`,?\\s*${escaped}$`, 'i'), ''));
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function buildStreetLine(address, ward, district, province) {
  const units = [ward, district, province].map(normalizeAdminPrefix).filter(Boolean);
  const stripped = stripAdminSuffix(address, units);
  return stripped || cleanText(address);
}

function asciiLower(value) {
  return removeDiacritics(value).toLowerCase();
}

/** House / plot number or relative position note — not a street name. */
function isHouseNoPart(part) {
  const text = cleanText(part);
  if (!text) return false;
  const ascii = asciiLower(text);

  // "73", "54A", "107/112/5", "96 (số cũ)", "138/7 (số cũ 74/9)"
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
function isAlleyPart(part) {
  const ascii = asciiLower(part);
  return /^(ngo|ngach|hem)(\s|\/|$)/.test(ascii);
}

/** Trailing admin leftovers embedded in address (e.g. "Phường An Phú"). */
function isExtraAdminPart(part) {
  const ascii = asciiLower(part);
  return /^(phuong|quan|xa|thi tran|thi xa|huyen|tp\.?|thanh pho)(\s|$)/.test(ascii)
    || /^(p|q|x|tt|tx|h|tp)\.\s/.test(ascii);
}

/**
 * Tách tên đường từ address thửa đất.
 * @returns {{ street_line: string, street_name: string, alley: string, house_no: string }}
 */
function extractStreetName(address, ward, district, province) {
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
    houseNo = parts.shift();
  }

  while (parts.length && isAlleyPart(parts[0])) {
    const next = parts.shift();
    alley = alley ? `${alley}, ${next}` : next;
  }

  return {
    street_line: streetLine,
    street_name: parts.join(', '),
    alley,
    house_no: houseNo,
  };
}

function normalizeSearchQuery(query) {
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

function buildParcelSearchDoc(input) {
  const address = cleanText(input.address);
  const ward = normalizeAdminPrefix(input.ward);
  const district = normalizeAdminPrefix(input.district);
  const province = normalizeAdminPrefix(input.province || 'TP. Hồ Chí Minh');
  const propertyCode = cleanText(input.property_code);

  const extracted = extractStreetName(address, ward, district, province);
  const streetLine = extracted.street_line;
  const streetName = extracted.street_name;
  const fullAddress = [streetLine, ward, district, province].filter(Boolean).join(', ');

  // search_text chỉ phục vụ street search — không nhét ward/district để tránh nhiễu.
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

module.exports = {
  buildParcelSearchDoc,
  extractStreetName,
  normalizeAdminPrefix,
  normalizeSearchQuery,
  removeDiacritics,
};
