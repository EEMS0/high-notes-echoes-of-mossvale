#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const baseUrl = process.env.HIGH_NOTES_QA_URL || 'http://127.0.0.1:4173/';
const browserCandidates = [
  process.env.HIGH_NOTES_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

assert.ok(executablePath, 'Chrome or Edge is required for input/accessibility QA');

const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const inputSource = fs.readFileSync(path.join(root, 'input-manager.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(gameSource, /pollGamepad\(menuHandled, dt\)/, 'quick-wheel receives real frame time');
assert.match(gameSource, /padHold \+= Math\.max\(0, Number\(dt\) \|\| 0\)/, 'quick-wheel accumulates real frame time');
assert.doesNotMatch(gameSource, /padHold\s*\+=\s*1\s*\/\s*60/, 'fixed-frame wheel timing is absent');
assert.match(inputSource, /event\.pointerType === 'touch'\) return;/, 'touch pointermove is ignored for keyboard switching');
assert.match(htmlSource, /id="dialogueBox"[^>]+aria-modal="true"[^>]+tabindex="-1"/, 'dialogue is a focusable modal');

function runtimeWatch(page, failures) {
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
}

(async () => {
  const failures = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--disable-background-networking']
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  runtimeWatch(page, failures);

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossInput && window.MossControllerUI);

    await page.locator('#settingsButton').click();
    await page.locator('#settingsPanel:not([hidden])').waitFor();
    const tabSemantics = await page.locator('#settingsTabs [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      return {
        id: tab.id,
        category: tab.dataset.settingsCategory,
        panelExists: !!panel,
        labelledBack: !!panel && panel.getAttribute('aria-labelledby') === tab.id
      };
    }));
    assert.equal(tabSemantics.length, 7, 'all settings categories are exposed as tabs');
    assert.ok(tabSemantics.every((tab) => tab.id && tab.category && tab.panelExists && tab.labelledBack), 'tabs and panels have bidirectional ARIA linkage');

    await page.locator('#settings-tab-gameplay').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-tab-audio', 'ArrowRight activates and focuses the next settings tab');
    assert.equal(await page.locator('#settings-tab-audio').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#settings-panel-audio').getAttribute('hidden'), null);
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-tab-accessibility', 'End focuses the final settings tab');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-tab-gameplay', 'Home focuses the first settings tab');
    await page.locator('#closeSettingsButton').click();

    const pointerMethods = await page.evaluate(() => {
      window.MossInput.setActiveMethod('touch');
      for (let i = 0; i < 4; i++) window.MossInput.update(0.25);
      for (let i = 0; i < 30; i++) {
        window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', movementX: 30, movementY: 30 }));
      }
      const afterTouchMove = window.MossInput.getActiveMethod();
      for (let i = 0; i < 4; i++) window.MossInput.update(0.25);
      for (let i = 0; i < 30; i++) {
        window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', movementX: 30, movementY: 30 }));
      }
      return { afterTouchMove, afterMouseMove: window.MossInput.getActiveMethod() };
    });
    assert.deepEqual(pointerMethods, { afterTouchMove: 'touch', afterMouseMove: 'keyboard' }, 'pointer movement preserves touch mode but still detects mouse input');

    const promptModes = await page.evaluate(() => {
      const box = document.getElementById('dialogueBox');
      const button = document.getElementById('dialogueContinueButton');
      const hint = document.getElementById('dialogueHint');
      box.hidden = false;
      button.textContent = 'Close';
      const read = (method) => {
        window.MossInput.setActiveMethod(method);
        window.MossControllerUI.refreshPrompts();
        return { text: hint.textContent.trim(), desktopOnly: hint.classList.contains('desktop-only') };
      };
      const gamepad = read('gamepad');
      const keyboard = read('keyboard');
      const touch = read('touch');
      box.hidden = true;
      return { gamepad, keyboard, touch };
    });
    assert.match(promptModes.gamepad.text, /A close/i, 'dialogue gamepad prompt follows the current action');
    assert.match(promptModes.keyboard.text, /E \/ Enter to close/i, 'dialogue keyboard prompt follows the current action');
    assert.match(promptModes.touch.text, /Tap close/i, 'dialogue touch prompt follows the current action');
    assert.equal(promptModes.touch.desktopOnly, true, 'touch keeps the redundant desktop hint visually suppressed');

    await page.evaluate(() => {
      const save = window.__HIGH_NOTES__.debug.sanitizeSave({
        version: 24,
        stage: 1,
        chapter: 1,
        tutorial: { status: 'completed', rewardClaimed: true },
        character: { created: true, displayName: 'Input QA', classId: 'riffblade' },
        metEems: true,
        notes: ['C', 'E', 'G', 'B'],
        melody: ['C', 'E', 'G', 'B', 'C', 'E', 'G', 'B'],
        composed: true
      });
      localStorage.clear();
      localStorage.setItem('highNotesSaveV7', JSON.stringify(save));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__HIGH_NOTES__ && window.MossControllerUI);
    await page.locator('#continueButton').click();
    await page.waitForFunction(() => window.__HIGH_NOTES__.firstPerson.isPlaying());

    const npcId = await page.evaluate(() => {
      const api = window.__HIGH_NOTES__;
      const npc = api.firstPerson.getEntities().npcs[0];
      if (!npc) throw new Error('No NPC available for dialogue focus QA');
      const position = api.firstPerson.npcWorldPosition(npc);
      api.debug.teleport(position.x, position.y);
      api.firstPerson.interact();
      return npc.id;
    });
    assert.ok(npcId, 'opened a real NPC dialogue');
    await page.locator('#dialogueBox:not([hidden])').waitFor();
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'dialogueBox');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dialogueBox', 'desktop Tab focus remains in the modal dialogue');
    await page.evaluate(() => {
      for (let i = 0; i < 30 && window.__HIGH_NOTES__.controller.isDialogueOpen(); i++) {
        window.__HIGH_NOTES__.controller.advanceDialogue();
      }
    });
    await page.waitForFunction(() => document.getElementById('dialogueBox').hidden);

    await page.evaluate(() => window.__HIGH_NOTES__.debug.openLiving('mastery'));
    await page.locator('#livingPanel:not([hidden])').waitFor();
    const livingInterruption = await page.evaluate(() => {
      window.__HIGH_NOTES__.controller.pauseForInterruption();
      const living = document.getElementById('livingPanel');
      const pause = document.getElementById('pauseScreen');
      return {
        paused: window.__HIGH_NOTES__.controller.isPaused(),
        livingHidden: living.hidden,
        livingInert: living.inert,
        livingAriaHidden: living.getAttribute('aria-hidden'),
        pauseHidden: pause.hidden
      };
    });
    assert.deepEqual(livingInterruption, {
      paused: false,
      livingHidden: false,
      livingInert: false,
      livingAriaHidden: 'false',
      pauseHidden: true
    }, 'interruption audio-pause does not create a mutually inert pause modal over Living Resonance');
    await page.locator('#closeLivingButton').click();

    await page.evaluate(() => window.__HIGH_NOTES__.controller.pauseForInterruption());
    await page.locator('#pauseScreen:not([hidden])').waitFor();
    assert.equal(await page.evaluate(() => window.__HIGH_NOTES__.controller.isPaused()), true, 'interruption still opens pause during unobstructed gameplay');

    assert.deepEqual(failures, [], failures.join('\n'));
    console.log('Input/accessibility browser QA passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
