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
assert.ok(executablePath, 'Chrome or Edge is required for directional-guard QA');

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
        version: 24,
        stage: 2,
        chapter: 2,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Guard QA', classId: 'groveguard' },
        metEems: true,
        bossDefeated: true,
        stageBosses: ['nullspeaker']
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(save));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__?.firstPerson?.isPlaying());
    await page.locator('#gameCanvas').focus();
    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      api.debug.teleport(1450, 900);
      const player = api.firstPerson.getPlayer();
      player.maxHealth = 12;
      player.health = 12;
      player.facing = 0;
      player.invuln = 0;
    });

    const baseline = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    await page.keyboard.down('f');
    await page.waitForTimeout(25);
    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, player = api.firstPerson.getPlayer();
      api.debug.receiveDamage(3, player.x + 60, player.y);
    });
    await page.keyboard.up('f');
    const perfect = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.equal(perfect.player.health, baseline.player.health, 'a fresh frontal perfect guard negates the hit');
    assert.equal(perfect.state.statistics.perfectBlocks, baseline.state.statistics.perfectBlocks + 1,
      'a fresh frontal guard records a perfect block');

    await page.evaluate(() => { window.__HIGH_NOTES__.firstPerson.getPlayer().invuln = 0; });
    await page.keyboard.down('f');
    await page.waitForTimeout(280);
    const beforeHeld = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, player = api.firstPerson.getPlayer();
      api.debug.receiveDamage(3, player.x + 60, player.y);
    });
    await page.keyboard.up('f');
    const held = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.equal(held.player.health, beforeHeld.player.health - 1, 'a held frontal guard takes one point of heavy-hit chip damage');
    assert.equal(held.state.statistics.blocksPerformed, beforeHeld.state.statistics.blocksPerformed + 1,
      'the held frontal guard is recorded');

    await page.evaluate(() => { window.__HIGH_NOTES__.firstPerson.getPlayer().invuln = 0; });
    await page.keyboard.down('f');
    await page.waitForTimeout(280);
    const beforeRear = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, player = api.firstPerson.getPlayer();
      api.debug.receiveDamage(3, player.x - 60, player.y);
    });
    await page.keyboard.up('f');
    const rear = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.equal(rear.player.health, beforeRear.player.health - 3, 'an attack from behind bypasses the frontal guard');
    assert.equal(rear.state.statistics.blocksPerformed, beforeRear.state.statistics.blocksPerformed,
      'a rear hit is not recorded as blocked');
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log('Directional guard browser QA passed: frontal parry, heavy chip, and rear bypass all behave distinctly.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
