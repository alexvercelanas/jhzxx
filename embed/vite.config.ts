import path from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Cross-version safe directory resolution for ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rawPort = process.env.PORT || '3000';
const port = Number(rawPort) || 3000;
const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_TMDB_API_KEY': JSON.stringify(process.env.TMDB_API_KEY || ''),
    'import.meta.env.VITE_OMSS_URL': JSON.stringify(process.env.VITE_OMSS_URL || ''),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@assets': path.resolve(
        __dirname,
        '..',
        '..',
        'attached_assets'
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});