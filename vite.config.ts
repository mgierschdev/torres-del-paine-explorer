import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/*.test.ts'] },
});
