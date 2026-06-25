const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const ROOT = path.join(__dirname, '..');

// ─── Main process + preloads ─────────────────────────────────────────────────
// 'electron' MUST be external so Electron's built-in takes precedence over
// the npm package in node_modules (which just exports the binary path string).
esbuild.buildSync({
  entryPoints: [
    'src/main/main.ts',
    'src/main/telemetry.ts',
    'src/main/lapStore.ts',
    'src/main/settings.ts',
    'src/overlay/preload.ts',
    'src/control/preload.ts',
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  outbase: 'src',
  sourcemap: true,
  external: [
    'electron',              // CRITICAL: must be external so Electron's built-in resolves
    'irsdk-node',            // pure-JS wrapper — must NOT be bundled (loads native via require)
    '@irsdk-node/native',    // native .node binary — must NOT be bundled
    'node-gyp-build',        // runtime loader for prebuilt binaries
  ],
});

// ─── Renderer scripts ─────────────────────────────────────────────────────────
// These run in the browser context inside Electron's renderer.
// They use window.tvAPI (contextBridge) — no direct electron require.
esbuild.buildSync({
  entryPoints: [
    'src/overlay/overlay.ts',
    'src/control/control.ts',
  ],
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',
  outdir: 'dist',
  outbase: 'src',
  sourcemap: true,
});

// ─── Copy HTML + CSS ─────────────────────────────────────────────────────────
const PAIRS = [
  ['src/overlay/overlay.html', 'dist/overlay/overlay.html'],
  ['src/overlay/overlay.css',  'dist/overlay/overlay.css'],
  ['src/control/control.html', 'dist/control/control.html'],
  ['src/control/control.css',  'dist/control/control.css'],
];

for (const [src, dst] of PAIRS) {
  const from = path.join(ROOT, src);
  const to   = path.join(ROOT, dst);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${src} → ${dst}`);
}

// Copy logo SVG for the overlay header
const logoSrc = path.join(ROOT, 'assets/helmet.svg');
const logoDst = path.join(ROOT, 'dist/overlay/helmet.svg');
if (fs.existsSync(logoSrc)) {
  fs.copyFileSync(logoSrc, logoDst);
  console.log('copied assets/helmet.svg → dist/overlay/helmet.svg');
}

// Copy wheel images so overlay.html can load them as relative paths
const WHEELS_SRC = path.join(ROOT, 'assets/wheels');
const WHEELS_DST = path.join(ROOT, 'dist/overlay/wheels');
if (fs.existsSync(WHEELS_SRC)) {
  fs.mkdirSync(WHEELS_DST, { recursive: true });
  for (const f of fs.readdirSync(WHEELS_SRC)) {
    fs.copyFileSync(path.join(WHEELS_SRC, f), path.join(WHEELS_DST, f));
    console.log(`copied wheels/${f} → dist/overlay/wheels/${f}`);
  }
}

console.log('build complete');
