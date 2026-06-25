const fs   = require('fs');
const path = require('path');

const PAIRS = [
  ['src/overlay/overlay.html', 'dist/overlay/overlay.html'],
  ['src/overlay/overlay.css',  'dist/overlay/overlay.css'],
  ['src/control/control.html', 'dist/control/control.html'],
  ['src/control/control.css',  'dist/control/control.css'],
];

const root = path.join(__dirname, '..');

for (const [src, dst] of PAIRS) {
  const from = path.join(root, src);
  const to   = path.join(root, dst);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${src} → ${dst}`);
}
