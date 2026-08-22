#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-rhythm-combat-qa'));
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for rhythm combat QA');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const failures = [];
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossAudio);
    await page.evaluate(() => {
      const raw = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24,
        stage: 1,
        chapter: 1,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Rhythm QA', classId: 'riffblade' },
        metEems: true,
        metJimbo: true,
        metBlu: true,
        notes: ['C', 'E', 'G', 'B'],
        melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
        composed: true
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(raw));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossAudio);
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());

    await page.waitForFunction(() => {
      const beat = window.MossAudio.getBeatSnapshot(performance.now() / 1000);
      return beat.bpm === 104 && Math.abs(beat.beatDuration - 60 / 104) < 0.0001;
    });
    const transport = await page.evaluate(() => window.MossAudio.getBeatSnapshot(performance.now() / 1000));
    assert.equal(transport.bpm, 104, 'gameplay beat uses the soundtrack BPM');

    const emptyPosition = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const enemies = api.firstPerson.getEntities().enemies.filter((enemy) => !enemy.dead && !enemy.progressionLocked);
      const world = api.firstPerson.getWorld();
      const candidates = [];
      for (let y = 100; y < world.h - 100; y += 180) {
        for (let x = 100; x < world.w - 100; x += 180) candidates.push({ x, y });
      }
      const candidate = candidates.find((point) => !api.firstPerson.hitsObstacle(point.x, point.y, 18) &&
        enemies.every((enemy) => Math.hypot(enemy.x - point.x, enemy.y - point.y) > 240));
      if (!candidate) throw new Error('Could not find an empty combat test position');
      api.debug.teleport(candidate.x, candidate.y);
      return candidate;
    });
    assert.ok(Number.isFinite(emptyPosition.x) && Number.isFinite(emptyPosition.y), 'empty test position');
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().attackCooldown <= 0);
    await page.waitForFunction(() => window.MossAudio.gradeBeat({ fallbackTime: performance.now() / 1000 }).quality === 'perfect');
    const beforeWhiff = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    await page.evaluate(() => {
      window.__HIGH_NOTES__.firstPerson.beginAttack();
      window.__HIGH_NOTES__.firstPerson.endAttack();
    });
    await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().runtime.attacks === 0);
    const afterWhiff = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.equal(afterWhiff.state.statistics.attacksSwung, beforeWhiff.state.statistics.attacksSwung + 1, 'empty swing was performed');
    assert.equal(afterWhiff.rhythm.count, beforeWhiff.rhythm.count, 'empty swing cannot build Rhythm Combo');
    assert.equal(afterWhiff.state.statistics.perfectBeats, beforeWhiff.state.statistics.perfectBeats, 'empty swing cannot award a perfect beat');

    await page.waitForFunction(() => {
      const player = window.__HIGH_NOTES__.firstPerson.getPlayer();
      return player.attackCooldown <= 0 && player.dashCooldown <= 0;
    });
    await page.evaluate(() => {
      window.__HIGH_NOTES__.firstPerson.beginAttack();
      window.__HIGH_NOTES__.firstPerson.endAttack();
    });
    await page.keyboard.press('Shift');
    await page.waitForTimeout(60);
    const committedSwing = await page.evaluate(() => {
      const player = window.__HIGH_NOTES__.firstPerson.getPlayer();
      const attack = window.__HIGH_NOTES__.firstPerson.getEntities().attacks.find((entry) => !entry.classAttack);
      return { dashTimer: player.dashTimer, phase: attack && attack.phase, rootX: attack && attack.rootX, x: attack && attack.x };
    });
    assert.equal(committedSwing.dashTimer, 0, 'a dodge cannot carry a committed attack hitbox');
    assert.ok(['startup', 'active'].includes(committedSwing.phase), `attack is committed before dodge: ${committedSwing.phase}`);
    assert.ok(Number.isFinite(committedSwing.rootX), 'committed attack has a fixed world root');
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().dashTimer > 0);
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().dashTimer <= 0);

    const target = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const enemy = api.firstPerson.getEntities().enemies.find((entry) => !entry.dead && entry.type !== 'wisp');
      if (!enemy) throw new Error('No valid enemy available for hit-confirm QA');
      const offsets = [
        { x: -36, y: 0, facing: 'east' }, { x: 36, y: 0, facing: 'west' },
        { x: 0, y: -36, facing: 'south' }, { x: 0, y: 36, facing: 'north' }
      ];
      const offset = offsets.find((entry) => !api.firstPerson.hitsObstacle(enemy.x + entry.x, enemy.y + entry.y, 18));
      if (!offset) throw new Error('No clear attack position beside the target');
      api.debug.teleport(enemy.x + offset.x, enemy.y + offset.y);
      api.debug.setFacing(offset.facing);
      enemy.progressionLocked = false;
      enemy.spawnWarmup = 0;
      enemy.stun = 5;
      enemy.flash = 0;
      return { id: enemy.id, x: enemy.x, y: enemy.y, hp: enemy.hp, facing: offset.facing };
    });
    assert.ok(target.id, 'enemy target selected');
    await page.evaluate(() => window.__HIGH_NOTES__.debug.setInvulnerable(10));
    await page.waitForFunction(() => window.MossAudio.adaptiveState.scene === 'combat');
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().attackCooldown <= 0);
    await page.waitForFunction(() => window.MossAudio.gradeBeat({ fallbackTime: performance.now() / 1000 }).quality === 'perfect');
    const beforeHit = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    const capturedTiming = await page.evaluate(() => {
      window.__HIGH_NOTES__.firstPerson.beginAttack();
      const attacks = window.__HIGH_NOTES__.firstPerson.getEntities().attacks;
      const timing = attacks.length ? attacks[attacks.length - 1].rhythmTiming : null;
      window.__HIGH_NOTES__.firstPerson.endAttack();
      return timing;
    });
    assert.equal(capturedTiming.quality, 'perfect', 'attack captured a soundtrack downbeat');
    await page.waitForFunction(({ id, hp }) => {
      const enemy = window.__HIGH_NOTES__.firstPerson.getEntities().enemies.find((entry) => entry.id === id);
      return enemy && enemy.hp < hp;
    }, { id: target.id, hp: target.hp });
    await page.waitForTimeout(50);
    const afterHit = await page.evaluate(() => window.__HIGH_NOTES__.snapshot());
    assert.ok(afterHit.rhythm.count >= beforeHit.rhythm.count + 1,
      `confirmed hit builds Rhythm Combo: ${JSON.stringify({ before: beforeHit.rhythm, after: afterHit.rhythm, timing: capturedTiming })}`);
    assert.ok(afterHit.state.statistics.perfectBeats >= beforeHit.state.statistics.perfectBeats + 1, 'on-transport hit records a perfect beat');
    assert.equal(afterHit.rhythm.beatLength, 60 / 104, 'HUD rhythm state shares the soundtrack quarter note');
    await page.screenshot({ path: path.join(outputDir, 'confirmed-rhythm-hit.png') });
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`Rhythm combat browser QA passed: empty swings score nothing; committed swings cannot dash-drag hitboxes; confirmed 104 BPM hits build combo. Evidence: ${outputDir}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
