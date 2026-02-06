#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';

const cwd = process.cwd();
const pidFile = resolve(cwd, '.preview.pid');
const logFile = resolve(cwd, '.preview.log');
const port = Number(process.env.PREVIEW_PORT || 4173);
const host = process.env.PREVIEW_HOST || '0.0.0.0';
const url = `http://localhost:${port}`;

const cmd = process.argv[2] || 'status';

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!existsSync(pidFile)) return null;
  const text = readFileSync(pidFile, 'utf8').trim();
  const pid = Number(text);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

function killGroup(pid) {
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

function requestHealth(timeoutMs = 1000) {
  return new Promise((resolveHealth) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
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

async function waitForReady(pid, ms = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ms) {
    if (!isPidAlive(pid)) return false;
    // eslint-disable-next-line no-await-in-loop
    const ok = await requestHealth(800);
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function runBuild() {
  const res = spawnSync('npm', ['run', 'build'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

async function start() {
  const existing = readPid();
  if (existing && isPidAlive(existing)) {
    const ok = await requestHealth();
    if (ok) {
      console.log(`preview already running: ${url} (pid ${existing})`);
      return;
    }
    killGroup(existing);
    unlinkSync(pidFile);
  }

  if (!existing) {
    const occupied = await requestHealth();
    if (occupied) {
      console.error(`port ${port} already has an active server. stop it first, then retry.`);
      process.exit(1);
    }
  }

  runBuild();

  const out = openSync(logFile, 'a');
  const child = spawn('npm', ['run', 'preview', '--', '--host', host, '--port', String(port)], {
    cwd,
    detached: true,
    stdio: ['ignore', out, out],
    shell: process.platform === 'win32'
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));

  const ready = await waitForReady(child.pid);
  if (!ready) {
    killGroup(child.pid);
    try {
      unlinkSync(pidFile);
    } catch {
      // ignore
    }
    console.error(`preview failed to become ready. check log: ${logFile}`);
    process.exit(1);
  }

  console.log(`preview ready: ${url}`);
  console.log(`pid: ${child.pid}`);
  console.log(`log: ${logFile}`);
}

async function status() {
  const pid = readPid();
  if (!pid || !isPidAlive(pid)) {
    console.log('preview status: stopped');
    return;
  }

  const ok = await requestHealth();
  if (ok) {
    console.log(`preview status: running (${url}, pid ${pid})`);
  } else {
    console.log(`preview status: process alive but health check failed (pid ${pid})`);
    console.log(`log: ${logFile}`);
  }
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('preview status: already stopped');
    return;
  }

  if (isPidAlive(pid)) {
    killGroup(pid);
  }

  try {
    unlinkSync(pidFile);
  } catch {
    // ignore
  }

  console.log('preview stopped');
}

function logs() {
  console.log(logFile);
}

switch (cmd) {
  case 'start':
    await start();
    break;
  case 'status':
    await status();
    break;
  case 'stop':
    stop();
    break;
  case 'logs':
    logs();
    break;
  default:
    console.error('usage: node scripts/preview-manager.mjs <start|status|stop|logs>');
    process.exit(1);
}
