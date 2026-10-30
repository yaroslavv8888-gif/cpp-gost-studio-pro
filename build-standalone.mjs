import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { build as buildWeb } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Always rebuild CSS and application from the active sources, even when called directly.
process.chdir(dirname(fileURLToPath(import.meta.url)));
await buildWeb();
await build({ entryPoints: ['src/main.tsx'], bundle: true, minify: true,
  format: 'iife', outfile: 'public/standalone-pc.js',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' } });
const index = await readFile('dist/index.html', 'utf8');
const cssFile = index.match(/href="\/assets\/([^"\s]+\.css)"/)?.[1];
if (!cssFile) throw new Error('No application stylesheet found in the fresh Vite build.');
const css = await readFile(`dist/assets/${cssFile}`, 'utf8');
await writeFile('public/standalone-pc.css', css);
const js = (await readFile('public/standalone-pc.js', 'utf8')).replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Схема Studio Pro — C++ и блок-схемы</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
await writeFile('ЗАПУСК_НА_ПК.html', html);
console.log('Standalone HTML, JavaScript and CSS rebuilt.');

await writeFile('STUDIO.html', html);
