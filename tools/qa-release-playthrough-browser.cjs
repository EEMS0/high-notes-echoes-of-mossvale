#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-release-playthrough'));
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for release playthrough QA');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const runtimeFailures = [];
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') runtimeFailures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => runtimeFailures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossLivingResonance && window.MossStory);
    await page.evaluate(() => {
      const raw = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24,
        stage: 1,
        chapter: 1,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Release QA', classId: 'groveguard' },
        notes: ['C', 'E', 'G', 'B'],
        melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
        composed: true
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossStory);
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
    await page.evaluate(() => { window.__HIGH_NOTES__.debug.grantAll(); window.__HIGH_NOTES__.debug.compose(); });

    const expectedBosses = ['nullspeaker', 'rootbound', 'prism-choir', 'tidebreaker'];
    const expectedRewards = ['bass', 'drums', 'synth', 'violin'];
    for (let stage = 1; stage <= 4; stage++) {
      const currentStage = await page.evaluate(() => window.__HIGH_NOTES__.snapshot().state.stage);
      if (currentStage !== stage) {
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
        await page.waitForFunction((target) => window.__HIGH_NOTES__.snapshot().state.stage === target, stage);
      }
      const before = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
      const startedBoss = await page.evaluate(() => window.__HIGH_NOTES__.debug.startBoss());
      assert.equal(startedBoss.defId, expectedBosses[stage - 1], `stage ${stage} starts its intended boss`);
      assert.ok(startedBoss.hp > 0 && startedBoss.maxHp >= startedBoss.hp, `stage ${stage} boss has valid health`);
      await page.evaluate(() => window.__HIGH_NOTES__.debug.defeatBoss());
      await page.waitForFunction((bossId) => window.__HIGH_NOTES__.snapshot().state.stageBosses.includes(bossId), expectedBosses[stage - 1]);
      const after = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
      assert.ok(after.state.skillPoints >= before.state.skillPoints + 2, `stage ${stage} grants boss skill points`);
      assert.ok(after.state.beatcoins >= before.state.beatcoins + 8, `stage ${stage} grants boss currency`);
      assert.ok(after.state.unlockedInstruments.includes(expectedRewards[stage - 1]), `stage ${stage} grants ${expectedRewards[stage - 1]}`);
      assert.ok(after.state.statistics.bestBossTimes[expectedBosses[stage - 1]] > 0, `stage ${stage} records a boss clear time`);

      if (stage < 4) {
        await page.locator('#endingScreen:not([hidden])').waitFor({ timeout: 5000 });
        assert.equal(await page.locator('#replayButton').textContent(), ['Continue to Rootsong','Continue to Skyglass','Continue to Moonwake'][stage-1]);
        await page.screenshot({ path: path.join(outputDir, `chapter-${stage}-ending.png`) });
        await page.locator('#replayButton').click();
        assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.snapshot().state.stage), stage+1,
          `chapter ${stage} continues; runtime: ${JSON.stringify(await page.evaluate(() => window.__HIGH_NOTES__.snapshot().runtime))}`);
        await page.waitForFunction((next) => window.__HIGH_NOTES__.snapshot().state.stage === next, stage+1);
      }
    }

    await page.locator('#endingScreen:not([hidden])').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#endingTitle').textContent(), 'THE FOUR-STAGE ENCORE');
    assert.equal(await page.locator('#replayButton').textContent(), 'Keep Exploring');
    const finalText = await page.locator('#endingText').textContent();
    for (const name of ['Nullspeaker', 'Rootbound', 'Prism Choir', 'Tidebreaker']) assert.match(finalText, new RegExp(name), `finale recalls ${name}`);
    await page.screenshot({ path: path.join(outputDir, 'campaign-finale.png') });
    await page.locator('#replayButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());

    const completed = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.deepEqual(completed.state.stageBosses, expectedBosses, 'complete campaign records all four bosses exactly once');
    assert.equal(completed.state.campaignFinaleSeen, true, 'campaign finale persists');
    assert.equal(completed.state.living.encoreAdventure.unlocked, true, 'campaign completion unlocks Encore Adventure');
    assert.equal(await page.locator('#encoreButton').evaluate((element) => element.hidden), false, 'title-level Encore entry is available after completion');

    await page.evaluate(() => window.__HIGH_NOTES__.production.save());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossLivingResonance);
    assert.equal(await page.locator('#continueButton').isDisabled(), false, 'completed campaign remains continuable after reload');
    assert.equal(await page.locator('#encoreButton').evaluate((element) => element.hidden), false, 'Encore title entry persists after reload');
    await page.locator('#encoreButton').click();
    await page.locator('#livingPanel:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-living-tab="encore"]').getAttribute('aria-selected'), 'true', 'Encore title entry opens the correct protected panel');
    await page.locator('#closeLivingButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
    const reloaded = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.deepEqual(reloaded.state.stageBosses, expectedBosses, 'post-finale reload preserves boss progression');
    assert.equal(reloaded.state.campaignFinaleSeen, true, 'post-finale reload does not replay the ending');
    assert.equal(await page.locator('#endingScreen').isHidden(), true, 'completed finale stays dismissed after reload');
    assert.deepEqual(runtimeFailures, [], `runtime failures:\n${runtimeFailures.join('\n')}`);
    console.log(`Release playthrough QA passed: prologue-complete save through all four bosses, finale, exploration, and reload. Evidence: ${outputDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
