#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
assert.ok(executablePath, 'Chrome or Edge is required for performance QA');

function percentile(values, amount) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * amount))] || 0;
}

(async () => {
  const failures = [];
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossLivingResonance);
    const titleResources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      bytes: entry.encodedBodySize || entry.transferSize || 0
    })));
    const titleBytes = titleResources.reduce((total, entry) => total + entry.bytes, 0);
    const titleSpriteSheets = titleResources.filter((entry) => /\/Sprites\/.*\.png(?:\?|$)/.test(entry.name));
    assert.ok(titleResources.length < 80, `title request count remains bounded (${titleResources.length})`);
    assert.ok(titleBytes < 25 * 1024 * 1024, `title transfer remains below 25 MiB (${(titleBytes / 1048576).toFixed(2)} MiB)`);
    assert.ok(titleSpriteSheets.length <= 1 && titleSpriteSheets.every((entry) => /\/Sprites\/Portraits\/brad\//.test(entry.name)),
      `the title loads no production sheets beyond its small Brad shop portrait: ${titleSpriteSheets.map((entry) => entry.name).join(', ')}`);

    await page.evaluate(() => {
      const living = window.MossLivingResonance.freshState();
      living.classMastery.riffblade.xp = 680;
      living.classMastery.riffblade.level = 6;
      const raw = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24,
        stage: 4,
        chapter: 4,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Performance QA', classId: 'riffblade' },
        bossDefeated: true,
        campaignFinaleSeen: true,
        stageBosses: ['nullspeaker', 'rootbound', 'prism-choir', 'tidebreaker'],
        chapterRelics: ['rootsong', 'skyglass', 'moonwake'],
        living
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossLivingResonance);
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());

    const frameTimes = await page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      let previous = performance.now();
      function sample(now) {
        frames.push(now - previous);
        previous = now;
        if (frames.length >= 181) resolve(frames.slice(1));
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }));
    const p95 = percentile(frameTimes, .95);
    const worst = Math.max(...frameTimes);
    assert.ok(p95 < 50, `gameplay frame-time p95 remains below 50 ms (${p95.toFixed(2)} ms)`);
    assert.ok(worst < 250, `gameplay worst sampled frame remains below 250 ms (${worst.toFixed(2)} ms)`);

    await page.evaluate(() => window.__HIGH_NOTES__.debug.openLiving('mastery'));
    await page.locator('#livingPanel:not([hidden])').waitFor();
    for (const tab of ['synergies', 'restoration', 'rehearsal', 'loadouts', 'encore', 'mastery']) {
      await page.locator(`[data-living-tab="${tab}"]`).click();
      await page.waitForTimeout(40);
    }
    const imageFailures = await page.locator('#livingPanel img').evaluateAll((images) => images.filter((image) => !image.complete || !image.naturalWidth).map((image) => image.src));
    assert.deepEqual(imageFailures, [], 'visible Living Resonance images decode successfully');

    const runtime = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, bytes: entry.encodedBodySize || entry.transferSize || 0 }));
      return {
        requestCount: resources.length,
        bytes: resources.reduce((total, entry) => total + entry.bytes, 0),
        livingImages: resources.filter((entry) => /\/assets\/ui\/living-resonance\/.*\.webp(?:\?|$)/i.test(entry.name)).length,
        domNodes: document.getElementsByTagName('*').length
      };
    });
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');
    const chromeMetrics = await client.send('Performance.getMetrics');
    const metric = (name) => chromeMetrics.metrics.find((entry) => entry.name === name)?.value || 0;
    const heapMiB = metric('JSHeapUsedSize') / 1048576;
    assert.ok(runtime.requestCount < 180, `complete campaign surface request count remains bounded (${runtime.requestCount})`);
    assert.ok(runtime.bytes < 45 * 1024 * 1024, `complete campaign surface transfer remains below 45 MiB (${(runtime.bytes / 1048576).toFixed(2)} MiB)`);
    assert.ok(runtime.livingImages <= 16, `Living Resonance loads no more than its sixteen-image atlas (${runtime.livingImages})`);
    assert.ok(runtime.domNodes < 5000, `live DOM remains bounded (${runtime.domNodes} nodes)`);
    assert.ok(heapMiB < 160, `used JavaScript heap remains below 160 MiB (${heapMiB.toFixed(2)} MiB)`);

    await page.locator('#closeLivingButton').click();
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'gameCanvas');
    await page.keyboard.press('Escape');
    await page.locator('#pauseScreen:not([hidden])').waitFor();
    await page.locator('#pauseProductionButton').click();
    await page.locator('#productionHub:not([hidden])').waitFor();
    await page.locator('[data-production-tab="arena"]').click();
    await page.locator('#v2Training').waitFor();
    await page.waitForFunction(() => {
      const arena = window.HighNotesV2Arena?.debug?.arena;
      return arena?.assetsRequested && arena.arenaLayers.length === 3 && arena.effectSheet.src;
    });
    await page.locator('#v2Training').click();
    await page.locator('#echoArenaCanvas').waitFor();
    await page.waitForTimeout(650);
    const arenaSmoke = await page.evaluate(() => {
      const arena = window.HighNotesV2Arena.debug.arena;
      return {
        active: arena.active,
        fighters: arena.fighters.length,
        width: arena.canvas && arena.canvas.width,
        height: arena.canvas && arena.canvas.height,
        loadedSheets: performance.getEntriesByType('resource').filter((entry) => /\/Sprites\/.*\.png(?:\?|$)/.test(entry.name)).length
      };
    });
    assert.equal(arenaSmoke.active, true, 'deferred Echo Arena assets still start a live training set');
    assert.equal(arenaSmoke.fighters, 2, 'training set creates player and recovery-aware rival');
    assert.deepEqual([arenaSmoke.width, arenaSmoke.height], [900, 500], 'arena retains its fixed simulation canvas');
    assert.ok(arenaSmoke.loadedSheets >= 8, `opening Echo Arena requests its deferred production sheets (${arenaSmoke.loadedSheets})`);
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log(JSON.stringify({
      passed: true,
      title: { requests: titleResources.length, transferMiB: Number((titleBytes / 1048576).toFixed(2)) },
      gameplay: { frameP95Ms: Number(p95.toFixed(2)), worstFrameMs: Number(worst.toFixed(2)), heapMiB: Number(heapMiB.toFixed(2)) },
      completeSurface: { requests: runtime.requestCount, transferMiB: Number((runtime.bytes / 1048576).toFixed(2)), livingImages: runtime.livingImages, domNodes: runtime.domNodes },
      echoArena: arenaSmoke
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
