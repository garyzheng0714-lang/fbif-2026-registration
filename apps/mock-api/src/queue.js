import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function computeBackoffMs({ attempt, baseMs, maxMs }) {
  const exp = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxMs, exp + jitter);
}

async function readJobFile(filePath) {
  const text = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function listJsonFiles(dirPath) {
  const names = await fs.promises.readdir(dirPath);
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dirPath, name));
}

export function createDiskQueue(options) {
  const dir = options.dir;
  const concurrency = Math.max(1, Number(options.concurrency || 2));
  const tickMs = Math.max(200, Number(options.tickMs || 1000));
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 10));
  const backoffBaseMs = Math.max(200, Number(options.backoffBaseMs || 1000));
  const backoffMaxMs = Math.max(backoffBaseMs, Number(options.backoffMaxMs || 5 * 60 * 1000));
  const logger = options.logger || console;
  const processJob = options.processJob;

  if (!dir) throw new Error('queue dir is required');
  if (typeof processJob !== 'function') throw new Error('queue processJob is required');

  const pendingDir = path.join(dir, 'pending');
  const processingDir = path.join(dir, 'processing');
  const deadDir = path.join(dir, 'dead');

  let running = 0;
  let ticking = false;
  let timer = null;

  function init() {
    ensureDir(pendingDir);
    ensureDir(processingDir);
    ensureDir(deadDir);
  }

  async function recoverProcessing() {
    const processingFiles = await listJsonFiles(processingDir);
    for (const filePath of processingFiles) {
      const base = path.basename(filePath);
      const target = path.join(pendingDir, base);
      try {
        await fs.promises.rename(filePath, target);
      } catch (error) {
        logger.error('queue recover failed:', base, error instanceof Error ? error.message : String(error));
      }
    }
  }

  function enqueue(jobId, jobPayload) {
    const filePath = path.join(pendingDir, `${jobId}.json`);
    atomicWriteJson(filePath, jobPayload);
  }

  async function pickNextDueJobPath() {
    const files = await listJsonFiles(pendingDir);
    if (files.length === 0) return null;

    const now = Date.now();
    const candidates = [];

    for (const filePath of files) {
      try {
        const job = await readJobFile(filePath);
        const nextRunAtMs = Number(job?.nextRunAtMs || 0);
        if (!nextRunAtMs || nextRunAtMs <= now) {
          candidates.push({ filePath, nextRunAtMs });
        }
      } catch (error) {
        logger.error('queue read pending job failed:', path.basename(filePath), error instanceof Error ? error.message : String(error));
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.nextRunAtMs - b.nextRunAtMs);
    return candidates[0].filePath;
  }

  async function runOne(pendingPath) {
    const base = path.basename(pendingPath);
    const processingPath = path.join(processingDir, base);

    try {
      await fs.promises.rename(pendingPath, processingPath);
    } catch (error) {
      // Likely picked by another runner; ignore.
      return;
    }

    let job;
    try {
      job = await readJobFile(processingPath);
    } catch (error) {
      logger.error('queue read processing job failed:', base, error instanceof Error ? error.message : String(error));
      try {
        await fs.promises.rename(processingPath, path.join(deadDir, base));
      } catch {}
      return;
    }

    const attempt = Number(job?.attempts || 0) + 1;
    const jobId = String(job?.id || base.replace(/\.json$/, ''));
    const startedAt = Date.now();

    try {
      await processJob(job);
      await fs.promises.unlink(processingPath);
      logger.log('queue job ok:', jobId, `attempt=${attempt}`, `ms=${Date.now() - startedAt}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextJob = {
        ...job,
        id: jobId,
        attempts: attempt,
        maxAttempts: Number(job?.maxAttempts || maxAttempts),
        lastError: message,
        updatedAt: new Date().toISOString()
      };

      const allowedAttempts = Number(nextJob.maxAttempts || maxAttempts);
      if (attempt >= allowedAttempts) {
        try {
          atomicWriteJson(processingPath, nextJob);
        } catch {}
        try {
          await fs.promises.rename(processingPath, path.join(deadDir, base));
        } catch {}
        logger.error('queue job dead:', jobId, `attempt=${attempt}`, message);
        return;
      }

      const backoffMs = computeBackoffMs({
        attempt,
        baseMs: backoffBaseMs,
        maxMs: backoffMaxMs
      });

      nextJob.nextRunAtMs = Date.now() + backoffMs;
      nextJob.retryInMs = backoffMs;

      try {
        atomicWriteJson(processingPath, nextJob);
      } catch {}
      try {
        await fs.promises.rename(processingPath, path.join(pendingDir, base));
      } catch {}

      logger.error('queue job retry:', jobId, `attempt=${attempt}`, `backoffMs=${backoffMs}`, message);
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      while (running < concurrency) {
        const nextPath = await pickNextDueJobPath();
        if (!nextPath) break;
        running += 1;
        void runOne(nextPath).finally(() => {
          running -= 1;
          // Keep draining quickly if there are due jobs.
          void tick();
        });
      }
    } finally {
      ticking = false;
    }
  }

  async function start() {
    init();
    await recoverProcessing();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      void tick();
    }, tickMs);
    void tick();
  }

  return {
    enqueue,
    start
  };
}

