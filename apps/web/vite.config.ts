/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // The API URL is baked in at build time. Without it the site would call localhost and break silently.
  if (command === 'build' && !loadEnv(mode, process.cwd(), '').VITE_API_URL) {
    throw new Error('Set VITE_API_URL to the URL of the API deployed on Render.');
  }
  return {
    plugins: [react()],
    resolve: {
      alias: { '@visitor/shared': resolve(__dirname, '../../packages/shared/src/index.ts') },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
