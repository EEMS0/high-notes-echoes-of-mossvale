'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.argv[2] || path.join(root, 'tools', 'icon-source', 'high-notes-app-icon-source.jpg'));
const assets = path.join(root, 'assets');
const brand = path.join(root, 'tools', 'icon-source');

function pngIcon(size) {
  return sharp(source)
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .sharpen({ sigma: .45 })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function maskableIcon(size) {
  const inset = Math.round(size * .78);
  const artwork = await sharp(source).rotate().resize(inset, inset, { fit: 'cover', kernel: sharp.kernel.lanczos3 }).removeAlpha().png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#08041a' } })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

function ico(buffers) {
  const count = buffers.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  buffers.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...buffers.map(icon => icon.data)]);
}

(async () => {
  if (!fs.existsSync(source)) throw new Error(`Source icon not found: ${source}`);
  fs.mkdirSync(brand, { recursive: true });
  const canonical = path.join(brand, 'high-notes-app-icon-source.jpg');
  if (source !== canonical) fs.copyFileSync(source, canonical);

  const faviconSizes = [16, 32, 48];
  const favicons = [];
  for (const size of faviconSizes) {
    const data = await pngIcon(size);
    fs.writeFileSync(path.join(assets, `favicon-${size}.png`), data);
    favicons.push({ size, data });
  }
  fs.writeFileSync(path.join(root, 'favicon.ico'), ico(favicons));

  for (const size of [180, 192, 512]) {
    fs.writeFileSync(path.join(assets, `app-icon-${size}.png`), await pngIcon(size));
  }
  for (const size of [192, 512]) {
    fs.writeFileSync(path.join(assets, `app-icon-maskable-${size}.png`), await maskableIcon(size));
  }
  console.log('Built favicon, iOS, Android and maskable PWA icons from '+path.relative(root, canonical).replace(/\\/g, '/')+'.');
})().catch(error => { console.error(error); process.exitCode = 1; });
