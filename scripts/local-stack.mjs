#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metaDir = resolve(root, '.local-stack');
const apiPidFile = resolve(metaDir, 'mock-api.pid');
const apiLogFile = resolve(metaDir, 'mock-api.log');

const apiPort = Number(process.env.MOCK_API_PORT || 8080);
const apiUrl = `http://localhost:${apiPort}/health`;

const cmd = process.argv[2] || 'status';

function run(command, args) {
  const res = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function requestHealth(timeoutMs = 1000) {
  return new Promise((resolveHealth) => {
    const req = http.get(apiUrl, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolveHealth(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
    });

    req.on('error', () => resolveHealth(false));
    req.on('timeout', () => {
      req.destroy();
      resolveHealth(false);
    });
  });
}

function readPid(file) {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

async function waitForApiReady(ms = 12000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await requestHealth(800);
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return false;
}

async function startApi() {
  mkdirSync(metaDir, { recursive: true });

  const existing = readPid(apiPidFile);
  if (existing && isPidAlive(existing)) {
    const ok = await requestHealth();
    if (ok) {
      console.log(`mock-api already running on ${apiPort} (pid ${existing})`);
      return;
    }
    killPid(existing);
    try {
      unlinkSync(apiPidFile);
    } catch {
      // ignore
    }
  }

  const out = openSync(apiLogFile, 'a');
  const child = spawn('npm', ['--prefix', 'apps/mock-api', 'run', 'start'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      MOCK_API_PORT: String(apiPort),
      WEB_ORIGIN: process.env.WEB_ORIGIN || 'http://localhost:4173'
    }
  });
  child.unref();
  writeFileSync(apiPidFile, String(child.pid));

  const ready = await waitForApiReady();
  if (!ready) {
    killPid(child.pid);
    try {
      unlinkSync(apiPidFile);
    } catch {
      // ignore
    }
    console.error(`mock-api failed to start. check log: ${apiLogFile}`);
    process.exit(1);
  }

  console.log(`mock-api ready: http://localhost:${apiPort}`);
}

async function startStack() {
  await startApi();
  run('npm', ['--prefix', 'apps/web', 'run', 'preview:start']);
}

async function statusStack() {
  const apiPid = readPid(apiPidFile);
  const apiAlive = apiPid && isPidAlive(apiPid);
  const apiOk = apiAlive ? await requestHealth() : false;

  if (apiAlive && apiOk) {
    console.log(`mock-api status: running (http://localhost:${apiPort}, pid ${apiPid})`);
  } else {
    console.log('mock-api status: stopped');
  }

  run('npm', ['--prefix', 'apps/web', 'run', 'preview:status']);
}

function stopStack() {
  const apiPid = readPid(apiPidFile);
  if (apiPid && isPidAlive(apiPid)) {
    killPid(apiPid);
  }

  try {
    unlinkSync(apiPidFile);
  } catch {
    // ignore
  }

  run('npm', ['--prefix', 'apps/web', 'run', 'preview:stop']);
  console.log('local stack stopped');
}

function logsStack() {
  console.log(`mock-api log: ${apiLogFile}`);
  run('npm', ['--prefix', 'apps/web', 'run', 'preview:logs']);
}

switch (cmd) {
  case 'start':
    await startStack();
    break;
  case 'status':
    await statusStack();
    break;
  case 'stop':
    stopStack();
    break;
  case 'logs':
    logsStack();
    break;
  default:
    console.error('usage: node scripts/local-stack.mjs <start|status|stop|logs>');
    process.exit(1);
}
