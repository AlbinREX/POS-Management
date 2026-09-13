import { createApp } from './bootstrap';
import { getConfig } from './config';
import { logger } from './security';
createApp()
  .then((app) => app.listen(getConfig().PORT, '0.0.0.0'))
  .catch(() => {
    logger.fatal('API startup failed; verify environment and database availability');
    process.exitCode = 1;
  });
