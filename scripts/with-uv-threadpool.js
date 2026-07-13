'use strict';

/**
 * Libuv đọc UV_THREADPOOL_SIZE lúc process Node khởi động.
 * Dotenv trong app là quá muộn — wrapper này set env rồi spawn lệnh thật.
 */
const { spawn } = require('child_process');

if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '64';
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Usage: node scripts/with-uv-threadpool.js <command> [...args]');
  process.exit(1);
}

const child = spawn(cmd, args, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
