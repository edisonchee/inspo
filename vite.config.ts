/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { inspoApi } from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), inspoApi()],
  server: { host: true, port: 5173, strictPort: true, watch: { ignored: ['**/data/**'] } },
  preview: { host: true, port: 4173, strictPort: true },
  test: { include: ['{src,server}/**/*.test.ts'] },
});
