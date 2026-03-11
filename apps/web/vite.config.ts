import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA || 'dev')
  },
  server: {
    port: 5173,
    allowedHosts: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true
  }
});
