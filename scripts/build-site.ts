import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'site');
const output = join(source, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'assets'), { recursive: true });
for (const file of ['index.html', 'style.css', 'script.js', 'favicon.svg', 'og.png', 'robots.txt', 'sitemap.xml', '_headers'])
  copyFileSync(join(source, file), join(output, file));
cpSync(join(source, '.well-known'), join(output, '.well-known'), { recursive: true });
for (const file of ['demo.mp4', 'home.png'])
  copyFileSync(join(root, 'docs', file), join(output, 'assets', file));
console.log('Static site built at site/dist');
