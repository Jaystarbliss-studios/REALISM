// ============================================================================
// Bundles source/src/*.js + source/template.html -> standalone ../index.html
//   node source/build.mjs            -> /index.html (minified)
//   node source/build.mjs --readable -> /index.html (unminified)
//   node source/build.mjs --dev      -> /dev.html (unminified + dev.js benchmark)
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const FILES = [
  'quality.js',
  'math.js',
  'earth_geo.js',
  'ecoregions.js',
  'species_engine.js',
  'solar_system.js',
  'biomes.js',
  'assets.js',
  'shaders.js',
  'world.js',
  'audio.js',
  'main.js'
];

const dev = process.argv.includes('--dev');
const readable = dev || process.argv.includes('--readable');
const outName = dev ? 'dev.html' : 'index.html';
if (dev) FILES.push('dev.js');

// Strip ES module import/export statements when concatenating into single standalone script
const stripModuleSyntax = (src) =>
  src
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^\s*export\s+\{[\s\S]*?\};\s*$/gm, '')
    .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ');

let js = FILES.map((f) => stripModuleSyntax(readFileSync(path.join(here, 'src', f), 'utf8'))).join('\n');
const publicUrl = (process.env.REALISM_PUBLIC_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
const ogImageUrl = publicUrl ? `${publicUrl}/assets/realism-social-preview.png` : 'assets/realism-social-preview.png';
const canonicalTag = publicUrl ? `<link rel="canonical" href="${publicUrl}/">` : '';
const ogUrlTag = publicUrl ? `<meta property="og:url" content="${publicUrl}/">` : '';
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8')
  .replace(/__REALISM_OG_IMAGE__/g, ogImageUrl)
  .replace('<!--__REALISM_CANONICAL__-->', canonicalTag)
  .replace('<!--__REALISM_OG_URL__-->', ogUrlTag);

const wrap = (body) =>
  `(async()=>{\n${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.body.dataset.state='error';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message;});`;

let html;
if (readable) {
  html = tpl.replace('/*SCRIPT*/', () => wrap(js));
} else {
  const minWgsl = (s) =>
    s
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1')
      .trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  const code = transformSync(wrap(js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  html = tpl
    .replace(/<style>([^]*?)(?=<\/style>)/, css)
    .replace(/>\s+</g, '><')
    .replace('/*SCRIPT*/', () => code)
    .replace(/<script>\s+/, '<script>')
    .replace(/\s+<\/script>/, '</script>');
}

writeFileSync(path.join(root, outName), html);
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`${outName}: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ' (minified)'}, ${(gz / 1024).toFixed(1)} kB gzipped`);
