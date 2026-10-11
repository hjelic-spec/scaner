// Kopira web aplikaciju u www/ — odatle je Capacitor pakira u Android aplikaciju.
// (Web verzija za GitHub Pages i dalje se poslužuje izravno iz korijena repozitorija.)
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const FILES = [
  'index.html', 'privacy.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'sw.js',
  'config.js', 'countries.js', 'fields.js', 'db.js', 'api.js', 'ocr.js', 'app.js',
];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`);
cpSync('vendor', 'www/vendor', { recursive: true });
console.log(`www/: ${FILES.length} datoteka + vendor/`);
