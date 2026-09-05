'use strict';

// Publish only runtime files. Keep local tooling, relay sources and trailer
// working media out of the public Pages artifact.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
if (fs.existsSync(output)) {
  throw new Error('_site already exists. Move it aside before building a fresh release.');
}
fs.mkdirSync(output);
for (const name of fs.readdirSync(root).sort()) {
  if (/\.(?:js|css|html|ico|webmanifest)$/.test(name) && fs.statSync(path.join(root, name)).isFile()) {
    fs.copyFileSync(path.join(root, name), path.join(output, name));
  }
}
for (const name of ['assets', 'Sprites', 'vendor']) {
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
fs.writeFileSync(path.join(output, '.nojekyll'), '');
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({
  commit: process.env.GITHUB_SHA || 'local',
  name: 'Living Resonance: Guided Tutorial and Interface Scaling'
}, null, 2) + '\n');
console.log('GitHub Pages artifact built in _site.');
