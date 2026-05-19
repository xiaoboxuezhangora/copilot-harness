import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { buildShowcaseIntegrationStatus } from '../../scripts/showcase-integration-status';

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    {
      name: 'showcase-integration-status',
      configureServer(server) {
        server.middlewares.use('/api/showcase/integration-status', (_request, response) => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(buildShowcaseIntegrationStatus(process.env), null, 2));
        });
      }
    }
  ]
});
