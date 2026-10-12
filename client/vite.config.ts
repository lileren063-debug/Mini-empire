import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Read the repository-root .env so the dev proxy follows the server's PORT.
  const env = { ...loadEnv(mode, '..', ''), ...process.env };
  const api = env.API_URL ?? `http://localhost:${env.PORT ?? 3000}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: { '/api': { target: api, changeOrigin: true } },
    },
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
