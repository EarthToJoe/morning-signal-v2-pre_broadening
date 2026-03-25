import { config } from './config';
import { createApp } from './server/app';
import { logger } from './utils/logger';

const app = createApp();

app.listen(config.port, () => {
  logger.info('Server started', {
    component: 'server',
    port: config.port,
    env: config.nodeEnv,
  });
});
