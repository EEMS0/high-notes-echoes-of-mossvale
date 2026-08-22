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

assert.ok(executablePath, 'Chrome or Edge is required for save recovery QA');

(async () => {
  const failures = [];
  let collectRuntimeFailures = true;
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => { if (collectRuntimeFailures) failures.push(`pageerror: ${error.message}`); });
  page.on('console', (message) => {
    if (collectRuntimeFailures && message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (collectRuntimeFailures) failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  async function waitForGame() {
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.__HIGH_NOTES__.debug);
  }

  async function seedStorage(seed) {
    /* Navigate away first: the game intentionally saves on pagehide, so seed
       from a same-origin inert document after that lifecycle save has run. */
    collectRuntimeFailures = false;
    await page.goto(new URL('styles.css?save-recovery-seed=' + Date.now(), baseUrl).href,
      { waitUntil: 'domcontentloaded' });
    await page.evaluate((values) => {
      localStorage.clear();
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
    }, seed);
    collectRuntimeFailures = true;
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await waitForGame();
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await waitForGame();

    const saves = await page.evaluate(() => {
      function makeSave(name, beatcoins) {
        return window.__HIGH_NOTES__.debug.sanitizeSave({
          version: 24,
          stage: 1,
          chapter: 1,
          x: 1400,
          y: 1045,
          weeds: [],
          notes: [],
          stageBosses: [],
          bossDefeated: false,
          beatcoins,
          tutorial: { status: 'completed', rewardClaimed: true },
          character: { created: true, displayName: name, classId: 'riffblade' }
        });
      }
      return {
        backup: JSON.stringify(makeSave('Backup Hero', 73)),
        primary: JSON.stringify(makeSave('Primary Hero', 31)),
        oldBackup: JSON.stringify(makeSave('Older Backup', 9)),
        legacy: JSON.stringify(makeSave('Legacy Hero', 55))
      };
    });

    await seedStorage({
      highNotesSaveV7: '{"version":24,"stage":',
      highNotesSaveV7Backup: saves.backup
    });
    assert.equal(await page.locator('#continueButton').isVisible(), true,
      'valid backup exposes Continue when primary JSON is corrupt');
    const recovered = await page.evaluate(() => {
      document.getElementById('continueButton').click();
      const snapshot = window.__HIGH_NOTES__.snapshot();
      window.__HIGH_NOTES__.controller.togglePause(true);
      return {
        started: window.__HIGH_NOTES__.controller.isStarted(),
        name: snapshot.state.character.displayName,
        beatcoins: snapshot.state.beatcoins,
        primary: localStorage.getItem('highNotesSaveV7'),
        backup: localStorage.getItem('highNotesSaveV7Backup')
      };
    });
    assert.equal(recovered.started, true, 'Continue starts from a valid backup');
    assert.equal(recovered.name, 'Backup Hero', 'backup character identity was restored');
    assert.equal(recovered.beatcoins, 73, 'backup progression was restored');
    assert.equal(recovered.backup, saves.backup, 'corrupt primary was never rotated over the valid backup');
    assert.equal(JSON.parse(recovered.primary).beatcoins, 73, 'first safe save repaired the primary slot');

    const corruptPrimary = '{definitely-not-json';
    const incompleteBackup = '{"version":24,"stage":1}';
    await seedStorage({
      highNotesSaveV7: corruptPrimary,
      highNotesSaveV7Backup: incompleteBackup
    });
    const corruptAvailability = await page.evaluate(() => {
      const button = document.getElementById('continueButton');
      return {
        hidden: button.hidden,
        className: button.className,
        ariaHidden: button.getAttribute('aria-hidden'),
        keys: Object.keys(localStorage),
        primary: localStorage.getItem('highNotesSaveV7'),
        backup: localStorage.getItem('highNotesSaveV7Backup')
      };
    });
    assert.equal(corruptAvailability.hidden, true,
      `Continue stays unavailable when no candidate is semantically valid: ${JSON.stringify(corruptAvailability)}`);
    const rejected = await page.evaluate(() => ({
      result: window.__HIGH_NOTES__.continueGame(),
      started: window.__HIGH_NOTES__.controller.isStarted(),
      primary: localStorage.getItem('highNotesSaveV7'),
      backup: localStorage.getItem('highNotesSaveV7Backup')
    }));
    assert.equal(rejected.result, false, 'programmatic Continue explicitly rejects corrupt-only storage');
    assert.equal(rejected.started, false, 'corrupt-only storage cannot launch blank progress');
    assert.equal(rejected.primary, corruptPrimary, 'rejected primary is not silently overwritten');
    assert.equal(rejected.backup, incompleteBackup, 'rejected backup is not silently overwritten');

    await seedStorage({
      highNotesSaveV7: saves.primary,
      highNotesSaveV7Backup: saves.oldBackup
    });
    const rotated = await page.evaluate(() => {
      document.getElementById('continueButton').click();
      const beatcoins = window.__HIGH_NOTES__.debug.grantBeatcoins(1);
      return {
        beatcoins,
        primary: JSON.parse(localStorage.getItem('highNotesSaveV7')),
        backup: JSON.parse(localStorage.getItem('highNotesSaveV7Backup'))
      };
    });
    assert.equal(rotated.beatcoins, 32, 'valid primary progression can be updated');
    assert.equal(rotated.primary.beatcoins, 32, 'new progress is stored in primary');
    assert.equal(rotated.backup.beatcoins, 31, 'previous valid primary rotates into backup before saving');

    await seedStorage({
      highNotesSaveV7: '{broken-primary',
      highNotesSaveV7Backup: '{broken-backup',
      highNotesSaveV6: saves.legacy
    });
    assert.equal(await page.locator('#continueButton').isVisible(), true,
      'valid legacy save remains available behind corrupt current slots');
    const legacy = await page.evaluate(() => {
      const result = window.__HIGH_NOTES__.continueGame();
      const snapshot = window.__HIGH_NOTES__.snapshot();
      return { result, name: snapshot.state.character.displayName, beatcoins: snapshot.state.beatcoins };
    });
    assert.equal(legacy.result, true, 'legacy fallback loads successfully');
    assert.equal(legacy.name, 'Legacy Hero', 'legacy character identity was restored');
    assert.equal(legacy.beatcoins, 55, 'legacy progression was restored');

    collectRuntimeFailures = false;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.evaluate(() => {
        window.confirm = () => true;
        document.getElementById('resetButton').click();
      })
    ]);
    await waitForGame();
    collectRuntimeFailures = true;
    const cleared = await page.evaluate(() => [
      'highNotesSaveV7', 'highNotesSaveV7Backup', 'highNotesSaveV6',
      'highNotesSaveV5', 'highNotesSaveV4', 'highNotesSaveV2'
    ].map((key) => localStorage.getItem(key)));
    assert.deepEqual(cleared, [null, null, null, null, null, null],
      'Reset Adventure clears primary, backup, and every legacy save key');

    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log('Save recovery browser QA passed: backup recovery, corrupt-only rejection, valid rotation, legacy fallback, and full clear.');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
