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

  const streetLine = buildStreetLine(address, ward, district, province);
  const fullAddress = [streetLine, ward, district, province].filter(Boolean).join(', ');

  const searchParts = [
    address,
    streetLine,
    fullAddress,
    ward,
    expandAdminPrefix(ward),
    district,
    expandAdminPrefix(district),
    province,
    expandAdminPrefix(province),
    propertyCode,
    removeDiacritics(address),
    removeDiacritics(streetLine),
    removeDiacritics(fullAddress),
    removeDiacritics(ward),
    removeDiacritics(district),
    removeDiacritics(province),
    removeDiacritics(propertyCode),
  ];

  const searchText = [...new Set(searchParts.filter(Boolean))].join(' ');

  return {
    address,
    street_line: streetLine,
    full_address: fullAddress,
    ward,
    district,
    province,
    ward_norm: removeDiacritics(ward).toLowerCase(),
    district_norm: removeDiacritics(district).toLowerCase(),
    province_norm: removeDiacritics(province).toLowerCase(),
    search_text: searchText,
    search_query_norm: normalizeSearchQuery(fullAddress),
  };
}

module.exports = {
  buildParcelSearchDoc,
  normalizeAdminPrefix,
  normalizeSearchQuery,
  removeDiacritics,
};
