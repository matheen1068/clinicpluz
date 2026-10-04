import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: { CLINIC_API_PROXY_TARGET?: string } };

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['.localhost'],
    proxy: {
      '/api': {
        target: process.env.CLINIC_API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
