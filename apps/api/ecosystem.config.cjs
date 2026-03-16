function parseEnvBool(value, fallback) {
  const raw = String(value ?? '').trim().toLowerCase();

  if (!raw) {
    return fallback;
  }

  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }

  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }

  return fallback;
}

const sharedConfig = {
  env: { ...process.env },
  kill_timeout: 15000,
  combine_logs: true,
  out_file: '/dev/stdout',
  error_file: '/dev/stderr',
  max_restarts: 5,
};

const apps = [
  {
    ...sharedConfig,
    name: 'fbif-api',
    script: 'dist/index.js',
    exec_mode: 'cluster',
    instances: 3,
  },
];

if (parseEnvBool(process.env.RUN_WORKER, true)) {
  apps.push({
    ...sharedConfig,
    name: 'fbif-worker',
    script: 'dist/worker.js',
    exec_mode: 'fork',
    instances: 1,
  });
}

module.exports = { apps };
