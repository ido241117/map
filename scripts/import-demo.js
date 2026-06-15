/**
 * DEPRECATED: script test 1.000 dòng, không dùng cho dataset production.
 * Dataset chính (~300k dòng) import qua:
 *   npm run db:import        (chỉ chạy khi DB trống)
 *   npm run db:import:force  (ghi đè có chủ đích)
 */

console.error('Script test đã ngừng dùng. Chạy npm run db:status hoặc npm run db:import thay thế.');
process.exit(1);
