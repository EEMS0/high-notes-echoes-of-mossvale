'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const labels=require('../map-label-runtime.js');
const url=process.env.HIGH_NOTES_QA_URL||'http://127.0.0.1:4173/';
const out=process.env.HIGH_NOTES_QA_OUT||path.join(os.tmpdir(),'high-notes-game-flow');
const executablePath=[process.env.HIGH_NOTES_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>{errors.push('Unexpected native dialog: '+d.type());d.dismiss();});
  page.setDefaultTimeout(30000);
  const shot=async name=>page.screenshot({path:path.join(out,name+'.png')});
  const snapshot=()=>page.evaluate(()=>window.__HIGH_NOTES__.snapshot());
  try{
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('gameCanvas')?.dataset.runtimeReady==='true');
    await page.locator('#startButton').click();
    const cards=await page.locator('#characterClassChoices button').evaluateAll(els=>els.map(e=>{
      const r=e.getBoundingClientRect(),form=document.getElementById('characterForm').getBoundingClientRect();
      return {text:e.innerText,visible:r.top>=form.top&&r.bottom<=form.bottom,opacity:getComputedStyle(e).opacity};
    }));
    assert.equal(cards.length,4);assert.ok(cards.every(c=>c.visible&&c.text&&c.opacity==='1'),'all classes visible without a click or scroll');
    await shot('01-creator-desktop');
    for(const viewport of [{width:390,height:844},{width:844,height:390}]){
      await page.setViewportSize(viewport);await shot('02-creator-'+viewport.width);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page horizontal overflow');
      if(viewport.width<viewport.height){
        const panel=await page.locator('#characterCreator').boundingBox();
        assert.ok(panel.height>viewport.height*.9,'portrait creator uses the full display height');
      }
      await page.locator('#confirmCharacter').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#confirmCharacter').isVisible());
    }
    await page.setViewportSize({width:1440,height:900});
   await page.locator('#confirmCharacter').click();
    await page.locator('#interfaceSetupBegin').click();
    await page.locator('#tutorialSkipButton').click();
    await page.waitForFunction(()=>document.activeElement.id==='livingConfirmCancel');
    await shot('03-skip-confirm');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('livingConfirmOverlay').hidden);
    assert.equal((await snapshot()).state.tutorial.status,'in-progress');
    await page.locator('#tutorialSkipButton').click();await page.locator('#livingConfirmAccept').click();
    await page.waitForFunction(()=>document.activeElement.id==='gameCanvas');
    assert.equal((await snapshot()).state.tutorial.status,'skipped');
    for(let i=0;i<5;i++){
      await page.keyboard.press('Tab');assert.equal((await snapshot()).runtime.mapOpen,true);
      await page.keyboard.press('Escape');assert.equal((await snapshot()).runtime.paused,false);
    }
    await page.keyboard.press('Tab');await shot('04-atlas-desktop');
    const placed=(await snapshot()).runtime.mapLabels;
    assert.ok(placed.some(l=>l.text==='QUEST')&&placed.some(l=>l.text==='YOU'));
    for(const label of placed)assert.ok(!placed.some(other=>other!==label&&labels.overlaps(label,other)),'atlas label separation');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.__HIGH_NOTES__.debug.openComposer());
    await page.locator('#playMelodyButton').click();
    assert.equal((await snapshot()).runtime.composerPreviewPlaying,true);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    assert.equal((await snapshot()).runtime.composerPreviewPlaying,false);
    assert.match(await page.locator('#composerStatus').innerText(),/stopped|paused/i);
    await shot('05-composer-interrupted');await page.locator('#closeComposerButton').click();
    // Dismiss the real focus-loss pause before checking ordinary menu focus.
    if((await snapshot()).runtime.paused)await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');await page.locator('#pauseSettingsButton').click();
    const before=await page.evaluate(()=>localStorage.getItem('highNotesSaveV7'));
    await page.locator('.settings-danger-zone summary').click();
    await page.locator('#resetButton').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'livingConfirmCancel');
    assert.equal(await page.locator('#livingConfirmOverlay').evaluate(el=>!!el.closest('[inert]')),false);
    await shot('06-reset-confirm');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement.id==='resetButton');
    assert.equal(await page.evaluate(()=>localStorage.getItem('highNotesSaveV7')),before,'cancel never erases or rewrites the save');
    await page.locator('#closeSettingsButton').click();await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      const a=window.__HIGH_NOTES__;
      a.debug.grantAll();
      a.debug.compose();
      a.debug.openRhythmTrial('mossvale');
      a.debug.startRhythmTrial('mossvale');
      a.debug.completeRhythmTrial('A');
    });
    await page.locator('#resonanceContinueBossButton').click();
    await page.waitForFunction(()=>!!window.__HIGH_NOTES__.snapshot().boss);
    await page.evaluate(()=>{const a=window.__HIGH_NOTES__;a.debug.setInvulnerable(0);a.debug.receiveDamage(999);});
    await page.waitForFunction(()=>{const s=window.__HIGH_NOTES__.snapshot();return s.player.health===s.player.maxHealth&&!s.boss&&!s.runtime.paused;});
    const recovered=await snapshot(),center=await page.evaluate(()=>window.__HIGH_NOTES__.firstPerson.getLevelData().boss);
    const distance=Math.hypot(recovered.player.x-center.x,recovered.player.y-center.y);
    assert.ok(distance>305&&distance<700,'boss loss respawns safely beside arena at distance '+Math.round(distance));
    assert.equal(recovered.state.living.rhythmTrials.mossvale.cleared,true,'gate remains open');
    assert.equal(recovered.runtime.projectiles,0);assert.equal(recovered.runtime.attacks,0);
    await shot('07-boss-checkpoint');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('gameCanvas')?.dataset.runtimeReady==='true');
    await page.locator('#continueButton').click();
    const reloaded=await snapshot();assert.equal(reloaded.state.living.rhythmTrials.mossvale.cleared,true);
    assert.ok(Math.hypot(reloaded.player.x-center.x,reloaded.player.y-center.y)>355,'reload does not force a boss retry');
    await page.evaluate(()=>{window.__HIGH_NOTES__.debug.startBoss();window.__HIGH_NOTES__.debug.defeatBoss();});
    await page.locator('#endingScreen:not([hidden])').waitFor();await shot('08-chapter-choice');
    await page.locator('#endingStayButton').click();assert.equal((await snapshot()).state.stage,1);
    assert.equal((await snapshot()).runtime.paused,false,'keep exploring returns control');
    assert.deepEqual(errors,[]);
    console.log('Game-flow browser QA passed: first-open classes, mobile overflow, safe confirms, Tab/escape, map collisions, composer interruption, boss retry/reload, chapter choice. Screenshots: '+out);
  }catch(error){await shot('FAILURE');console.error(error);process.exitCode=1;}
  finally{await browser.close();}
})();
