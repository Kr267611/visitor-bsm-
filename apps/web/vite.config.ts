/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // API URL build mein hi jud jata hai. Iske bina site localhost se baat karti aur chupchap toot jati.
  if (command === 'build' && !loadEnv(mode, process.cwd(), '').VITE_API_URL) {
    throw new Error('VITE_API_URL set karein: Render par bani API ka URL.');
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
