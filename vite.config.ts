/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { inspoApi } from './server/plugin.ts';

export default defineConfig(({ mode }) => {
  // The API has no login, so listen on this machine only. To reach it from elsewhere (e.g. a VM's
  // forwarded port), set INSPO_HOST=0.0.0.0 in .env.local (gitignored) for that machine.
  const host = loadEnv(mode, process.cwd(), 'INSPO_').INSPO_HOST || '127.0.0.1';
  return {
    plugins: [react(), inspoApi()],
    server: { host, port: 5173, strictPort: true, watch: { ignored: ['**/data/**'] } },
    preview: { host, port: 4173, strictPort: true },
    test: { include: ['{src,server}/**/*.test.ts'] },
  };
});
