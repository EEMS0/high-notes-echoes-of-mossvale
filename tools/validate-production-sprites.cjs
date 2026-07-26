/* eslint-disable no-console */
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'Sprites');
const EXPRESSIONS = ['neutral', 'happy', 'angry', 'surprised', 'sad', 'talking'];

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function inspectAlpha(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index] === 0) transparent += 1;
    else if (data[index] === 255) opaque += 1;
    else partial += 1;
  }
  const corners = [
    data[3],
    data[(info.width - 1) * info.channels + 3],
    data[((info.height - 1) * info.width) * info.channels + 3],
    data[((info.height * info.width) - 1) * info.channels + 3]
  ];
  return { transparent, partial, opaque, corners, info };
}

async function main() {
  const globalPath = path.join(OUT, 'manifest.json');
  const globalManifest = JSON.parse(await fsp.readFile(globalPath, 'utf8'));
  const failures = [];
  const warnings = [];
  const hashes = new Map();
  const categoryCounts = {};
  let portraitCount = 0;
  let alphaSafeSheets = 0;

  for (const entry of globalManifest.entries) {
    categoryCounts[entry.group] = (categoryCounts[entry.group] || 0) + 1;
    const sheetPath = path.join(OUT, entry.sheet);
    const manifestPath = path.join(OUT, entry.manifest);
    if (!(await exists(sheetPath))) {
      failures.push(`${entry.id}: missing sheet ${entry.sheet}`);
      continue;
    }
    if (!(await exists(manifestPath))) {
      failures.push(`${entry.id}: missing manifest ${entry.manifest}`);
      continue;
    }
    const metadata = await sharp(sheetPath).metadata();
    const expectedWidth = entry.frameSize * 12;
    const expectedHeight = entry.frameSize * 26;
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      failures.push(`${entry.id}: ${metadata.width}×${metadata.height}; expected ${expectedWidth}×${expectedHeight}`);
    }
    if (!metadata.hasAlpha || metadata.channels !== 4) failures.push(`${entry.id}: sheet does not expose RGBA alpha`);
    const alpha = await inspectAlpha(sheetPath);
    if (alpha.transparent === 0 || alpha.opaque === 0) failures.push(`${entry.id}: alpha plane lacks transparent or visible pixels`);
    if (alpha.corners.some((value) => value !== 0)) failures.push(`${entry.id}: one or more outer corners are not transparent`);
    else alphaSafeSheets += 1;

    const bytes = await fsp.readFile(sheetPath);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!hashes.has(hash)) hashes.set(hash, []);
    hashes.get(hash).push(entry.name);

    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    if (manifest.frame.columns !== 12 || manifest.frame.rows !== 26) failures.push(`${entry.id}: malformed frame grid`);
    const animationIds = Object.keys(manifest.animations || {});
    if (animationIds.length !== 26) failures.push(`${entry.id}: ${animationIds.length} animation rows; expected 26`);
    for (const [animationId, animation] of Object.entries(manifest.animations || {})) {
      if (animation.frames.length !== animation.frameCount) {
        failures.push(`${entry.id}/${animationId}: frame array length does not match frameCount`);
      }
      for (const frame of animation.frames) {
        if (
          frame.x < 0 ||
          frame.y < 0 ||
          frame.x + frame.width > metadata.width ||
          frame.y + frame.height > metadata.height
        ) {
          failures.push(`${entry.id}/${animationId}: frame rectangle leaves sheet bounds`);
          break;
        }
      }
    }
    for (const expression of EXPRESSIONS) {
      const relative = manifest.portraits && manifest.portraits[expression];
      if (!relative) {
        failures.push(`${entry.id}: missing ${expression} portrait reference`);
        continue;
      }
      const portraitPath = path.join(ROOT, relative);
      if (!(await exists(portraitPath))) {
        failures.push(`${entry.id}: missing ${expression} portrait file`);
        continue;
      }
      const portraitMeta = await sharp(portraitPath).metadata();
      if (portraitMeta.width !== 128 || portraitMeta.height !== 128 || !portraitMeta.hasAlpha) {
        failures.push(`${entry.id}: ${expression} portrait is not a transparent 128×128 PNG`);
      }
      portraitCount += 1;
    }
  }

  const duplicates = [...hashes.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([hash, names]) => ({ hash, names }));
  if (duplicates.length) warnings.push(`${duplicates.length} duplicate whole-sheet hash group(s)`);

  const odinSheet = path.join(OUT, 'Companions', 'Odin', 'odin-expanded-actions-sheet.png');
  const odinManifestPath = path.join(OUT, 'Companions', 'Odin', 'odin-expanded-actions.json');
  if (!(await exists(odinSheet)) || !(await exists(odinManifestPath))) {
    failures.push('Odin expanded action sheet or manifest missing');
  } else {
    const metadata = await sharp(odinSheet).metadata();
    if (metadata.width !== 640 || metadata.height !== 1440 || !metadata.hasAlpha) {
      failures.push(`Odin expanded sheet is ${metadata.width}×${metadata.height}; expected 640×1440 RGBA`);
    }
    const manifest = JSON.parse(await fsp.readFile(odinManifestPath, 'utf8'));
    if (Object.keys(manifest.animations || {}).length !== 18) failures.push('Odin expanded manifest does not contain 18 actions');
  }

  const effectsPath = path.join(OUT, 'Effects', 'combat-effects-sheet.png');
  if (!(await exists(effectsPath))) failures.push('Shared combat effect sheet missing');
  else {
    const metadata = await sharp(effectsPath).metadata();
    if (metadata.width !== 512 || metadata.height !== 512 || !metadata.hasAlpha) {
      failures.push(`Effects sheet is ${metadata.width}×${metadata.height}; expected 512×512 RGBA`);
    }
  }

  const masterFiles = ['npc-musician-turnarounds.png', 'missing-regional-enemies.png', 'elites-key-poses.png', 'miniboss-roster.png', 'odin-expanded-actions.png'];
  const masterAlpha = {};
  for (const file of masterFiles) {
    const filePath = path.join(OUT, '_Masters', 'transparent', file);
    if (!(await exists(filePath))) {
      failures.push(`Transparent source master missing: ${file}`);
      continue;
    }
    const alpha = await inspectAlpha(filePath);
    masterAlpha[file] = {
      transparentPixels: alpha.transparent,
      partiallyTransparentPixels: alpha.partial,
      opaquePixels: alpha.opaque,
      transparentCorners: alpha.corners.every((value) => value === 0)
    };
    if (!masterAlpha[file].transparentCorners) failures.push(`${file}: chroma-key background remains at a corner`);
  }

  const expectedCounts = { npc: 38, enemy: 40, elite: 8, boss: 15, companion: 1 };
  for (const [group, expected] of Object.entries(expectedCounts)) {
    if (categoryCounts[group] !== expected) failures.push(`${group}: ${categoryCounts[group] || 0} entries; expected ${expected}`);
  }
  if (portraitCount !== globalManifest.entries.length * 6) {
    failures.push(`${portraitCount} portraits found; expected ${globalManifest.entries.length * 6}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    totals: {
      sheetsExpected: globalManifest.entries.length,
      sheetsValidated: globalManifest.entries.length - failures.filter((failure) => failure.includes('missing sheet')).length,
      alphaSafeSheets,
      portraitsValidated: portraitCount,
      categories: categoryCounts,
      uniqueWholeSheetHashes: hashes.size
    },
    standards: {
      columns: 12,
      rows: 26,
      transparentPng: true,
      requiredPortraitExpressions: EXPRESSIONS,
      odinExpandedActions: 18,
      sharedEffectFamilies: 8
    },
    transparentMasterAlpha: masterAlpha,
    duplicateWholeSheetHashes: duplicates,
    warnings,
    failures
  };
  await fsp.writeFile(path.join(OUT, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
