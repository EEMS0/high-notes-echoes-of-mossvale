'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const expected = [
  ['assets/favicon-16.png',16],['assets/favicon-32.png',32],['assets/favicon-48.png',48],
  ['assets/app-icon-180.png',180],['assets/app-icon-192.png',192],['assets/app-icon-512.png',512],
  ['assets/app-icon-maskable-192.png',192],['assets/app-icon-maskable-512.png',512]
];
(async()=>{
  for(const [relative,size] of expected){
    const file=path.join(root,relative);assert.ok(fs.existsSync(file),relative+' exists');
    const png=fs.readFileSync(file);
    assert.equal(png.subarray(1,4).toString(),'PNG',relative+' is PNG');
    assert.equal(png.readUInt32BE(16),size,relative+' width');assert.equal(png.readUInt32BE(20),size,relative+' height');
  }
  const ico=fs.readFileSync(path.join(root,'favicon.ico'));
  assert.equal(ico.readUInt16LE(2),1,'favicon is an ICO');assert.equal(ico.readUInt16LE(4),3,'favicon contains three sizes');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose==='any'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose==='maskable'));
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/favicon-48\.png\?v=3/);assert.match(html,/apple-touch-icon[^>]+app-icon-180\.png\?v=3/);
  console.log('App icon validation passed: favicon 16/32/48, iOS 180, Android/PWA 192/512, separate maskable 192/512.');
})().catch(error=>{console.error(error);process.exitCode=1;});
