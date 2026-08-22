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
assert.ok(executablePath, 'Chrome or Edge is required for sprite-retention QA');

(async () => {
  const failures = [];
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossSprites?.stats);
    await page.evaluate(() => {
      const save = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24,
        stage: 1,
        chapter: 4,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Atlas Soak', classId: 'riffblade' },
        bossDefeated: true,
        stageBosses: ['nullspeaker', 'rootbound', 'prism-choir'],
        chapterRelics: ['rootsong', 'skyglass']
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(save));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__?.firstPerson?.isPlaying());

    const samples = [];
    for (const stage of [1, 2, 3, 4, 1]) {
      if (stage !== 1 || samples.length) {
        await page.evaluate(() => {
          const api = window.__HIGH_NOTES__;
          api.debug.defeatEnemies();
          const hub = api.firstPerson.getLevelData().hub;
          api.debug.teleport(hub.x, hub.y);
        });
        await page.waitForFunction(() => {
          const runtime = window.__HIGH_NOTES__.snapshot().runtime;
          return runtime.projectiles === 0 && !runtime.travelBlockedBy;
        });
        await page.evaluate((target) => window.__HIGH_NOTES__.debug.enterStage(target), stage);
      }
      await page.waitForFunction(() => window.MossSprites.stats().pending === 0, null, { timeout: 20000 });
      const sample = await page.evaluate(() => {
        const stats = window.MossSprites.stats();
        return {
          stage: window.__HIGH_NOTES__.snapshot().state.stage,
          count: stats.count,
          decodedMiB: Number((stats.decodedBytes / 1048576).toFixed(2)),
          ids: stats.ids
        };
      });
      samples.push(sample);
      assert.equal(sample.stage, stage, `travel reaches stage ${stage}`);
      assert.ok(sample.count <= 35, `stage ${stage} retains at most 35 production atlases (${sample.count})`);
      assert.ok(sample.decodedMiB < 300, `stage ${stage} retains under 300 MiB decoded RGBA (${sample.decodedMiB} MiB)`);
    }

    const first = samples[0];
    const returned = samples.at(-1);
    assert.ok(returned.count <= first.count + 2,
      `returning to Mossvale does not retain the intervening regions (${first.count} -> ${returned.count})`);
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log(JSON.stringify({ passed: true, samples }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
