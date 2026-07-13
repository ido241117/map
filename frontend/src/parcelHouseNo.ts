/**
 * Tách số nhà từ address thửa (phần trước dấu phẩy đầu).
 * Khớp logic SQL trong MVT (`mvt-builder`) — chỉ số rõ ràng, bỏ ghi chú kiểu
 * "Kề bên" / "Nhà không số" để tránh nhiễu trên map.
 */
export function extractHouseNo(address: string | null | undefined): string {
  if (!address) return '';
  const first = address.split(',')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!first) return '';

  // "Số 6B" / "So 12" → "6B" / "12"
  const soPrefix = /^S.\s+(\S.*)$/u.exec(first);
  if (soPrefix?.[1]) return soPrefix[1].trim();

  // "73", "54A", "107/112/5", "96 (số cũ)"
  if (/^[0-9]+[A-Za-z]?(\/[0-9]+[A-Za-z]?)*(\s*\([^)]*\))?$/.test(first)) {
    return first;
  }

  // "A12"
  if (/^[A-Za-z][0-9]+[A-Za-z]?(\s*\([^)]*\))?$/.test(first)) {
    return first;
  }

  return '';
}
