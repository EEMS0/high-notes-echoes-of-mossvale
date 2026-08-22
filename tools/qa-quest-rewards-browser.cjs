#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const executablePath = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
assert.ok(executablePath, 'Chrome or Edge is required for quest-reward QA');

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
    await page.waitForFunction(() => window.__HIGH_NOTES__);
    await page.evaluate(() => {
      const save = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24, stage: 1, chapter: 4,
        playSeconds: 60,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Reward QA', classId: 'riffblade' },
        home: { greenhouseCrop: 'glowweed', greenhousePlantedAt: 24, heartbloomSeedReady: false },
        professions: { questing: { level: 25, xp: 0 } }
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(save));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__?.firstPerson?.isPlaying());

    const baseline = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    const brad = await page.evaluate(() => window.__HIGH_NOTES__.debug.completeQuest('brad-contract'));
    assert.equal(brad.state.beatcoins, baseline.state.beatcoins + 10, 'Brad pays the advertised 10-coin cashback');
    const bradAgain = await page.evaluate(() => window.__HIGH_NOTES__.debug.completeQuest('brad-contract'));
    assert.equal(bradAgain.state.beatcoins, brad.state.beatcoins, 'quest rewards remain idempotent');

    const beforeAncient = bradAgain;
    const ancient = await page.evaluate(() => window.__HIGH_NOTES__.debug.completeQuest('ancient-speakers'));
    assert.equal(ancient.state.beatcoins, beforeAncient.state.beatcoins, 'Ancient Speakers does not grant unadvertised currency');
    assert.equal(ancient.state.skillPoints, beforeAncient.state.skillPoints + 1, 'Ancient Speakers grants exactly one skill point');
    assert.ok(ancient.state.home.decorations.includes('root-lantern'), 'Ancient Speakers grants the Root Lantern');

    const beforeMara = ancient;
    const mara = await page.evaluate(() => window.__HIGH_NOTES__.debug.completeQuest('mara-pantry'));
    assert.equal(mara.state.beatcoins, beforeMara.state.beatcoins, 'Mara does not grant unadvertised currency');
    assert.equal(mara.state.home.greenhouseCrop, beforeMara.state.home.greenhouseCrop,
      'Mara does not replace a crop already growing');
    assert.equal(mara.state.home.greenhousePlantedAt, beforeMara.state.home.greenhousePlantedAt,
      'Mara preserves the active crop timer');
    assert.equal(mara.state.home.heartbloomSeedReady, true,
      'Mara grants the advertised Heartbloom greenhouse seed for the next open plot');

    const beforeDream = mara;
    const dream = await page.evaluate(() => window.__HIGH_NOTES__.debug.completeQuest('dream-realm'));
    assert.equal(dream.state.beatcoins, beforeDream.state.beatcoins + 15, 'Dream Realm grants exactly 15 Beatcoins');
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log('Quest reward browser QA passed: advertised currency, skill, decoration, and greenhouse-seed rewards are exact and idempotent.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
