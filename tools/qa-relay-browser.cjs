'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');

const url=process.env.HIGH_NOTES_QA_URL||'http://127.0.0.1:4173/';
const relay=process.env.HIGH_NOTES_RELAY_URL||'ws://127.0.0.1:8787';
const out=process.env.HIGH_NOTES_QA_OUT||path.join(os.tmpdir(),'high-notes-relay-browser');
const executablePath=[process.env.HIGH_NOTES_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
fs.mkdirSync(out,{recursive:true});

async function bootPlayer(browser,name) {
  const context=await browser.newContext({viewport:{width:1280,height:820}});
  await context.addInitScript(({relay,name})=>{
    window.HIGH_NOTES_ONLINE_SERVER=relay;
    try {
      localStorage.setItem('highNotesOnlineServer',relay);
      localStorage.setItem('highNotesSettingsV7',JSON.stringify({masterVolume:0,musicVolume:0,sfxVolume:0}));
    } catch (error) {}
    window.__HIGH_NOTES_QA_NAME=name;
  },{relay,name});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{errors.push('Unexpected native dialog: '+dialog.type());dialog.dismiss();});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('gameCanvas')?.dataset.runtimeReady==='true');
  await page.locator('#startButton').click();
 await page.locator('#confirmCharacter').click();
  await page.locator('#interfaceSetupBegin').click();
  await page.locator('#tutorialSkipButton').click();
  await page.locator('#livingConfirmAccept').click();
  await page.waitForFunction(()=>window.__HIGH_NOTES__&&window.__HIGH_NOTES__.snapshot().runtime.started);
  await page.keyboard.press('Escape');
  await page.locator('#pauseProductionButton').click();
  await page.locator('[data-production-tab="online"]').click();
  await page.fill('#onlineDisplayName',name);
  await page.locator('#saveOnlineProfile').click();
  return {context,page,errors,name};
}

function networkState(page) {
  return page.evaluate(()=> {
    const n=window.HighNotesV1&&window.HighNotesV1.network;
    if(!n)return null;
    return {
      id:n.id,room:n.room,host:n.host,socketStatus:n.socketStatus,health:n.relayHealthStatus,
      peers:Array.from(n.peers.values()).map(peer=>({id:peer.id,connected:peer.connected!==false,ready:peer.ready===true,instrument:peer.instrument||''})),
      remotes:Array.from(n.remoteSnapshots.values()).map(remote=>({id:remote.id,x:remote.x,y:remote.y,stage:remote.stage})),
      lastClose:n.lastSocketCloseCode||0,lastError:n.lastSafeError||'',tokenPresent:!!n.relayReconnectToken,
      pending:n.pendingRelayMessages.length,reconnectAttempts:n.reconnectAttempts
    };
  });
}

function arenaState(page) {
  return page.evaluate(()=> {
    const api=window.HighNotesV2Arena&&window.HighNotesV2Arena.debug;
    const arena=api&&api.arena;
    if(!arena)return null;
    return {
      active:!!arena.active,phase:arena.phase,matchType:arena.matchType,authority:!!arena.authority,
      matchId:arena.matchId||'',snapshotHost:arena.snapshotHost||'',lastSnapshotReceived:arena.lastSnapshotReceived||0,
      inputCount:arena.networkInputs&&arena.networkInputs.size||0,
      fighters:(arena.fighters||[]).map(f=>({ownerId:f.ownerId,x:f.x,y:f.y,stocks:f.stocks,damage:f.damage,disconnected:!!f.disconnected}))
    };
  });
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath,args:[
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ]});
  let host,client;
  try {
    host=await bootPlayer(browser,'Relay Host');
    client=await bootPlayer(browser,'Relay Guest');
    await Promise.all([
      host.page.evaluate(()=>window.HighNotesV1.network.probeRelayHealth(true)),
      client.page.evaluate(()=>window.HighNotesV1.network.probeRelayHealth(true))
    ]);
    await Promise.all([
      host.page.waitForFunction(()=>window.HighNotesV1.network.relayHealthStatus==='ok'),
      client.page.waitForFunction(()=>window.HighNotesV1.network.relayHealthStatus==='ok')
    ]);

    await host.page.locator('#createPrivateRoom').click();
    await host.page.waitForFunction(()=> {
      const n=window.HighNotesV1.network;
      return n.room&&n.socketStatus==='connected'&&n.relayReconnectToken;
    });
    const created=await networkState(host.page);
    assert.match(created.room,/^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(created.host,created.id);
    assert.equal(created.peers.length,1);
    await host.page.screenshot({path:path.join(out,'01-host-room.png')});

    await client.page.fill('#joinRoomCode',created.room);
    await client.page.locator('#joinRoom').click();
    await client.page.waitForTimeout(300);
    if ((await networkState(client.page)).room !== created.room) {
      await client.page.evaluate(room=>window.HighNotesV1.network.joinRoom(room),created.room);
    }
    await Promise.all([
      host.page.waitForFunction(()=>window.HighNotesV1.network.peers.size===2),
      client.page.waitForFunction(()=>window.HighNotesV1.network.peers.size===2&&window.HighNotesV1.network.host)
    ]);
    const joinedHost=await networkState(host.page);
    const joinedClient=await networkState(client.page);
    const guestId=joinedClient.id;
    assert.equal(joinedClient.room,created.room);
    assert.equal(joinedClient.host,created.id);
    assert.equal(joinedHost.peers.length,2);
    assert.equal(joinedClient.peers.length,2);
    await client.page.screenshot({path:path.join(out,'02-client-joined.png')});

    await host.page.evaluate(()=>window.HighNotesV1.network.worldPing());
    await client.page.waitForFunction(()=>window.HighNotesV1.network.worldPings.length>0);

    await host.page.locator('[data-production-tab="arena"]').click();
    await client.page.locator('[data-production-tab="arena"]').click();
    await host.page.locator('#v2Ready').waitFor();
    await client.page.locator('#v2Ready').waitFor();
    await client.page.locator('#v2Ready').click();
    await client.page.waitForFunction(({guestId})=>window.HighNotesV2Arena.debug.arena.lobbyReady.get(guestId)===true,{guestId});
    await host.page.waitForFunction(({guestId})=>window.HighNotesV2Arena.debug.arena.lobbyReady.get(guestId)===true,{guestId});
    await host.page.locator('#v2Ready').click();
    await host.page.waitForFunction(({hostId,guestId})=> {
      const arena=window.HighNotesV2Arena.debug.arena;
      return arena.lobbyReady.get(hostId)===true&&arena.lobbyReady.get(guestId)===true;
    },{hostId:created.id,guestId});
    await host.page.waitForFunction(()=> {
      const button=document.getElementById('v2OnlineStart');
      return button&&!button.disabled;
    });
    await host.page.locator('#v2OnlineStart').click();
    await Promise.all([
      host.page.waitForFunction(()=>window.HighNotesV2Arena.debug.arena.active&&window.HighNotesV2Arena.debug.arena.matchType==='online'),
      client.page.waitForFunction(()=>window.HighNotesV2Arena.debug.arena.active&&window.HighNotesV2Arena.debug.arena.matchType==='online')
    ]);
    const arenaHostStart=await arenaState(host.page);
    const arenaClientStart=await arenaState(client.page);
    assert.equal(arenaHostStart.authority,true);
    assert.equal(arenaClientStart.authority,false);
    await host.page.screenshot({path:path.join(out,'03-online-arena-start.png')});

    await Promise.allSettled([
      host.page.evaluate(()=>{window.HighNotesV2Arena.stop('qa-cleanup');window.HighNotesV1.network.leave('qa-cleanup');}),
      client.page.evaluate(()=>{window.HighNotesV2Arena.stop('qa-cleanup');window.HighNotesV1.network.leave('qa-cleanup');})
    ]);
    await host.page.waitForTimeout(400);
    assert.equal((await networkState(client.page)).room,'');
    assert.deepEqual(host.errors,[]);
    assert.deepEqual(client.errors,[]);
    console.log('Relay browser UI QA passed: live worker health, two-client create/join UI, world ping, online arena launch, cleanup. Protocol reconnect and migration are covered by qa-relay-live. Screenshots: '+out);
  } catch (error) {
    if (host) await host.page.screenshot({path:path.join(out,'FAILURE-host.png')}).catch(()=>{});
    if (client) await client.page.screenshot({path:path.join(out,'FAILURE-client.png')}).catch(()=>{});
    if (host) console.error('Host network:',JSON.stringify(await networkState(host.page).catch(()=>null)));
    if (client) console.error('Client network:',JSON.stringify(await networkState(client.page).catch(()=>null)));
    if (host) console.error('Host arena:',JSON.stringify(await arenaState(host.page).catch(()=>null)));
    if (client) console.error('Client arena:',JSON.stringify(await arenaState(client.page).catch(()=>null)));
    console.error(error);
    process.exitCode=1;
  } finally {
    if (host) await host.context.close().catch(()=>{});
    if (client) await client.context.close().catch(()=>{});
    await browser.close();
  }
})();
