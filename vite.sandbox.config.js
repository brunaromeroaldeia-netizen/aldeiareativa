// Build da VERSÃO DE TESTES: o mesmo frontend + o backend executado no navegador (PGlite).
// Saída separada em dist-teste/ — não interfere no build de produção (dist/).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const shim = (f) => path.resolve('sandbox/shims', f);

export default defineConfig({
  root: 'sandbox',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^express$/, replacement: shim('express.js') },
      { find: /^pg$/, replacement: shim('pg.js') },
      { find: /^(node:)?crypto$/, replacement: shim('crypto.js') },
      { find: /^(node:)?fs$/, replacement: shim('fs.js') },
      { find: /^(node:)?path$/, replacement: shim('path.js') },
      { find: /^(node:)?url$/, replacement: shim('url.js') },
      { find: /^(node:)?child_process$/, replacement: shim('noop.js') },
      { find: /^multer$/, replacement: shim('multer.js') },
      { find: /^xlsx$/, replacement: shim('xlsx.js') },
      { find: /^nodemailer$/, replacement: shim('noop.js') },
      { find: /^express-rate-limit$/, replacement: shim('noop.js') },
      { find: /^dotenv\/config$/, replacement: shim('noop.js') },
    ],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({ APP_URL: 'https://aldeia-reativa.teste', APP_TIMEZONE: 'America/Sao_Paulo' }),
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    outDir: '../dist-teste',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 5000,
    // fontes embutidas na página; binários do banco ficam como arquivos separados
    assetsInlineLimit: (file) => /\.(woff2?|svg|png)$/.test(file),
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
