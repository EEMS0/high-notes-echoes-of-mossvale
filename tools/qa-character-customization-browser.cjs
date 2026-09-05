#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-character-customization-qa'));
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for browser QA');
fs.mkdirSync(outputDir, { recursive: true });

function saveDataUrl(dataUrl, name) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  assert.ok(match, `${name} did not return a PNG data URL`);
  const destination = path.join(outputDir, name);
  fs.writeFileSync(destination, Buffer.from(match[1], 'base64'));
  return destination;
}

function watchRuntime(page, failures) {
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
}

(async () => {
  const failures = [];
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-background-networking'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    watchRuntime(page, failures);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossCharacter);
    await page.locator('#startButton').click();
    await page.locator('#characterCreator:not([hidden])').waitFor();

    for (const label of ['Tuned Tuft','Echo Braid','Riff Crest','Moss Cap']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      assert.equal(await page.locator('#characterHairChoices .selected').innerText(), label, `${label} selection`);
      assert.equal(await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true', `${label} pressed state`);
    }

    const coverage = await page.evaluate(async () => {
      const instruments = ['guitar','bass','synth','drums','microphone','violin'];
      const hairs = ['tuft','braid','mohawk','cap'];
      const directions = ['south','north','west','east'];
      const loadImage = (source) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${source}`));
        image.src = source;
      });
      const [overlay, ...heroes] = await Promise.all([
        loadImage('assets/sprites/runtime/hero-hair-directions.png'),
        ...instruments.map((instrument) => loadImage(`assets/sprites/runtime/hero-instrument-${instrument}.png`))
      ]);
      const size = 128;
      const metrics = [];

      function alphaMetrics(baseContext, hairContext) {
        const base = baseContext.getImageData(0,0,size,size).data;
        const hair = hairContext.getImageData(0,0,size,size).data;
        let basePixels = 0;
        let hairPixels = 0;
        let overlapPixels = 0;
        for (let index = 3; index < base.length; index += 4) {
          const baseOpaque = base[index] > 32;
          const hairOpaque = hair[index] > 32;
          if (baseOpaque) basePixels += 1;
          if (hairOpaque) hairPixels += 1;
          if (baseOpaque && hairOpaque) overlapPixels += 1;
        }
        return { basePixels, hairPixels, overlapPixels, overlapRatio: overlapPixels / Math.max(1,hairPixels) };
      }

      for (let instrumentIndex = 0; instrumentIndex < instruments.length; instrumentIndex += 1) {
        const hero = heroes[instrumentIndex];
        const cellWidth = hero.naturalWidth / 4;
        const cellHeight = hero.naturalHeight / 4;
        for (const hair of hairs) {
          for (let row = 0; row < 4; row += 1) {
            for (let column = 0; column < 4; column += 1) {
              const baseCanvas = document.createElement('canvas');
              const hairCanvas = document.createElement('canvas');
              baseCanvas.width = hairCanvas.width = size;
              baseCanvas.height = hairCanvas.height = size;
              const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
              const hairContext = hairCanvas.getContext('2d', { willReadFrequently: true });
              baseContext.imageSmoothingEnabled = false;
              hairContext.imageSmoothingEnabled = false;
              baseContext.drawImage(hero,column*cellWidth,row*cellHeight,cellWidth,cellHeight,0,0,size,size);
              const direction = directions[column];
              const placement = window.MossCharacter.getHairPlacement({hair},size/2,size,size,direction,{row,anchorY:1});
              hairContext.drawImage(overlay,placement.sourceX,placement.sourceY,placement.sourceWidth,placement.sourceHeight,
                placement.x,placement.y,placement.width,placement.height);
              metrics.push({instrument:instruments[instrumentIndex],hair,direction,row,...alphaMetrics(baseContext,hairContext)});
            }
          }
        }
      }

      function drawComposite(context, hero, hair, row, column, dx, dy, drawSize) {
        const cellWidth = hero.naturalWidth / 4;
        const cellHeight = hero.naturalHeight / 4;
        const direction = directions[column];
        context.drawImage(hero,column*cellWidth,row*cellHeight,cellWidth,cellHeight,dx,dy,drawSize,drawSize);
        context.save();
        context.translate(dx,dy);
        window.MossCharacter.decorate(context,{body:'fern',hair,outfit:'grove',accent:'mint'},
          drawSize/2,drawSize,drawSize,direction,{row,anchorY:1});
        context.restore();
      }

      const styleSize = 150;
      const stylesCanvas = document.createElement('canvas');
      stylesCanvas.width = styleSize * hairs.length;
      stylesCanvas.height = styleSize * directions.length;
      const stylesContext = stylesCanvas.getContext('2d');
      stylesContext.imageSmoothingEnabled = false;
      for (let hairIndex = 0; hairIndex < hairs.length; hairIndex += 1) {
        for (let column = 0; column < directions.length; column += 1) {
          drawComposite(stylesContext,heroes[0],hairs[hairIndex],1,column,hairIndex*styleSize,column*styleSize,styleSize);
        }
      }

      const actionSize = 140;
      const actionsCanvas = document.createElement('canvas');
      actionsCanvas.width = actionSize * instruments.length;
      actionsCanvas.height = actionSize * 4;
      const actionsContext = actionsCanvas.getContext('2d');
      actionsContext.imageSmoothingEnabled = false;
      for (let instrumentIndex = 0; instrumentIndex < instruments.length; instrumentIndex += 1) {
        for (let row = 0; row < 4; row += 1) {
          drawComposite(actionsContext,heroes[instrumentIndex],'braid',row,0,instrumentIndex*actionSize,row*actionSize,actionSize);
        }
      }

      const dashEastCanvas = document.createElement('canvas');
      dashEastCanvas.width = actionSize * instruments.length;
      dashEastCanvas.height = actionSize * hairs.length;
      const dashEastContext = dashEastCanvas.getContext('2d');
      dashEastContext.imageSmoothingEnabled = false;
      for (let instrumentIndex = 0; instrumentIndex < instruments.length; instrumentIndex += 1) {
        for (let hairIndex = 0; hairIndex < hairs.length; hairIndex += 1) {
          drawComposite(dashEastContext,heroes[instrumentIndex],hairs[hairIndex],3,3,
            instrumentIndex*actionSize,hairIndex*actionSize,actionSize);
        }
      }

      return {
        metrics,
        styles:stylesCanvas.toDataURL('image/png'),
        actions:actionsCanvas.toDataURL('image/png'),
        dashEast:dashEastCanvas.toDataURL('image/png')
      };
    });

    assert.equal(coverage.metrics.length, 384, 'complete customization matrix');
    for (const metric of coverage.metrics) {
      assert.ok(metric.basePixels > 700, `${metric.instrument}/${metric.row}/${metric.direction} base sprite is empty`);
      assert.ok(metric.hairPixels > 180, `${metric.hair}/${metric.direction} hair sprite is empty`);
      assert.ok(metric.overlapRatio >= 0.08,
        `${metric.instrument}/${metric.hair}/${metric.row}/${metric.direction} is detached (${metric.overlapRatio.toFixed(3)})`);
    }
    saveDataUrl(coverage.styles, 'all-styles-all-directions.png');
    saveDataUrl(coverage.actions, 'all-instruments-all-actions.png');
    saveDataUrl(coverage.dashEast, 'all-instruments-dash-east-all-styles.png');
    const worst = coverage.metrics.reduce((current, metric) => metric.overlapRatio < current.overlapRatio ? metric : current);
    console.log(`Minimum hair/body overlap ${(worst.overlapRatio * 100).toFixed(1)}%: ${worst.instrument}/${worst.hair}/row-${worst.row}/${worst.direction}`);

   await page.locator('#confirmCharacter').click();
    await page.locator('#interfaceSetupBegin').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().runtime.started === true);
    await page.evaluate(() => window.__HIGH_NOTES__.debug.grantAll());
    for (const instrument of ['guitar','bass','synth','drums','microphone','violin']) {
      assert.equal(await page.evaluate((id) => window.__HIGH_NOTES__.debug.equipInstrument(id), instrument), instrument);
      for (const hair of ['tuft','braid','mohawk','cap']) {
        const sanitized = await page.evaluate((id) => window.__HIGH_NOTES__.debug.setAppearance({body:'umber',hair:id,outfit:'sky',accent:'gold'}), hair);
        assert.equal(sanitized.hair, hair, `${instrument}/${hair} in-game appearance`);
        for (const direction of ['south','north','west','east']) {
          assert.equal(await page.evaluate((id) => window.__HIGH_NOTES__.debug.setFacing(id), direction), direction);
        }
      }
    }
    await page.waitForTimeout(100);
    await page.screenshot({path:path.join(outputDir,'in-game-final-combination.png')});
    await context.close();
  } finally {
    await browser.close();
  }

  assert.deepEqual(failures, [], `Browser runtime failures:\n${failures.join('\n')}`);
  console.log(`Character customization browser QA passed: 384 attached sprite combinations. Screenshots: ${outputDir}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
