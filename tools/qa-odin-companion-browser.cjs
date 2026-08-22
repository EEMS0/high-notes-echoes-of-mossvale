#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-odin-companion-qa'));
const executablePath = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for Odin companion QA');
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
    await page.waitForFunction(() => window.__HIGH_NOTES__?.debug);
    await page.evaluate(() => {
      const save = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24,
        stage: 2,
        chapter: 2,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Odin QA', classId: 'riffblade' },
        metMara: true,
        odinRecruited: true,
        skills: ['odin-bond', 'odin-pounce', 'odin-fetch', 'odin-guardian'],
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

    const fetchResult = await page.evaluate(async () => {
      const api = window.__HIGH_NOTES__;
      const entities = api.firstPerson.getEntities();
      const player = api.firstPerson.getPlayer();
      const odin = entities.odin;
      const target = entities.enemies[0];
      entities.enemies.forEach((enemy) => { enemy.dead = true; enemy.pendingVolley = null; });
      entities.weeds.length = 0;
      entities.healthPickups.length = 0;
      entities.projectiles.length = 0;
      entities.hazards.length = 0;
      target.dead = false;
      target.progressionLocked = false;
      target.introduced = true;
      target.spawnWarmup = 0;
      target.shielded = false;
      target.stun = 99;
      target.hp = target.maxHp = 20;
      target.x = player.x + 82;
      target.y = player.y;
      target.homeX = target.x;
      target.homeY = target.y;
      odin.x = player.x - 38;
      odin.y = player.y;
      odin.command = 'fetch';
      odin.target = null;
      odin.targetScanTimer = 0;
      odin.biteCooldown = 0;
      odin.pounceCooldown = 0;
      await new Promise((resolve) => setTimeout(resolve, 260));
      return {
        targetSelected: odin.target === target,
        targetHp: target.hp,
        pounceCooldown: odin.pounceCooldown,
        biteCooldown: odin.biteCooldown
      };
    });
    assert.equal(fetchResult.targetSelected, false, 'Fetch with no pickup must not acquire a combat target');
    assert.equal(fetchResult.targetHp, 20, 'Fetch with no pickup must not damage a nearby enemy');
    assert.equal(fetchResult.pounceCooldown, 0, 'Fetch must not pounce when no collectible is available');
    assert.equal(fetchResult.biteCooldown, 0, 'Fetch must not bite when no collectible is available');

    const guardianResult = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const entities = api.firstPerson.getEntities();
      const player = api.firstPerson.getPlayer();
      const odin = entities.odin;
      entities.enemies.forEach((enemy) => { enemy.dead = true; enemy.pendingVolley = null; });
      player.maxHealth = 6;
      player.health = 2;
      player.invuln = 0;
      player.dashTimer = 0;
      player.blocking = false;
      odin.x = player.x - 30;
      odin.y = player.y;
      odin.guardianCooldown = 0;
      odin.command = 'follow';
      api.debug.receiveDamage(1, player.x + 60, player.y);
      const follow = { health: player.health, cooldown: odin.guardianCooldown };

      player.health = 2;
      player.invuln = 0;
      odin.x = player.x - 30;
      odin.y = player.y;
      odin.guardianCooldown = 0;
      odin.command = 'guard';
      api.debug.receiveDamage(1, player.x + 60, player.y);
      return {
        follow,
        guard: { health: player.health, cooldown: odin.guardianCooldown, attackFlash: odin.attackFlash }
      };
    });
    assert.equal(guardianResult.follow.health, 1, 'Guardian Leap must not trigger while Odin is following');
    assert.equal(guardianResult.follow.cooldown, 0, 'Following must not consume Guardian Leap');
    assert.equal(guardianResult.guard.health, 2, 'Guard command must protect a critically wounded player');
    assert.ok(guardianResult.guard.cooldown > 17, 'A successful Guardian Leap starts its authored cooldown');
    assert.ok(guardianResult.guard.attackFlash > 0, 'A successful Guardian Leap triggers companion feedback');

    const fixture = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const world = api.firstPerson.getWorld();
      for (let y = 360; y <= world.h - 360; y += 140) {
        for (let x = 360; x <= world.w - 360; x += 140) {
          if (!api.firstPerson.hitsObstacle(x, y, 170)) return { x, y };
        }
      }
      return null;
    });
    assert.ok(fixture, 'Odin QA requires one open world-space fixture');

    const wallFixture = await page.evaluate(({ x, y }) => {
      const api = window.__HIGH_NOTES__;
      const entities = api.firstPerson.getEntities();
      const player = api.firstPerson.getPlayer();
      const odin = entities.odin;
      entities.enemies.forEach((enemy) => { enemy.dead = true; enemy.pendingVolley = null; });
      entities.weeds.length = 0;
      entities.healthPickups.length = 0;
      const wall = { id: 'qa-odin-wall', x, y, r: 38 };
      entities.obstacles.push(wall);
      player.x = x + 132;
      player.y = y;
      player.facing = 0;
      player.moveX = 0;
      player.moveY = 0;
      odin.x = x - 62;
      odin.y = y;
      odin.command = 'follow';
      odin.target = null;
      odin.targetScanTimer = 0;
      odin.followAngle = 0;
      odin.activity = '';
      odin.activityTimer = 0;
      odin.idleActionCooldown = 99;
      odin.attackFlash = 0;
      odin.stuckTimer = 0;
      return { wall, radius: odin.r };
    }, fixture);

    await page.evaluate(({ x, y }) => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const odin = entities.odin;
      entities.weeds.push(
        { id: 'qa-blocked-weed', x: x + 50, y },
        { id: 'qa-reachable-weed', x: x - 70, y: y + 180 }
      );
      odin.x = x - 70;
      odin.y = y;
      odin.command = 'fetch';
      odin.target = null;
      odin.targetScanTimer = 0;
      odin.stuckTimer = 0;
    }, fixture);
    await page.waitForTimeout(180);
    const reachableFetch = await page.evaluate(({ x, y }) => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      return { dx: entities.odin.x - (x - 70), dy: entities.odin.y - y };
    }, fixture);
    assert.ok(Math.abs(reachableFetch.dx) < 8,
      `Fetch must reject the nearer blocked pickup instead of walking into its wall (dx ${reachableFetch.dx.toFixed(1)})`);
    assert.ok(reachableFetch.dy > 24,
      `Fetch must pursue the farther reachable pickup (dy ${reachableFetch.dy.toFixed(1)})`);

    await page.evaluate(({ x, y }) => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const odin = entities.odin;
      entities.weeds.length = 0;
      odin.x = x - 62;
      odin.y = y;
      odin.command = 'follow';
      odin.target = null;
      odin.targetScanTimer = 0;
      odin.followAngle = 0;
      odin.stuckTimer = 0;
    }, fixture);

    await page.waitForTimeout(480);
    const collisionStop = await page.evaluate(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const odin = entities.odin;
      const wall = entities.obstacles.find((entry) => entry.id === 'qa-odin-wall');
      return {
        x: odin.x,
        y: odin.y,
        clearance: Math.hypot(odin.x - wall.x, odin.y - wall.y) - wall.r - odin.r,
        stuckTimer: odin.stuckTimer
      };
    });
    assert.ok(collisionStop.x < wallFixture.wall.x, 'Follow movement stops on Odin’s original side of an obstacle');
    assert.ok(collisionStop.clearance >= -0.01, `Odin must not overlap the blocking obstacle (clearance ${collisionStop.clearance.toFixed(3)})`);
    assert.ok(collisionStop.stuckTimer > 0.2, 'Blocked movement accumulates a recovery timer');

    await page.waitForFunction(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const odin = entities.odin;
      const wall = entities.obstacles.find((entry) => entry.id === 'qa-odin-wall');
      return odin.x > wall.x + wall.r + odin.r;
    }, null, { timeout: 2200 });
    const recovery = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const entities = api.firstPerson.getEntities();
      const player = api.firstPerson.getPlayer();
      const odin = entities.odin;
      const wall = entities.obstacles.find((entry) => entry.id === 'qa-odin-wall');
      return {
        clearance: Math.hypot(odin.x - wall.x, odin.y - wall.y) - wall.r - odin.r,
        playerDistance: Math.hypot(odin.x - player.x, odin.y - player.y),
        stuckTimer: odin.stuckTimer
      };
    });
    assert.ok(recovery.clearance >= -0.01, 'Stuck recovery selects a collision-free position');
    assert.ok(recovery.playerDistance <= 90, `Stuck recovery returns Odin close to the player (${recovery.playerDistance.toFixed(1)}px)`);
    assert.equal(recovery.stuckTimer, 0, 'Stuck recovery clears its timer');

    const blockedPounce = await page.evaluate(({ x, y }) => {
      const api = window.__HIGH_NOTES__;
      const entities = api.firstPerson.getEntities();
      const player = api.firstPerson.getPlayer();
      const odin = entities.odin;
      const target = entities.enemies[0];
      const wall = entities.obstacles.find((entry) => entry.id === 'qa-odin-wall');
      player.x = x - 100;
      player.y = y;
      player.moveX = 0;
      player.moveY = 0;
      odin.x = x - 70;
      odin.y = y;
      odin.facing = 0;
      odin.followAngle = 0;
      odin.command = 'attack';
      odin.pounceCooldown = 0;
      odin.biteCooldown = 0;
      odin.attackFlash = 0;
      odin.stuckTimer = 0;
      odin.activity = '';
      odin.activityTimer = 0;
      target.dead = false;
      target.progressionLocked = false;
      target.introduced = true;
      target.spawnWarmup = 0;
      target.shielded = false;
      target.stun = 99;
      target.flash = 0;
      target.hp = target.maxHp = 20;
      target.x = x + 90;
      target.y = y;
      target.homeX = target.x;
      target.homeY = target.y;
      odin.target = target;
      odin.targetScanTimer = 5;
      window.__odinQaTarget = target;
      window.__odinQaWall = wall;
      return { hp: target.hp };
    }, fixture);
    await page.waitForTimeout(460);
    const blockedPounceAfter = await page.evaluate(() => {
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const odin = entities.odin;
      const target = window.__odinQaTarget;
      const wall = window.__odinQaWall;
      return {
        hp: target.hp,
        cooldown: odin.pounceCooldown,
        clearance: Math.hypot(odin.x - wall.x, odin.y - wall.y) - wall.r - odin.r,
        remainedLeft: odin.x < wall.x
      };
    });
    assert.equal(blockedPounceAfter.hp, blockedPounce.hp, 'A blocked pounce cannot damage an enemy through an obstacle');
    assert.equal(blockedPounceAfter.cooldown, 0, 'A blocked pounce does not consume its cooldown');
    assert.equal(blockedPounceAfter.remainedLeft, true, 'A blocked pounce cannot teleport Odin through an obstacle');
    assert.ok(blockedPounceAfter.clearance >= -0.01, 'Blocked attack pursuit respects companion collision');

    const clearPounce = await page.evaluate(async ({ x, y }) => {
      const api = window.__HIGH_NOTES__;
      const entities = api.firstPerson.getEntities();
      const player = api.firstPerson.getPlayer();
      const odin = entities.odin;
      const target = window.__odinQaTarget;
      const wallIndex = entities.obstacles.findIndex((entry) => entry.id === 'qa-odin-wall');
      if (wallIndex >= 0) entities.obstacles.splice(wallIndex, 1);
      player.x = x - 120;
      player.y = y;
      player.moveX = 0;
      player.moveY = 0;
      odin.x = x - 80;
      odin.y = y;
      odin.facing = 0;
      odin.followAngle = 0;
      odin.command = 'attack';
      odin.pounceCooldown = 0;
      odin.biteCooldown = 0;
      odin.attackFlash = 0;
      odin.stuckTimer = 0;
      odin.activity = '';
      odin.activityTimer = 0;
      target.dead = false;
      target.progressionLocked = false;
      target.shielded = false;
      target.stun = 99;
      target.flash = 0;
      target.hp = target.maxHp = 20;
      target.x = x + 100;
      target.y = y;
      target.homeX = target.x;
      target.homeY = target.y;
      odin.target = target;
      odin.targetScanTimer = 5;

      const startedAt = performance.now();
      let maximumHitFlash = target.flash;
      return new Promise((resolve) => {
        function sample() {
          maximumHitFlash = Math.max(maximumHitFlash, Number(target.flash) || 0);
          if (odin.pounceCooldown > 0 || performance.now() - startedAt > 1600) {
            resolve({
              hp: target.hp,
              cooldown: odin.pounceCooldown,
              maximumHitFlash,
              distance: Math.hypot(odin.x - target.x, odin.y - target.y)
            });
            return;
          }
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    }, fixture);
    assert.ok(clearPounce.cooldown > 6, 'Hunt command performs a clear-path pounce');
    assert.ok(clearPounce.hp < 20, 'A clear-path pounce damages its target');
    assert.ok(clearPounce.distance <= 45, `Pounce ends beside its target (${clearPounce.distance.toFixed(1)}px)`);
    assert.equal(clearPounce.maximumHitFlash, 0, 'Lightweight Odin strikes do not reserve the player hit-flash gate');

    await page.screenshot({ path: path.join(outputDir, 'odin-companion-final.png') });
    assert.deepEqual(failures, [], `runtime failures:\n${failures.join('\n')}`);
    console.log(`Odin companion browser QA passed: commands, Guardian gating, collision recovery, and pounce pathing are coherent. Evidence: ${outputDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
