import { SyncService } from './services/sync';
import { logger } from './utils/logger';

async function main() {
  const syncService = new SyncService();

  try {
    await syncService.start();
    logger.info('Application finished successfully.');
    // Explicit exit might be needed if there are hanging handles (though we close DB)
    process.exit(0);
  } catch (error) {
    logger.error('Application finished with errors.');
    process.exit(1);
  }
}

// Global error handlers
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason });
  process.exit(1);
});

main();
