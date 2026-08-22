#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-combat-telegraph-qa'));
const executablePath = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
assert.ok(executablePath, 'Chrome or Edge is required for combat-telegraph QA');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const failures = [];
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__);
    await page.evaluate(() => {
      const save = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24, stage: 3, chapter: 3,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Telegraph QA', classId: 'groveguard' },
        bossDefeated: true,
        stageBosses: ['nullspeaker', 'rootbound'],
        chapterRelics: ['rootsong']
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(save));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__?.firstPerson?.isPlaying());
    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, entities = api.firstPerson.getEntities(), player = api.firstPerson.getPlayer();
      api.debug.setInvulnerable(20);
      entities.projectiles.length = 0;
      entities.enemies.forEach((enemy) => { enemy.dead = true; enemy.pendingVolley = null; });
      const target = entities.enemies.find((enemy) => enemy.ai === 'storm') || entities.enemies[0];
      target.dead = false;
      target.progressionLocked = false;
      target.introduced = true;
      target.spawnWarmup = 0;
      target.stun = 0;
      target.ai = 'storm';
      target.type = 'wisp';
      target.x = player.x + 150;
      target.y = player.y;
      target.homeX = target.x;
      target.homeY = target.y;
      target.cooldown = 0;
      window.__telegraphTargetId = target.id;
    });
    await page.waitForFunction(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      return entities.enemies.find((enemy) => enemy.id === window.__telegraphTargetId)?.pendingVolley;
    });
    const enemyWindup = await page.evaluate(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const enemy = entities.enemies.find((entry) => entry.id === window.__telegraphTargetId);
      return { kind: enemy.pendingVolley.kind, timer: enemy.pendingVolley.timer, projectiles: entities.projectiles.length, mode: enemy.mode };
    });
    assert.equal(enemyWindup.kind, 'storm', 'storm enemy queues its authored volley');
    assert.equal(enemyWindup.projectiles, 0, 'enemy warning begins before any projectile exists');
    assert.equal(enemyWindup.mode, 'windup', 'enemy exposes a committed windup state');
    assert.ok(enemyWindup.timer > 0.2, `enemy warning leaves a usable response window (${enemyWindup.timer.toFixed(3)}s)`);
    await page.screenshot({ path: path.join(outputDir, 'enemy-warning.png') });

    await page.evaluate(() => {
      const enemy = window.__HIGH_NOTES__.firstPerson.getEntities().enemies
        .find((entry) => entry.id === window.__telegraphTargetId);
      enemy.stun = 0.8;
    });
    await page.waitForFunction(() => {
      const enemy = window.__HIGH_NOTES__.firstPerson.getEntities().enemies
        .find((entry) => entry.id === window.__telegraphTargetId);
      return !enemy.pendingVolley;
    });
    const cancelledWindup = await page.evaluate(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const enemy = entities.enemies.find((entry) => entry.id === window.__telegraphTargetId);
      return { mode: enemy.mode, projectiles: entities.projectiles.length };
    });
    assert.equal(cancelledWindup.mode, 'idle', 'stun cancellation releases the committed attack state');
    assert.equal(cancelledWindup.projectiles, 0, 'stunning a warning cannot leak its projectile');
    await page.evaluate(() => {
      const enemy = window.__HIGH_NOTES__.firstPerson.getEntities().enemies
        .find((entry) => entry.id === window.__telegraphTargetId);
      enemy.stun = 0;
      enemy.cooldown = 0;
    });
    await page.waitForFunction(() => {
      const enemy = window.__HIGH_NOTES__.firstPerson.getEntities().enemies
        .find((entry) => entry.id === window.__telegraphTargetId);
      return !!enemy.pendingVolley;
    });
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getEntities().projectiles.length >= 6);

    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, entities = api.firstPerson.getEntities(), player = api.firstPerson.getPlayer();
      entities.projectiles.length = 0;
      const target = entities.enemies.find((entry) => entry.id === window.__telegraphTargetId);
      target.pendingVolley = null;
      target.cooldown = 0;
      target.x = player.x + 145;
      target.y = player.y;
      const blockers = entities.enemies.filter((enemy) => enemy !== target).slice(0, 3);
      blockers.forEach((enemy, index) => {
        enemy.dead = false;
        enemy.progressionLocked = false;
        enemy.introduced = true;
        enemy.spawnWarmup = 0;
        enemy.stun = 0;
        enemy.x = player.x + 190 + index * 26;
        enemy.y = player.y + 70;
        enemy.homeX = enemy.x;
        enemy.homeY = enemy.y;
        enemy.mode = 'windup';
        enemy.pendingVolley = { kind: 'aimed', timer: 5, maxTimer: 5, data: { angle: 0, speed: 1, color: '#fff' } };
      });
      window.__budgetBlockerIds = blockers.map((enemy) => enemy.id);
    });
    await page.waitForTimeout(120);
    const budgeted = await page.evaluate(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const target = entities.enemies.find((entry) => entry.id === window.__telegraphTargetId);
      return { pending: !!target.pendingVolley, projectiles: entities.projectiles.length };
    });
    assert.equal(budgeted.pending, false, 'standard difficulty permits at most three committed field attackers');
    assert.equal(budgeted.projectiles, 0, 'budget denial cannot leak an untelegraphed projectile');

    const deathCleanup = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, entities = api.firstPerson.getEntities();
      const target = entities.enemies.find((entry) => entry.id === window.__telegraphTargetId);
      target.pendingVolley = { kind: 'aimed', timer: 5, maxTimer: 5, data: { angle: 0, speed: 1 } };
      target.mode = 'windup';
      api.debug.defeatEnemies();
      return { dead: target.dead, pending: target.pendingVolley, mode: target.mode };
    });
    assert.equal(deathCleanup.dead, true, 'enemy death cleanup fixture is valid');
    assert.equal(deathCleanup.pending, null, 'enemy death removes a frozen telegraph');
    assert.equal(deathCleanup.mode, 'idle', 'enemy death releases its committed mode');

    await page.evaluate(() => {
      const api = window.__HIGH_NOTES__, entities = api.firstPerson.getEntities();
      entities.enemies.forEach((enemy) => { enemy.dead = true; enemy.pendingVolley = null; });
      entities.projectiles.length = 0;
      api.debug.startBoss();
      const boss = api.firstPerson.getEntities().boss;
      boss.projectileCooldown = 0;
    });
    await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().boss?.pendingPattern === 'projectile');
    const bossWindup = await page.evaluate(() => ({
      boss: window.__HIGH_NOTES__.snapshot().boss,
      projectiles: window.__HIGH_NOTES__.firstPerson.getEntities().projectiles.length
    }));
    assert.equal(bossWindup.projectiles, 0, 'boss warning begins before its projectile pattern');
    assert.ok(bossWindup.boss.patternWindup > 0.2, `boss warning leaves a usable response window (${bossWindup.boss.patternWindup.toFixed(3)}s)`);
    await page.screenshot({ path: path.join(outputDir, 'boss-warning.png') });
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getEntities().projectiles.length >= 10);
    await page.evaluate(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      entities.projectiles.length = 0;
      entities.boss.projectileCooldown = 0;
    });
    await page.waitForFunction(() => window.__HIGH_NOTES__.snapshot().boss?.pendingPattern === 'projectile');
    const bossDeathCleanup = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      api.debug.defeatBoss();
      return api.snapshot().boss;
    });
    assert.equal(bossDeathCleanup.dead, true, 'boss death cleanup fixture is valid');
    assert.equal(bossDeathCleanup.pendingPattern, '', 'boss death removes a frozen volley warning');
    assert.equal(bossDeathCleanup.patternWindup, 0, 'boss death clears its warning timer');
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log(`Combat telegraph browser QA passed: enemy and boss warnings precede damage; later-stage attack budget holds. Evidence: ${outputDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
