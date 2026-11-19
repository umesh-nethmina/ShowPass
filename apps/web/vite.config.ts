import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5180),
    strictPort: true,
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:4000',
      '/socket.io': { target: process.env.API_URL ?? 'http://localhost:4000', ws: true },
    },
  },
});
