import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = createServer();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server listening');
});

let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Received shutdown signal, closing server...');
  app.set('shutting-down', true);

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
