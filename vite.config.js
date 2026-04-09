import { defineConfig } from 'vite';

export default defineConfig({
  // Vercel sirve el frontend desde la raiz. Si alguna vez vuelves a GitHub Pages,
  // puedes definir VITE_BASE_PATH=/gol_mobile/ en el build.
  base: process.env.VITE_BASE_PATH || '/'
});
