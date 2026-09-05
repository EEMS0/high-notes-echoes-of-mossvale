#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for browser QA');

function watchRuntime(page, failures) {
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
}

async function appReady(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossMusic && window.MossAudio);
}

function legacySave() {
  return {
    version: 25,
    stage: 1,
    chapter: 1,
    x: 960,
    y: 720,
    bossDefeated: false,
    stageBosses: [],
    tutorial: { status: 'completed', rewardClaimed: true },
    character: { created: true, displayName: 'Composer QA', classId: 'riffblade' },
    metEems: true,
    metJimbo: true,
    metBlu: true,
    weeds: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
    notes: ['C', 'E', 'G', 'B'],
    melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
    composed: true
  };
}

async function openComposer(page) {
  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.debug.openComposer()), true, 'composer opens');
  await page.locator('#composerScreen:not([hidden])').waitFor();
}

(async () => {
  const failures = [];
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  watchRuntime(page, failures);

  try {
    await appReady(page);
    const migration = await page.evaluate((raw) => {
      const clean = window.__HIGH_NOTES__.debug.sanitizeSave(raw);
      localStorage.setItem('highNotesSaveV7', JSON.stringify(raw));
      return {
        version: clean.version,
        stepCount: clean.composition.steps.length,
        firstBar: clean.composition.steps.slice(0, 8),
        secondBar: clean.composition.steps.slice(8)
      };
    }, legacySave());
    assert.equal(migration.version, 26, 'schema 25 migrates to schema 26');
    assert.equal(migration.stepCount, 16, 'legacy melody becomes sixteen steps');
    assert.deepEqual(migration.secondBar, migration.firstBar, 'legacy phrase repeats into bar two');

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
    const loaded = await page.evaluate(() => window.__HIGH_NOTES__.snapshot().state);
    assert.equal(loaded.version, 26, 'loaded state uses current schema');
    assert.equal(loaded.composition.steps.length, 16, 'loaded composition remains polyphonic');

    await openComposer(page);
    assert.equal(await page.locator('#composerGrid [role="gridcell"]').count(), 16, 'sixteen sequencer cells');
    assert.equal(await page.locator('[data-composer-note]').count(), 8, 'full C-to-C octave');
    assert.equal(await page.locator('[data-chord-preset]').count(), 10, 'ten triad/seventh presets');
    assert.equal(await page.locator('#composerGrid [role="row"]').count(), 2, 'two semantic grid rows');

    const stepTwo = page.locator('[data-beat-index="1"]');
    await stepTwo.click();
    await page.keyboard.press('0');
    await page.keyboard.press('2');
    await page.waitForFunction(() => document.querySelector('[data-beat-index="1"]').getAttribute('aria-label').includes(': D,'));
    await page.waitForFunction(() => document.activeElement?.dataset.beatIndex === '1');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.beatIndex), '1', 'numeric entry retains grid focus');

    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.activeElement?.dataset.beatIndex === '2');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.beatIndex), '2', 'arrow keys move the roving grid focus');
    assert.deepEqual(await page.locator('#composerGrid [tabindex="0"]').evaluateAll((cells) => cells.map((cell) => cell.dataset.beatIndex)), ['2'], 'one grid tab stop');

    await page.locator('[data-beat-index="3"]').click();
    await page.locator('[data-chord-preset="c-major-7"]').click();
    await page.locator('[data-composer-note="D"]').click();
    assert.match(await page.locator('[data-beat-index="3"]').getAttribute('aria-label'), /C major seventh, C, E, G, B$/, 'four-note voicing is preserved');
    assert.match(await page.locator('#composerSelectionInfo').innerText(), /already has four tones/i, 'fifth-tone rejection is explained');

    await page.locator('#playMelodyButton').click();
    await page.waitForFunction(() => document.getElementById('playMelodyButton').textContent.includes('Stop'));
    await page.waitForTimeout(5000);
    assert.match(await page.locator('#playMelodyButton').innerText(), /Play Score/i, 'full preview returns to idle');
    assert.equal(await page.locator('#composerGrid .playing').count(), 0, 'preview highlight is cleaned up');

    await page.locator('#saveMelodyButton').click();
    await page.locator('#composerScreen').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.id === 'gameCanvas');
    const saved = await page.evaluate(() => ({
      state: window.__HIGH_NOTES__.snapshot().state,
      activeId: document.activeElement?.id,
      activeHidden: !!document.activeElement?.closest('[hidden]')
    }));
    assert.equal(saved.state.composed, true, 'score completion is recorded');
    assert.deepEqual(saved.state.composition.steps[1], ['D'], 'new D pitch is saved');
    assert.deepEqual(saved.state.composition.steps[3], ['C', 'E', 'G', 'B'], 'seventh chord is saved');
    assert.equal(saved.activeId, 'gameCanvas', 'closing returns focus to gameplay');
    assert.equal(saved.activeHidden, false, 'focus never remains in the hidden composer');

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
    await openComposer(page);
    assert.match(await page.locator('[data-beat-index="1"]').getAttribute('aria-label'), /: D, D$/, 'D survives reload');
    assert.match(await page.locator('[data-beat-index="3"]').getAttribute('aria-label'), /C major seventh/, 'seventh chord survives reload');

    await page.locator('[data-beat-index="4"]').click();
    const savedStepFive = await page.locator('[data-beat-index="4"]').getAttribute('aria-label');
    await page.keyboard.press('0');
    await page.keyboard.press('4');
    await page.locator('#closeComposerButton').click();
    await openComposer(page);
    assert.equal(await page.locator('[data-beat-index="4"]').getAttribute('aria-label'), savedStepFive, 'closing discards an unsaved draft');

    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await page.evaluate(() => {
      const size = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      };
      return {
        rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tone: size('.composer-tone-button'),
        preset: size('.composer-chord-button'),
        close: size('#closeComposerButton')
      };
    });
    assert.ok(phone.rootOverflow <= 1, `phone composer avoids page overflow: ${JSON.stringify(phone)}`);
    for (const [name, size] of Object.entries({ tone: phone.tone, preset: phone.preset, close: phone.close })) {
      assert.ok(size.width >= 44 && size.height >= 44, `${name} remains a 44px touch target`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  assert.deepEqual(failures, [], `Browser runtime failures:\n${failures.join('\n')}`);
  console.log('Expanded music browser QA passed: migration, octave, chords, focus, playback, draft, persistence, and phone layout.');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
