import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: { CONTROL_API_PROXY_TARGET?: string } };

export default defineConfig({
  base: '/control/',
  plugins: [react()],
  server: {
    proxy: {
      '/api/control': {
        target: process.env.CONTROL_API_PROXY_TARGET ?? 'http://127.0.0.1:8790',
        changeOrigin: false,
      },
    },
  },
});
