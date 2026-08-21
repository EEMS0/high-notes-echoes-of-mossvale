#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-v2-4-living-qa'));
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for Living Resonance browser QA');
fs.mkdirSync(outputDir, { recursive: true });

function watchRuntime(page, label, failures) {
  page.on('pageerror', (error) => failures.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`${label}: console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => failures.push(`${label}: request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
}

async function appReady(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossLivingResonance && window.MossInput);
}

async function seedSave(page, overrides) {
  await page.evaluate((values) => {
    const living = window.MossLivingResonance.freshState();
    living.classMastery.riffblade.xp = 200;
    living.classMastery.riffblade.level = 3;
    const raw = Object.assign({
      version: 24,
      stage: 2,
      chapter: 2,
      x: 488,
      y: 612,
      beatcoins: 37,
      tutorial: { status: 'completed', rewardClaimed: true },
      character: { created: true, displayName: 'Living QA', classId: 'riffblade' },
      bossDefeated: true,
      stageBosses: ['nullspeaker'],
      chapterRelics: ['rootsong'],
      unlockedInstruments: ['guitar', 'bass', 'synth'],
      equippedInstrument: 'synth',
      home: { unlocked: true },
      living
    }, values || {});
    localStorage.clear();
    localStorage.setItem('highNotesSaveV7', JSON.stringify(window.__HIGH_NOTES__.debug.sanitizeSave(raw)));
  }, overrides || {});
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossLivingResonance);
  await page.locator('#continueButton').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
}

async function assertAccessibleSurface(page, label) {
  const audit = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return !element.hidden && !element.closest('[hidden], [inert]') && style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const textForIds = (value) => String(value || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    const unnamed = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="tab"]')).filter(visible).filter((element) => {
      const labels = element.labels ? Array.from(element.labels).map((entry) => entry.textContent || '').join(' ').trim() : '';
      const name = element.getAttribute('aria-label') || textForIds(element.getAttribute('aria-labelledby')) || labels ||
        (['BUTTON', 'A'].includes(element.tagName) ? element.textContent.trim() : '') || element.getAttribute('title');
      return !name;
    }).map((element) => `${element.tagName.toLowerCase()}#${element.id || '(no-id)'}`);
    const unlabelledDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).filter((dialog) => {
      return !(dialog.getAttribute('aria-label') || textForIds(dialog.getAttribute('aria-labelledby')));
    }).map((dialog) => dialog.id || '(no-id)');
    return { unnamed, unlabelledDialogs };
  });
  assert.deepEqual(audit.unnamed, [], `${label}: every visible interactive control has an accessible name`);
  assert.deepEqual(audit.unlabelledDialogs, [], `${label}: every visible dialog has an accessible label`);
}

async function rehearsalChecks(browser, failures) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  watchRuntime(page, 'rehearsal', failures);
  await appReady(page);
  await seedSave(page);

  const canonical = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.debug.openLiving('rehearsal')), true);
  await page.locator('#livingPanel:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'rehearsal hall');
  assert.equal(await page.locator('.rehearsal-card:not(.locked)').count(), 1, 'only canonically defeated bosses unlock for rehearsal');
  await page.locator('.rehearsal-card:not(.locked) select').nth(0).selectOption('standard');
  await page.locator('.rehearsal-card:not(.locked) select').nth(1).selectOption('3');
  await page.locator('.rehearsal-card:not(.locked) button').click();
  await page.locator('#livingConfirmOverlay:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'rehearsal start confirmation');
  const rehearsalConfirmationTitle = await page.locator('#livingConfirmTitle').textContent();
  assert.match(rehearsalConfirmationTitle, /Nullspeaker/i, `rehearsal confirmation names the boss: ${rehearsalConfirmationTitle}`);
  assert.match(await page.locator('#livingConfirmDetails').textContent(), /Feedback 3/, 'rehearsal confirmation names its difficulty');
  assert.equal(await page.locator('#livingConfirmOverlay').evaluate((element) => element.inert), false, 'start confirmation remains interactive');
  await page.locator('#livingConfirmAccept').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().runtime.rehearsalActive);

  const active = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
  assert.equal(active.runtime.rehearsalBossId, 'nullspeaker');
  assert.equal(active.runtime.rehearsalChallenge, 'standard');
  assert.equal(active.runtime.rehearsalFeedback, 3);
  assert.equal(active.state.stage, 1, 'rehearsal loads the selected boss stage');
  assert.equal(active.boss.defId, 'nullspeaker', 'rehearsal starts the selected boss');
  assert.equal(await page.locator('body').evaluate((element) => element.classList.contains('rehearsal-active')), true);

  await page.evaluate(() => {
    window.__HIGH_NOTES__.debug.grantBeatcoins(91);
    window.__HIGH_NOTES__.debug.damage(3);
    window.__HIGH_NOTES__.debug.equipInstrument('guitar');
  });
  await page.keyboard.press('Escape');
  await page.locator('#pauseScreen:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'rehearsal pause');
  assert.equal(await page.locator('#pauseEndRehearsalButton').isVisible(), true, 'pause exposes End Rehearsal');
  for (const id of ['pauseMapButton', 'pauseBackpackButton', 'pauseInstrumentsButton', 'pauseSkillsButton', 'pauseHomeButton', 'pauseLivingButton', 'pauseProductionButton']) {
    assert.equal(await page.locator(`#${id}`).isDisabled(), true, `${id} is unavailable during isolated practice`);
  }
  assert.equal(await page.locator('#pauseSettingsButton').isEnabled(), true, 'accessibility settings remain available during practice');
  assert.equal(await page.locator('#pauseStatisticsButton').isEnabled(), true, 'read-only statistics remain available during practice');
  assert.match(await page.locator('#pauseLocation').textContent(), /progression isolated/, 'pause explains rehearsal isolation');
  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.debug.openMap()), undefined, 'direct map requests are rejected during practice');
  assert.equal((await page.evaluate(() => window.__HIGH_NOTES__.snapshot())).runtime.mapOpen, false);

  await page.locator('#pauseSettingsButton').click();
  await page.locator('#settingsPanel:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'rehearsal settings');
  await page.locator('#closeSettingsButton').click();
  await page.waitForFunction(() => !document.getElementById('pauseScreen').hidden && !document.getElementById('pauseScreen').inert);
  assert.equal((await page.evaluate(() => window.__HIGH_NOTES__.snapshot())).runtime.rehearsalActive, true, 'settings return to the same active rehearsal');

  await page.locator('#pauseEndRehearsalButton').click();
  await page.locator('#livingConfirmOverlay:not([hidden])').waitFor();
  assert.equal(await page.locator('#livingConfirmOverlay').evaluate((element) => element.inert), false, 'abandon confirmation is not trapped beneath pause isolation');
  assert.equal(await page.locator('#pauseScreen').evaluate((element) => element.inert), true, 'pause is isolated behind abandon confirmation');
  await page.locator('#livingConfirmCancel').click();
  await page.waitForFunction(() => document.getElementById('livingConfirmOverlay').hidden && !document.getElementById('pauseScreen').inert);
  assert.equal((await page.evaluate(() => window.__HIGH_NOTES__.snapshot())).runtime.rehearsalActive, true, 'cancelling abandon resumes the protected pause state');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'pauseEndRehearsalButton');
  await page.locator('#pauseEndRehearsalButton').click();
  await page.locator('#livingConfirmOverlay:not([hidden])').waitFor();
  await page.locator('#livingConfirmAccept').click();
  await page.locator('#rehearsalResultsOverlay:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'rehearsal results');
  assert.equal(await page.locator('#rehearsalResultsOverlay').evaluate((element) => element.inert), false, 'results remain interactive after abandoning from pause');
  assert.equal(await page.locator('#pauseScreen').isHidden(), true, 'pause is removed behind results');

  const restored = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
  assert.equal(restored.runtime.rehearsalActive, false);
  assert.equal(restored.state.stage, canonical.state.stage);
  assert.equal(restored.state.beatcoins, canonical.state.beatcoins, 'temporary rehearsal currency is discarded');
  assert.equal(restored.state.equippedInstrument, canonical.state.equippedInstrument, 'temporary loadout changes are discarded');
  assert.equal(restored.player.health, canonical.player.health, 'pre-rehearsal health is restored');
  assert.ok(Math.abs(restored.player.x - canonical.player.x) < 1 && Math.abs(restored.player.y - canonical.player.y) < 1, 'pre-rehearsal location is restored');
  assert.deepEqual(restored.state.stageBosses, canonical.state.stageBosses, 'canonical boss progression is unchanged');
  assert.equal(restored.state.living.rehearsal.records['nullspeaker:standard:3'].completions, 0, 'abandon records metrics without awarding a completion');
  assert.equal(restored.state.living.rehearsal.claimedRewards.includes('nullspeaker:standard:3'), false, 'abandon cannot claim a rehearsal reward');
  await page.screenshot({ path: path.join(outputDir, 'rehearsal-results.png') });

  await page.locator('#rehearsalRetryButton').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().runtime.rehearsalActive);
  await page.evaluate(() => window.__HIGH_NOTES__.debug.finishRehearsal(true));
  await page.locator('#rehearsalResultsOverlay:not([hidden])').waitFor();
  const cleared = await page.evaluate(() => window.__HIGH_NOTES__.snapshot().state.living.rehearsal);
  assert.equal(cleared.records['nullspeaker:standard:3'].completions, 1, 'successful retry records one completion');
  assert.equal(cleared.claimedRewards.filter((entry) => entry === 'nullspeaker:standard:3').length, 1, 'successful retry claim is idempotent');
  await page.locator('#rehearsalArrangeButton').click();
  await page.locator('#livingPanel:not([hidden])').waitFor();

  await page.locator('[data-living-tab="mastery"]').click();
  const unlockedBefore = await page.evaluate(() => window.__HIGH_NOTES__.snapshot().state.living.classMastery.riffblade.unlockedNodes.length);
  await page.locator('.mastery-node-list li.available button').first().click();
  await page.locator('#livingConfirmAccept').click();
  await page.waitForFunction((count) => window.__HIGH_NOTES__.snapshot().state.living.classMastery.riffblade.unlockedNodes.length === count + 1, unlockedBefore);
  assert.equal(await page.locator('#livingConfirmOverlay').isHidden(), true, 'mastery confirmation closes after allocation');

  await page.locator('#closeLivingButton').click();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'gameCanvas');
  await page.keyboard.down('g');
  await page.locator('#quickWheelOverlay:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'quick wheel');
  assert.equal(await page.locator('#quickWheelSectors .quick-wheel-sector').count(), 8, 'quick wheel renders eight radial sectors');
  assert.equal(await page.locator('#quickWheelLinear [data-wheel-index]').count(), 8, 'quick wheel supplies eight keyboard-accessible choices');
  await page.keyboard.press('Escape');
  await page.keyboard.up('g');
  await page.waitForFunction(() => document.getElementById('quickWheelOverlay').hidden);
  await context.close();
}

async function encoreChecks(browser, failures) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watchRuntime(page, 'encore', failures);
  await appReady(page);
  await seedSave(page, {
    stage: 4,
    chapter: 4,
    x: 740,
    y: 520,
    beatcoins: 123,
    bossDefeated: true,
    campaignFinaleSeen: true,
    stageBosses: ['nullspeaker', 'rootbound', 'prism-choir', 'tidebreaker'],
    chapterRelics: ['rootsong', 'skyglass', 'moonwake']
  });
  const normal = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
  await page.evaluate(() => window.__HIGH_NOTES__.debug.openLiving('encore'));
  await page.locator('#livingPanel:not([hidden])').waitFor();
  await assertAccessibleSurface(page, 'Encore panel');
  await page.locator('.encore-actions button').click();
  await page.locator('#livingConfirmOverlay:not([hidden])').waitFor();
  await page.locator('#livingConfirmAccept').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().state.living.encoreAdventure.active);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'gameCanvas');
  let encore = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
  assert.equal(encore.state.stage, 1, 'Encore begins at Mossvale');
  assert.equal(encore.state.living.encoreAdventure.cycle, 1, 'Encore remains a single bounded cycle');
  assert.ok(encore.state.living.encoreAdventure.normalSnapshot, 'normal adventure snapshot is retained');
  assert.equal(await page.locator('body').evaluate((element) => element.classList.contains('encore-adventure-active')), true);

  await page.evaluate(() => window.__HIGH_NOTES__.debug.grantBeatcoins(500));
  await page.evaluate(() => window.__HIGH_NOTES__.debug.openLiving('encore'));
  await page.locator('.encore-actions button').click();
  await page.locator('#livingConfirmAccept').click();
  await page.waitForFunction(() => !window.__HIGH_NOTES__.snapshot().state.living.encoreAdventure.active);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'gameCanvas');
  const restored = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
  assert.equal(restored.state.stage, normal.state.stage, 'returning from Encore restores the normal stage');
  assert.equal(restored.state.beatcoins, normal.state.beatcoins, 'Encore currency cannot leak into normal progression');
  assert.deepEqual(restored.state.stageBosses, normal.state.stageBosses, 'Encore boss progress cannot leak into normal progression');
  assert.equal(await page.locator('body').evaluate((element) => element.classList.contains('encore-adventure-active')), false);
  await context.close();
}

(async () => {
  const failures = [];
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await rehearsalChecks(browser, failures);
    await encoreChecks(browser, failures);
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log(`V2.4 Living Resonance browser QA passed. Evidence: ${outputDir}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
