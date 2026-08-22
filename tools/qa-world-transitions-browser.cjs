#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-world-transition-qa'));
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for world-transition QA');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const failures = [];
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));

  async function seedAndContinue(seed) {
    await page.evaluate((raw) => {
      const clean = window.__HIGH_NOTES__.debug.sanitizeSave(raw);
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(clean));
    }, seed);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.__HIGH_NOTES__.debug);
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.__HIGH_NOTES__.debug);

    await seedAndContinue({
      version: 24,
      stage: 1,
      chapter: 2,
      tutorial: { status: 'completed', rewardClaimed: true },
      character: { created: true, displayName: 'Travel Guard QA', classId: 'riffblade' },
      bossDefeated: true,
      stageBosses: ['nullspeaker'],
      notes: ['C', 'E', 'G', 'B'],
      melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
      composed: true
    });

    const blockedBossAttempt = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      api.debug.startBoss();
      const before = api.snapshot();
      api.debug.openMap();
      const stageTwoButton = document.querySelectorAll('#fastTravelList .fast-travel-button')[1];
      const accepted = api.debug.fastTravel(2, false);
      const after = api.snapshot();
      return {
        accepted,
        before: { stage: before.state.stage, boss: before.boss },
        after: { stage: after.state.stage, boss: after.boss, runtime: after.runtime },
        transitionClass: document.body.classList.contains('world-transition'),
        stageTwoDisabled: stageTwoButton && stageTwoButton.disabled,
        stageTwoLabel: stageTwoButton && stageTwoButton.textContent
      };
    });
    assert.equal(blockedBossAttempt.accepted, false, 'live boss travel attempt must be rejected');
    assert.equal(blockedBossAttempt.after.stage, blockedBossAttempt.before.stage, 'blocked travel must preserve the stage');
    assert.deepEqual(blockedBossAttempt.after.boss, blockedBossAttempt.before.boss, 'blocked travel must preserve the live boss');
    assert.equal(blockedBossAttempt.after.runtime.travelBlockedBy, 'boss', 'boss must be the reported block reason');
    assert.equal(blockedBossAttempt.after.runtime.worldTransitionLocked, false, 'rejected travel must not acquire the transition lock');
    assert.equal(blockedBossAttempt.transitionClass, false, 'rejected travel must not start a visual transition');
    assert.equal(blockedBossAttempt.stageTwoDisabled, true, 'map UI must disable travel during a boss encounter');
    assert.match(blockedBossAttempt.stageTwoLabel, /Boss encounter active/, 'map UI must explain the disabled boss route');
    await page.screenshot({ path: path.join(outputDir, 'boss-travel-blocked.png') });

    await seedAndContinue({
      version: 24,
      stage: 1,
      chapter: 2,
      tutorial: { status: 'completed', rewardClaimed: true },
      character: { created: true, displayName: 'Normal Travel QA', classId: 'riffblade' },
      bossDefeated: true,
      stageBosses: ['nullspeaker'],
      home: { unlocked: true },
      firstStageOnboarding: { graceConsumed: true, graceRemaining: 0 },
      notes: ['C', 'E', 'G', 'B'],
      melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
      composed: true
    });

    const mapRoute = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      api.debug.openMap();
      const stageTwoButton = document.querySelectorAll('#fastTravelList .fast-travel-button')[1];
      return {
        disabled: stageTwoButton && stageTwoButton.disabled,
        label: stageTwoButton && stageTwoButton.textContent,
        mapOpen: api.snapshot().runtime.mapOpen
      };
    });
    assert.equal(mapRoute.mapOpen, true, 'normal route starts from the player-facing map');
    assert.equal(mapRoute.disabled, false, 'unlocked safe route is enabled in the map UI');
    assert.match(mapRoute.label, /Travel to hub/, 'map UI describes the safe destination');
    await page.locator('#fastTravelList .fast-travel-button').nth(1).click();

    const normalTravel = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const after = api.snapshot();
      const overlappingAccepted = api.debug.fastTravel(3, false);
      const afterOverlap = api.snapshot();
      return {
        stage: after.state.stage,
        levelName: after.runtime.levelName,
        boss: after.boss,
        lock: after.runtime.worldTransitionLocked,
        source: after.runtime.worldTransitionSource,
        transitionClass: document.body.classList.contains('world-transition'),
        overlappingAccepted,
        overlapStage: afterOverlap.state.stage,
        overlapReason: afterOverlap.runtime.travelBlockedBy
      };
    });
    assert.equal(normalTravel.stage, 2, 'normal travel reaches stage two');
    assert.equal(normalTravel.levelName, 'Rootsong Hollows', 'normal travel activates the destination level');
    assert.equal(normalTravel.boss, null, 'safe travel has no stale boss');
    assert.equal(normalTravel.lock, true, 'successful travel acquires the transition lock');
    assert.equal(normalTravel.source, 'fast-travel', 'transition source is exposed for diagnostics');
    assert.equal(normalTravel.transitionClass, true, 'successful travel starts the visual transition');
    assert.equal(normalTravel.overlappingAccepted, false, 'overlapping transitions must be rejected');
    assert.equal(normalTravel.overlapStage, 2, 'overlapping travel cannot replace the destination');
    assert.equal(normalTravel.overlapReason, 'transition', 'transition lock must be the overlap reason');

    await page.waitForFunction(() => !window.__HIGH_NOTES__.snapshot().runtime.worldTransitionLocked);
    const settled = await page.evaluate(() => ({
      stage: window.__HIGH_NOTES__.snapshot().state.stage,
      transitionClass: document.body.classList.contains('world-transition')
    }));
    assert.equal(settled.stage, 2, 'settled route remains at its destination');
    assert.equal(settled.transitionClass, false, 'transition class is released after travel');
    await page.screenshot({ path: path.join(outputDir, 'normal-fast-travel.png') });

    await page.evaluate(() => {
      window.__HIGH_NOTES__.debug.defeatEnemies();
      window.__HIGH_NOTES__.debug.openMap();
    });
    await page.locator('#fastTravelHome').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().runtime.homeOpen);
    const homeTravel = await page.evaluate(() => ({
      homeOpen: window.__HIGH_NOTES__.snapshot().runtime.homeOpen,
      mapOpen: window.__HIGH_NOTES__.snapshot().runtime.mapOpen
    }));
    assert.equal(homeTravel.homeOpen, true, 'map-to-home route opens the Player Home');
    assert.equal(homeTravel.mapOpen, false, 'map-to-home route closes the map first');

    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`World-transition browser QA passed: live boss preserved, normal travel works, overlap locked. Evidence: ${outputDir}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
