#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const outputDir = path.resolve(process.env.HIGH_NOTES_QA_OUT || path.join(os.tmpdir(), 'high-notes-v2-3-qa'));
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for browser QA');
fs.mkdirSync(outputDir, { recursive: true });

function inside(rect, viewport, tolerance = 1) {
  return rect && rect.x >= -tolerance && rect.y >= -tolerance &&
    rect.x + rect.width <= viewport.width + tolerance &&
    rect.y + rect.height <= viewport.height + tolerance;
}

async function appReady(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossStory && window.MossInput);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((image) => image.complete ? null : new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  }))));
}

function watchRuntime(page, label, failures) {
  page.on('pageerror', (error) => failures.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`${label}: console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => failures.push(`${label}: request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));
}

async function shot(page, label) {
  const destination = path.join(outputDir, `${label}.png`);
  await page.screenshot({ path: destination });
  return destination;
}

async function assertNoOverflow(page, label) {
  const result = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  assert.ok(result.body <= 1 && result.root <= 1, `${label} has horizontal overflow: ${JSON.stringify(result)}`);
}

async function inspectCreator(page, viewport, label) {
  await page.locator('#startButton').click();
  await page.locator('#characterCreator:not([hidden])').waitFor();
  assert.equal(await page.locator('#characterClassChoices .class-choice').count(), 4, `${label}: four starter classes`);
  const card = await page.locator('#characterCreator .character-creator-card').boundingBox();
  const close = await page.locator('#closeCharacterCreator').boundingBox();
  assert.ok(inside(card, viewport, 2), `${label}: creator card must fit the viewport`);
  assert.ok(inside(close, viewport, 2), `${label}: creator close control must remain reachable`);
  const iconFailures = await page.locator('#characterClassChoices img').evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth !== 256 || image.naturalHeight !== 256).length);
  assert.equal(iconFailures, 0, `${label}: class icons must load at declared dimensions`);
  await assertNoOverflow(page, `${label} creator`);
  await shot(page, `${label}-creator`);
}

async function desktopChecks(browser, failures) {
  const viewport = { width: 1366, height: 768 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watchRuntime(page, 'desktop', failures);
  await appReady(page);

  const migration = await page.evaluate(() => {
    const sanitize = window.__HIGH_NOTES__.debug.sanitizeSave;
    const fresh = sanitize({ version: 23 });
    const hostile = sanitize({
      version: 23,
      stage: 3,
      character: { classId: 'future-overpowered-class' },
      classState: { cooldown: 999, abilityUses: 1e20 },
      questStates: { 'story-skyglass': 999, 'future-quest': 12 },
      completedQuests: ['future-quest'],
      puzzleStates: { 'skyglass-inversion': { status: 'in-progress', input: ['E', 'Z', 'G'], attempts: 1e9 }, 'future-chord': { status: 'completed' } }
    });
    const oldStageThree = sanitize({
      version: 22,
      stage: 3,
      chapter: 3,
      tutorial: { status: 'completed' },
      character: { created: true },
      bossDefeated: true,
      composed: true,
      notes: ['C', 'E', 'G', 'B'],
      melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
      stageBosses: ['nullspeaker', 'rootbound-colossus'],
      chapterRelics: ['rootsong']
    });
    const completed = sanitize({
      version: 22,
      stage: 4,
      chapter: 4,
      tutorial: { status: 'completed' },
      character: { created: true },
      bossDefeated: true,
      composed: true,
      notes: ['C', 'E', 'G', 'B'],
      melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
      stageBosses: ['nullspeaker', 'rootbound-colossus', 'prism-choir', 'tidebreaker'],
      chapterRelics: ['rootsong', 'skyglass', 'moonwake']
    });
    const oldStageOne = sanitize({
      version: 22,
      stage: 1,
      tutorial: { status: 'completed' },
      character: { created: true },
      metEems: true,
      weeds: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
    });
    const interrupted = sanitize({
      version: 23,
      stage: 2,
      tutorial: { status: 'completed' },
      character: { created: true, classId: 'echo-weaver' },
      classState: { cooldown: 7.5, abilityUses: 9 },
      questStates: { 'story-rootsong': 2 },
      puzzleStates: { 'rootsong-minor': { status: 'in-progress', input: ['E', 'G'], attempts: 2 } }
    });
    return { fresh, hostile, oldStageOne, oldStageThree, completed, interrupted };
  });
  assert.equal(migration.fresh.version, 23);
  assert.equal(migration.fresh.character.classId, 'riffblade');
  assert.equal(migration.hostile.character.classId, 'riffblade');
  assert.equal(migration.hostile.classState.cooldown, 30);
  assert.equal(migration.hostile.classState.abilityUses, 999999);
  assert.equal('future-quest' in migration.hostile.questStates, false);
  assert.equal('future-chord' in migration.hostile.puzzleStates, false);
  assert.equal(migration.hostile.puzzleStates['skyglass-inversion'].attempts, 999);
  assert.equal(migration.oldStageOne.questStates['story-mossvale'], 2);
  assert.ok(migration.oldStageThree.completedQuests.includes('story-mossvale'));
  assert.ok(migration.oldStageThree.completedQuests.includes('story-rootsong'));
  assert.ok(migration.completed.completedQuests.includes('story-moonwake'));
  assert.deepEqual(migration.interrupted.puzzleStates['rootsong-minor'].input, ['E', 'G']);
  assert.equal(migration.interrupted.classState.cooldown, 7.5);

  await page.locator('#settingsButton').click();
  await page.locator('#settingsPanel:not([hidden])').waitFor();
  await page.locator('#settingsPanel .settings-card').click({ position: { x: 20, y: 20 } });
  assert.equal(await page.locator('#settingsPanel').getAttribute('hidden'), null, 'inside settings click must not dismiss');
  await page.mouse.click(3, 3);
  await page.waitForFunction(() => document.getElementById('settingsPanel').hidden);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'settingsButton');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'settingsButton', 'backdrop dismissal restores focus');

  await inspectCreator(page, viewport, '1366x768');
  await page.mouse.click(3, 3);
  assert.equal(await page.locator('#characterCreator').getAttribute('hidden'), null, 'protected character creator must ignore backdrop dismissal');
  await page.locator('#closeCharacterCreator').click();
  await context.close();
}

async function keyboardChecks(browser, failures) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  watchRuntime(page, 'keyboard', failures);
  await appReady(page);
  await page.evaluate(() => {
    const raw = {
      version: 23,
      stage: 1,
      chapter: 1,
      tutorial: { status: 'completed', rewardClaimed: true },
      character: { created: true, displayName: 'Keyboard QA', classId: 'riffblade' },
      metEems: true,
      metJimbo: true,
      metBlu: true,
      weeds: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
      notes: ['C', 'E', 'G', 'B'],
      questStates: { 'story-mossvale': 5 },
      puzzleStates: { 'mossvale-major': { status: 'available', input: [], attempts: 0 } }
    };
    localStorage.setItem('highNotesSaveV7', JSON.stringify(window.__HIGH_NOTES__.debug.sanitizeSave(raw)));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossStory);
  await page.locator('#continueButton').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());

  await page.keyboard.down('f');
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().blocking === true);
  await page.keyboard.up('f');
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().blocking === false);

  await page.keyboard.down('j');
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().chargedThisHold === true, null, { timeout: 1800 });
  await page.keyboard.up('j');
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().attackHeld === false);

  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().classCooldown > 0);
  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.snapshot().state.classState.abilityUses), 1, 'keyboard class ability fires exactly once');

  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.story.openChord('mossvale-major', false)), true);
  for (const key of ['1', '2', '3']) await page.keyboard.press(key);
  await page.waitForFunction(() => window.__HIGH_NOTES__.story.state().puzzleStates['mossvale-major'].status === 'completed');
  await context.close();
}

async function starterClassChecks(browser, failures) {
  const expectations = {
    'riffblade': (result) => result.attacks > 0,
    'groveguard': (result) => result.barrierCharges === 1 && result.barrier > 0,
    'echo-weaver': (result) => result.fields === 1,
    'tempo-runner': (result) => result.classDash > 0 && result.attacks > 0
  };
  for (const classId of Object.keys(expectations)) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    watchRuntime(page, `class-${classId}`, failures);
    await appReady(page);
    await page.evaluate((id) => {
      const raw = {
        version: 23,
        stage: 1,
        chapter: 1,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Class QA', classId: id },
        classState: { cooldown: 0, abilityUses: 0 }
      };
      localStorage.setItem('highNotesSaveV7', JSON.stringify(window.__HIGH_NOTES__.debug.sanitizeSave(raw)));
    }, classId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossStory);
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
    const result = await page.evaluate(() => {
      const used = window.__HIGH_NOTES__.classes.useAbility();
      const player = window.__HIGH_NOTES__.firstPerson.getPlayer();
      const entities = window.__HIGH_NOTES__.firstPerson.getEntities();
      const snapshot = window.__HIGH_NOTES__.snapshot();
      const duplicate = window.__HIGH_NOTES__.classes.useAbility();
      return {
        used,
        duplicate,
        cooldown: player.classCooldown,
        barrier: player.classBarrier,
        barrierCharges: player.classBarrierCharges,
        classDash: player.classDashTimer,
        attacks: entities.attacks.length,
        fields: entities.classFields.length,
        abilityUses: snapshot.state.classState.abilityUses
      };
    });
    assert.equal(result.used, true, `${classId}: first signature ability use succeeds`);
    assert.equal(result.duplicate, false, `${classId}: cooldown prevents duplicate activation`);
    assert.ok(result.cooldown > 0, `${classId}: cooldown starts`);
    assert.equal(result.abilityUses, 1, `${classId}: one use is persisted`);
    assert.ok(expectations[classId](result), `${classId}: signature effect is present`);
    await context.close();
  }
}

async function controllerChecks(browser, failures) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => {
    const buttons = Array.from({ length: 20 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: 'QA Standard Gamepad', index: 0, connected: true, mapping: 'standard', timestamp: 1, buttons, axes: [0, 0, 0, 0] };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.__qaPadButton = (indices, down) => {
      for (const index of indices) {
        buttons[index].pressed = !!down;
        buttons[index].touched = !!down;
        buttons[index].value = down ? 1 : 0;
      }
      pad.timestamp += 1;
    };
  });
  const page = await context.newPage();
  watchRuntime(page, 'controller', failures);
  await appReady(page);
  await page.evaluate(() => {
    const raw = {
      version: 23,
      stage: 2,
      chapter: 2,
      tutorial: { status: 'completed', rewardClaimed: true },
      character: { created: true, displayName: 'Controller QA', classId: 'echo-weaver' },
      metPip: true,
      storyGuides: ['pip'],
      drums: ['rh-d1', 'rh-d2', 'rh-d3'],
      questStates: { 'story-rootsong': 2 },
      puzzleStates: { 'rootsong-minor': { status: 'available', input: [], attempts: 0 } }
    };
    localStorage.setItem('highNotesSaveV7', JSON.stringify(window.__HIGH_NOTES__.debug.sanitizeSave(raw)));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossInput);
  await page.locator('#continueButton').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
  await page.waitForFunction(() => window.MossInput.isConnected());

  async function pressPad(indices) {
    await page.evaluate((pressed) => window.__qaPadButton(pressed, true), indices);
    await page.waitForTimeout(90);
    await page.evaluate((pressed) => window.__qaPadButton(pressed, false), indices);
    await page.waitForTimeout(90);
  }

  await pressPad([10, 11]);
  assert.ok(await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().classCooldown > 0), 'controller L3+R3 triggers class ability');

  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.story.openChord('rootsong-minor', false)), true);
  for (const note of ['E', 'G', 'B']) {
    await page.locator(`[data-chord-note="${note}"]`).focus();
    await pressPad([0]);
  }
  await page.waitForFunction(() => window.__HIGH_NOTES__.story.state().puzzleStates['rootsong-minor'].status === 'completed');
  await pressPad([1]);
  await page.waitForFunction(() => document.getElementById('chordPanel').hidden === true);
  await context.close();
}

async function chordChecks(browser, failures) {
  const viewport = { width: 1024, height: 768 };
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  watchRuntime(page, 'chord', failures);
  await appReady(page);
  await page.evaluate(() => {
    const raw = {
      version: 23,
      stage: 2,
      chapter: 2,
      tutorial: { status: 'completed', rewardClaimed: true },
      character: { created: true, displayName: 'Chord QA', classId: 'echo-weaver' },
      classState: { cooldown: 7.5, abilityUses: 4 },
      metPip: true,
      storyGuides: ['pip'],
      drums: ['rh-d1', 'rh-d2', 'rh-d3'],
      questStates: { 'story-rootsong': 2 },
      puzzleStates: { 'rootsong-minor': { status: 'in-progress', input: ['E', 'G'], attempts: 2 } }
    };
    localStorage.setItem('highNotesSaveV7', JSON.stringify(window.__HIGH_NOTES__.debug.sanitizeSave(raw)));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossStory);
  await page.locator('#continueButton').click();
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());
  const cooldown = await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().classCooldown);
  assert.ok(Math.abs(cooldown - 7.5) < .2, 'class cooldown survives a real save/reload');
  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.story.openChord('rootsong-minor', false)), true);
  await page.locator('#chordPanel:not([hidden])').waitFor();
  assert.equal(await page.locator('#chordInputProgress .filled').count(), 2, 'partial chord input survives a real save/reload');
  const card = await page.locator('#chordPanel .chord-card').boundingBox();
  assert.ok(inside(card, viewport, 2), 'tablet chord card fits viewport');
  for (const note of ['C', 'E', 'G', 'B']) {
    const rect = await page.locator(`[data-chord-note="${note}"]`).boundingBox();
    assert.ok(rect.width >= 44 && rect.height >= 44, `chord note ${note} remains touch-sized`);
  }
  await shot(page, '1024x768-chord');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('highNotesSaveV7')).beatcoins);
  await page.locator('[data-chord-note="B"]').click();
  const afterFirst = await page.evaluate(() => JSON.parse(localStorage.getItem('highNotesSaveV7')).beatcoins);
  assert.equal(afterFirst, before + 3, 'first chord completion awards once');
  await page.locator('#closeChordButton').click();
  assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.story.openChord('rootsong-minor', true)), true);
  for (const note of ['E', 'G', 'B']) await page.locator(`[data-chord-note="${note}"]`).click();
  const afterReplay = await page.evaluate(() => JSON.parse(localStorage.getItem('highNotesSaveV7')).beatcoins);
  assert.equal(afterReplay, afterFirst, 'chord replay never duplicates its reward');
  await context.close();
}

async function landscapePhoneChecks(browser, failures, viewport, label, firstPerson) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await context.addInitScript(({ firstPerson }) => {
    localStorage.clear();
    if (firstPerson) localStorage.setItem('highNotesControllerV1', JSON.stringify({ viewMode: 'firstPerson', mobileLookSensitivity: 1.15 }));
    window.__qaVibrations = [];
    try {
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern) => { window.__qaVibrations.push(pattern); return true; } });
    } catch (_) { /* Unsupported vibration is itself a valid runtime path. */ }
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
  }, { firstPerson });
  const page = await context.newPage();
  watchRuntime(page, label, failures);
  await appReady(page);
  await inspectCreator(page, viewport, label);

  await page.locator('[data-class-id="echo-weaver"], #characterClassChoices .class-choice').nth(2).click();
  await page.locator('#characterName').fill('QA Echo');
  await page.locator('#confirmCharacter').scrollIntoViewIfNeeded();
  await page.locator('#confirmCharacter').click();
  await page.locator('#tutorialPanel:not([hidden])').waitFor();
  await page.waitForTimeout(250);
  const controlIds = ['touchPulseButton', 'touchClassButton', 'touchDodgeButton', 'touchAttackButton', 'touchBlockButton', 'touchInteractButton'];
  for (const id of controlIds) {
    const rect = await page.locator(`#${id}`).boundingBox();
    assert.ok(inside(rect, viewport, 2), `${label}: ${id} must stay inside viewport`);
    assert.ok(rect.width >= 44 && rect.height >= 44, `${label}: ${id} must remain touch-sized`);
  }
  await assertNoOverflow(page, `${label} gameplay`);
  await shot(page, `${label}-${firstPerson ? 'first-person' : 'gameplay'}`);

  await page.evaluate(() => {
    const button = document.getElementById('touchClassButton');
    const rect = button.getBoundingClientRect();
    const options = (type) => ({ bubbles: true, cancelable: true, pointerId: 69, pointerType: 'touch', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: type === 'pointerup' ? 0 : 1 });
    button.dispatchEvent(new PointerEvent('pointerdown', options('pointerdown')));
    button.dispatchEvent(new PointerEvent('pointerup', options('pointerup')));
  });
  await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().classCooldown > 0);
  assert.ok(await page.evaluate(() => !window.navigator.vibrate || window.__qaVibrations.length > 0), `${label}: enabled mobile haptics receive successful-action feedback`);

  if (firstPerson) {
    await page.waitForFunction(() => document.body.classList.contains('first-person') && !document.getElementById('fpLookZone').hidden);
    const before = await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().facing);
    const result = await page.evaluate(() => {
      function pointer(type, target, id, x, y) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
      }
      const joystick = document.getElementById('joystickZone');
      const look = document.getElementById('fpLookZone');
      const attack = document.getElementById('touchAttackButton');
      const j = joystick.getBoundingClientRect();
      const l = look.getBoundingClientRect();
      const a = attack.getBoundingClientRect();
      pointer('pointerdown', joystick, 71, j.left + j.width * .36, j.top + j.height * .65);
      pointer('pointerdown', look, 72, l.left + l.width * .25, l.top + l.height * .28);
      pointer('pointerdown', attack, 73, a.left + a.width / 2, a.top + a.height / 2);
      pointer('pointermove', look, 72, l.left + l.width * .55, l.top + l.height * .4);
      return { attacks: window.__HIGH_NOTES__.firstPerson.getEntities().attacks.length };
    });
    await page.waitForTimeout(80);
    const afterFirstDrag = await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().facing);
    const releaseResult = await page.evaluate(() => {
      function pointer(type, target, id, x, y) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
      }
      const joystick = document.getElementById('joystickZone');
      const look = document.getElementById('fpLookZone');
      const attack = document.getElementById('touchAttackButton');
      const j = joystick.getBoundingClientRect();
      const l = look.getBoundingClientRect();
      const a = attack.getBoundingClientRect();
      pointer('pointerup', attack, 73, a.left + a.width / 2, a.top + a.height / 2);
      const attackReleased = attack.getAttribute('aria-pressed') === 'false';
      pointer('pointermove', look, 72, l.left + l.width * .7, l.top + l.height * .45);
      return { attackReleased, joystick: { x: j.left + j.width * .36, y: j.top + j.height * .65 }, look: { x: l.left + l.width * .7, y: l.top + l.height * .45 } };
    });
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().facing);
    await page.evaluate(({ joystick, look }) => {
      const opts = (id, x, y) => ({ bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, buttons: 0 });
      document.getElementById('fpLookZone').dispatchEvent(new PointerEvent('pointerup', opts(72, look.x, look.y)));
      document.getElementById('joystickZone').dispatchEvent(new PointerEvent('pointerup', opts(71, joystick.x, joystick.y)));
    }, releaseResult);
    assert.ok(Math.abs(afterFirstDrag - before) > 0.01 && Math.abs(after - afterFirstDrag) > 0.005, `${label}: right-side drag must continue after attack is released`);
    assert.equal(releaseResult.attackReleased, true, `${label}: lifting attack must release only attack`);
    assert.ok(result.attacks > 0, `${label}: first-person touch attack must reach campaign combat`);
  } else {
    const contact = await page.evaluate(() => {
      function pointer(type, target, id, x, y) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 }));
      }
      const joystick = document.getElementById('joystickZone');
      const block = document.getElementById('touchBlockButton');
      const j = joystick.getBoundingClientRect();
      const b = block.getBoundingClientRect();
      const centre = { x: j.left + j.width * .5, y: j.top + j.height * .5 };
      const points = { joystick: { x: j.left + j.width * .78, y: j.top + j.height * .48 }, block: { x: b.left + b.width / 2, y: b.top + b.height / 2 } };
      pointer('pointerdown', joystick, 81, centre.x, centre.y);
      pointer('pointermove', joystick, 81, points.joystick.x, points.joystick.y);
      pointer('pointerdown', block, 82, points.block.x, points.block.y);
      return points;
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().blocking), true, `${label}: movement and held block coexist`);
    assert.ok(await page.evaluate(() => window.MossInput.getVector('move').magnitude > .1), `${label}: joystick remains active while blocking`);
    await page.evaluate(({ block }) => document.getElementById('touchBlockButton').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 82, pointerType: 'touch', clientX: block.x, clientY: block.y, buttons: 0 })), contact);
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().blocking), false, `${label}: releasing block ends only block`);
    assert.ok(await page.evaluate(() => window.MossInput.getVector('move').magnitude > .1), `${label}: movement survives block release`);

    const attackPoint = await page.evaluate(() => {
      const attack = document.getElementById('touchAttackButton');
      const rect = attack.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      attack.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 83, pointerType: 'touch', clientX: point.x, clientY: point.y, buttons: 1 }));
      return point;
    });
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.getPlayer().chargedThisHold === true, null, { timeout: 1800 });
    assert.ok(await page.evaluate(() => window.MossInput.getVector('move').magnitude > .1), `${label}: movement survives a held charged attack`);
    await page.evaluate((point) => document.getElementById('touchAttackButton').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 83, pointerType: 'touch', clientX: point.x, clientY: point.y, buttons: 0 })), attackPoint);
    await page.evaluate(({ joystick }) => document.getElementById('joystickZone').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'touch', clientX: joystick.x, clientY: joystick.y, buttons: 0 })), contact);

    await page.evaluate(() => {
      const block = document.getElementById('touchBlockButton');
      const rect = block.getBoundingClientRect();
      const options = (type) => ({ bubbles: true, cancelable: true, pointerId: 84, pointerType: 'touch', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: type === 'pointercancel' ? 0 : 1 });
      block.dispatchEvent(new PointerEvent('pointerdown', options('pointerdown')));
      block.dispatchEvent(new PointerEvent('pointercancel', options('pointercancel')));
    });
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.firstPerson.getPlayer().blocking), false, `${label}: pointer cancellation clears a held action`);
  }

  await page.locator('[data-control="pause"]').click();
  await page.locator('#pauseScreen:not([hidden])').waitFor();
  await page.locator('#pauseSettingsButton').click();
  const closeRect = await page.locator('#closeSettingsButton').boundingBox();
  assert.ok(inside(closeRect, viewport, 2), `${label}: settings close button must remain visible`);
  await page.locator('[role="tab"]', { hasText: 'Controls' }).click();
  await page.locator('#touchLayout').selectOption('mirrored');
  assert.equal(await page.evaluate(() => document.body.classList.contains('touch-controls-mirrored')), true, `${label}: mirrored layout class`);
  await shot(page, `${label}-settings`);
  await context.close();
}

async function snapshotViewport(browser, failures, viewport, label, mode) {
  const context = await browser.newContext({ viewport, hasTouch: mode === 'portrait', isMobile: mode === 'portrait' });
  const page = await context.newPage();
  watchRuntime(page, label, failures);
  await appReady(page);
  if (mode === 'creator') await inspectCreator(page, viewport, label);
  else await shot(page, `${label}-${mode}`);
  await assertNoOverflow(page, label);
  await context.close();
}

async function portraitChecks(browser, failures) {
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  watchRuntime(page, 'portrait', failures);
  await appReady(page);
  assert.equal(await page.locator('#rotateNotice').evaluate((element) => getComputedStyle(element).display), 'none', 'portrait title remains usable before gameplay');
  await inspectCreator(page, viewport, '390x844');
  await page.locator('#confirmCharacter').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('rotateNotice')).display !== 'none');
  await shot(page, '390x844-rotate-guidance');
  await page.locator('#portraitSettingsButton').click();
  await page.locator('#settingsPanel:not([hidden])').waitFor();
  const close = await page.locator('#closeSettingsButton').boundingBox();
  assert.ok(inside(close, viewport, 2), 'portrait settings close remains reachable');
  await shot(page, '390x844-settings');
  await page.locator('#closeSettingsButton').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('rotateNotice')).display !== 'none');
  await context.close();
}

(async () => {
  const failures = [];
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-background-networking'] });
  try {
    await desktopChecks(browser, failures);
    await keyboardChecks(browser, failures);
    await starterClassChecks(browser, failures);
    await controllerChecks(browser, failures);
    await chordChecks(browser, failures);
    await landscapePhoneChecks(browser, failures, { width: 667, height: 375 }, '667x375', true);
    await landscapePhoneChecks(browser, failures, { width: 844, height: 390 }, '844x390', false);
    await portraitChecks(browser, failures);
    await snapshotViewport(browser, failures, { width: 1024, height: 768 }, '1024x768', 'creator');
    await snapshotViewport(browser, failures, { width: 1920, height: 1080 }, '1920x1080', 'creator');
    await snapshotViewport(browser, failures, { width: 2560, height: 1080 }, '2560x1080', 'title');
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], `Browser runtime failures:\n${failures.join('\n')}`);
  console.log(`V2.3 browser QA passed. Screenshots: ${outputDir}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
