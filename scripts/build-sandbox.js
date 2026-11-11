// Gera a versão de testes publicável: uma página única (JS e CSS embutidos) + arquivos do banco.
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('dist-teste');
await build({ configFile: path.resolve('vite.sandbox.config.js'), logLevel: 'warn' });

const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const js = [...html.matchAll(/<script[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) => m[1]);
const css = [...html.matchAll(/<link[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) => m[1]);
const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
const page = [
  '<title>Aldeia Reativa Teste</title>',
  '<meta name="robots" content="noindex">',
  ...css.map((f) => `<style>${read(f)}</style>`),
  '<style>html,body,#root{height:100%}</style>',
  '<div id="root"></div>',
  ...js.map((f) => `<script type="module">${read(f).replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD')}</script>`),
].join('\n');
fs.writeFileSync(path.join(out, 'aldeia-reativa-teste.html'), page);

const pg = path.resolve('node_modules/@electric-sql/pglite/dist');
// .data não é um tipo servido nas páginas publicadas: o pacote vai com extensão .wasm (lido como binário)
for (const [from, to] of [['pglite.wasm', 'pglite.wasm'], ['pglite.data', 'pglite-data.wasm'], ['initdb.wasm', 'initdb.wasm']]) fs.copyFileSync(path.join(pg, from), path.join(out, to));
// página "completa" para abrir localmente (testes automatizados)
fs.writeFileSync(path.join(out, 'local.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n${page}\n</body></html>`);
const size = (f) => `${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB`;
console.log('Versão de testes gerada em dist-teste/:', ['aldeia-reativa-teste.html', 'pglite.wasm', 'pglite-data.wasm', 'initdb.wasm'].map((f) => `${f} (${size(f)})`).join(', '));
