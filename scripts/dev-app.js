/**
 * Start backend + frontend for local app (Windows-friendly).
 * Usage: npm run dev
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function start(label, args) {
  const child = spawn(npmCmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('backend', ['run', 'dev:backend']);
start('frontend', ['run', 'dev:frontend']);
