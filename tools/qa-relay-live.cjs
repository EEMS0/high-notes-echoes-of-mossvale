'use strict';
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const relayRequire=createRequire(require('node:path').resolve(__dirname,'../multiplayer-relay/package.json'));
const WebSocket=relayRequire('ws');

const relayHttp=process.env.HIGH_NOTES_RELAY_HTTP||'http://127.0.0.1:8787';
const relayWs=process.env.HIGH_NOTES_RELAY_WS||'ws://127.0.0.1:8787';
const origin=process.env.HIGH_NOTES_RELAY_ORIGIN||'http://127.0.0.1:4173';
const PROTOCOL=2;

function id(prefix) {
  return (prefix+'QA'+Math.random().toString(36).slice(2,12).toUpperCase()).replace(/[^A-Z0-9]/g,'').slice(0,12).padEnd(12,'A');
}

function withTimeout(promise,label,ms=8000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})
  ]).finally(()=>clearTimeout(timer));
}

class Client {
  constructor(playerId) {
    this.id=playerId;
    this.seq=0;
    this.messages=[];
    this.waiters=[];
    this.token='';
    this.host='';
    this.socket=null;
  }
  connect(room,intent,token='') {
    const url=new URL('/v2/rooms/'+room,relayWs);
    url.searchParams.set('intent',intent);
    url.searchParams.set('playerId',this.id);
    if (token) url.searchParams.set('token',token);
    this.socket=new WebSocket(url.toString(),{headers:{Origin:origin}});
    this.socket.on('message',data=>{
      const message=JSON.parse(String(data));
      this.messages.push(message);
      if (message.type==='welcome'&&message.payload) {
        this.token=message.payload.reconnectToken||this.token;
        this.host=message.payload.host||this.host;
      }
      if (message.type==='room-welcome'&&message.payload) this.host=message.payload.host||this.host;
      if (message.type==='host-migrate'&&message.payload) this.host=message.payload.host||this.host;
      this.waiters=this.waiters.filter(waiter=>{
        if (!waiter.predicate(message)) return true;
        waiter.resolve(message);
        return false;
      });
    });
    return withTimeout(new Promise((resolve,reject)=>{
      this.socket.once('open',resolve);
      this.socket.once('error',reject);
    }),this.id+' websocket open');
  }
  waitFor(predicate,label,ms=8000) {
    const existing=this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return withTimeout(new Promise(resolve=>this.waiters.push({predicate,resolve})),label,ms);
  }
  send(type,payload={},room) {
    const frame={v:PROTOCOL,type,from:this.id,room,payload,ts:Date.now(),seq:++this.seq};
    this.socket.send(JSON.stringify(frame));
    return frame;
  }
  close(code=1000,reason='qa') {
    if (this.socket&&this.socket.readyState<WebSocket.CLOSING) this.socket.close(code,reason);
  }
  terminate() {
    if (this.socket&&this.socket.readyState<WebSocket.CLOSED) this.socket.terminate();
  }
}

(async()=>{
  const health=await fetch(new URL('/health',relayHttp),{headers:{Origin:origin}}).then(r=>r.json());
  assert.equal(health.ok,true);
  assert.equal(health.protocolVersion,PROTOCOL);
  const allocation=await fetch(new URL('/v2/rooms',relayHttp),{method:'POST',headers:{Origin:origin}}).then(r=>r.json());
  assert.equal(allocation.ok,true);
  assert.match(allocation.roomCode,/^[A-HJ-NP-Z2-9]{6}$/);
  const room=allocation.roomCode;
  const host=new Client(id('HOST'));
  const guest=new Client(id('GUEST'));
  let rejoined=null;
  try {
    await host.connect(room,'create');
    await host.waitFor(m=>m.type==='welcome','host welcome');
    await host.waitFor(m=>m.type==='room-welcome','host room welcome');
    assert.equal(host.host,host.id);
    assert.ok(host.token);

    await guest.connect(room,'join');
    await guest.waitFor(m=>m.type==='welcome','guest welcome');
    await guest.waitFor(m=>m.type==='room-welcome'&&m.payload.peers.length===2,'guest room welcome');
    await host.waitFor(m=>m.type==='room-join'&&m.from===guest.id,'host sees guest join');
    assert.equal(guest.host,host.id);
    assert.ok(guest.token);

    host.send('room-sync',{},room);
    await host.waitFor(m=>m.type==='room-welcome'&&m.payload.peers.length===2,'host room sync');
    host.send('player-ready',{ready:true,instrument:'guitar'},room);
    guest.send('player-ready',{ready:true,instrument:'guitar'},room);
    await Promise.all([
      host.waitFor(m=>m.type==='player-ready'&&m.from===guest.id,'host sees guest ready'),
      guest.waitFor(m=>m.type==='player-ready'&&m.from===host.id,'guest sees host ready')
    ]);

    const matchId='N'+Math.random().toString(36).slice(2,14).toUpperCase().padEnd(12,'0');
    const match={matchId,mode:'stock',stage:'mossvale-amphitheatre',stocks:3,duration:180,startAt:Date.now()+1200,
      players:[host.id,guest.id].map((playerId,index)=>({id:playerId,name:index?'Guest':'Host',instrument:'guitar',colour:index?'#ff9d57':'#7df7a1'}))};
    host.send('match-start',match,room);
    await Promise.all([
      host.waitFor(m=>m.type==='match-start'&&m.payload.matchId===matchId,'host match echo'),
      guest.waitFor(m=>m.type==='match-start'&&m.payload.matchId===matchId,'guest match start')
    ]);

    guest.send('arena-input',{matchId,seq:1,x:1,y:0,guard:false},room);
    await host.waitFor(m=>m.type==='arena-input'&&m.from===guest.id&&m.payload.x===1,'host receives guest arena input');
    const snapshot={matchId,seq:1,time:178.5,phase:'playing',
      fighters:[host.id,guest.id].map((playerId,index)=>({id:playerId,x:395+index*410,y:420,vx:0,vy:0,facing:1,damage:0,stocks:3,guard:100,invuln:0,hitstun:0,respawn:0,ultimate:0,attack:'',attackTime:0,attackHits:[],knockouts:0,falls:0,disconnected:false})),
      projectiles:[]};
    host.send('arena-snapshot',snapshot,room);
    await guest.waitFor(m=>m.type==='arena-snapshot'&&m.payload.seq===1,'guest receives host snapshot');

    guest.close(4000,'qa_disconnect');
    await host.waitFor(m=>m.type==='room-leave'&&m.from===guest.id&&m.payload.temporary===true,'temporary guest disconnect');
    rejoined=new Client(guest.id);
    await rejoined.connect(room,'reconnect',guest.token);
    await rejoined.waitFor(m=>m.type==='welcome','guest reconnect welcome');
    await host.waitFor(m=>m.type==='room-join'&&m.from===guest.id&&m.payload.reconnected===true,'host sees guest reconnect');
    assert.ok(rejoined.token&&rejoined.token!==guest.token);

    host.close(4000,'qa_host_disconnect');
    await rejoined.waitFor(m=>m.type==='host-migrate'&&m.payload.host===guest.id,'guest receives host migration');
    assert.equal(rejoined.host,guest.id);

    rejoined.send('room-leave',{reason:'qa-cleanup'},room);
    console.log('Relay live QA passed: health, allocate, create/join, room-sync, ready, match-start relay echo, arena-input, arena-snapshot, 30s reconnect token, host migration, cleanup.');
  } finally {
    host.close(1000,'qa-cleanup');
    guest.close(1000,'qa-cleanup');
    if (rejoined) rejoined.close(1000,'qa-cleanup');
    setTimeout(()=>{
      host.terminate();
      guest.terminate();
      if (rejoined) rejoined.terminate();
    },250).unref();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
