(function () {
  'use strict';

  var VERSION = '2.0.0';
  var PROTOCOL_VERSION = 2;
  var FIXED_STEP = 1 / 60;
  var SHARED_NETWORK_CONFIG = window.HighNotesV1 && window.HighNotesV1.multiplayerConfig || {};
  var NETWORK_TICK_RATE = Number(SHARED_NETWORK_CONFIG.networkTickRate) || 20;
  var NETWORK_SNAPSHOT_RATE = Number(SHARED_NETWORK_CONFIG.snapshotRate) || 10;
  var MAX_FRAME = 0.05;
  var MAX_EFFECTS = 96;
  var MAX_PROJECTILES = 24;
  var MATCH_SECONDS = 180;
  var STARTING_STOCKS = 3;

  function clamp(value,min,max) {
    return Math.max(min,Math.min(max,value));
  }

  function clean(value,max) {
    return String(value == null ? '' : value).replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,max || 80);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function randomToken(prefix) {
    var bytes = new Uint32Array(2);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else { bytes[0] = Date.now(); bytes[1] = Math.floor(Math.random() * 0xffffffff); }
    return (prefix || 'M') + bytes[0].toString(36).toUpperCase() + bytes[1].toString(36).toUpperCase();
  }

  function move(id,name,options) {
    var data = {
      id:id,name:name,startup:0.1,active:0.08,recovery:0.2,damage:6,hitstun:0.12,
      baseKnockback:150,growth:2.2,angle:35,hitbox:{x:31,y:-28,w:46,h:38},
      movement:0,resource:0,cancel:['dodge'],animation:'attack_a',effect:'#ffc857',
      projectile:null,armour:0
    };
    Object.keys(options || {}).forEach(function (key) { data[key] = options[key]; });
    data.total = data.startup + data.active + data.recovery;
    return Object.freeze(data);
  }

  function guitarMoves() {
    return Object.freeze({
      neutral:move('guitar-neutral','Quick Chord',{startup:.055,active:.07,recovery:.12,damage:4,baseKnockback:105,growth:1.3,angle:28,hitbox:{x:29,y:-27,w:42,h:34},animation:'attack_a',effect:'#f6e36d'}),
      forward:move('guitar-forward','Bright Riff',{startup:.11,active:.08,recovery:.2,damage:8,baseKnockback:175,growth:2.35,angle:32,hitbox:{x:39,y:-28,w:62,h:40},movement:34,animation:'attack_b',effect:'#ffc857'}),
      up:move('guitar-up','Rising Arpeggio',{startup:.095,active:.1,recovery:.2,damage:7,baseKnockback:160,growth:2.2,angle:82,hitbox:{x:5,y:-60,w:48,h:62},animation:'attack_b',effect:'#9de8ff'}),
      down:move('guitar-down','Low Sweep',{startup:.12,active:.1,recovery:.21,damage:7,baseKnockback:145,growth:2,angle:20,hitbox:{x:34,y:-10,w:66,h:24},animation:'attack_a',effect:'#7df7a1'}),
      dash:move('guitar-dash','Stage Slide',{startup:.075,active:.11,recovery:.24,damage:9,baseKnockback:185,growth:2.4,angle:28,hitbox:{x:39,y:-20,w:66,h:31},movement:115,animation:'attack_b',effect:'#ff8bc8'}),
      neutralAir:move('guitar-neutral-air','Halo Chord',{startup:.065,active:.13,recovery:.16,damage:6,baseKnockback:132,growth:1.8,angle:42,hitbox:{x:0,y:-29,w:76,h:70},animation:'attack_a',effect:'#f6e36d'}),
      forwardAir:move('guitar-forward-air','Air Riff',{startup:.09,active:.1,recovery:.19,damage:8,baseKnockback:165,growth:2.35,angle:34,hitbox:{x:39,y:-31,w:62,h:42},animation:'attack_b',effect:'#ffc857'}),
      backAir:move('guitar-back-air','Backbeat Kick',{startup:.07,active:.07,recovery:.18,damage:9,baseKnockback:188,growth:2.5,angle:37,hitbox:{x:-35,y:-30,w:52,h:38},animation:'attack_a',effect:'#ff8bc8'}),
      upAir:move('guitar-up-air','Sky Harmonic',{startup:.075,active:.09,recovery:.17,damage:7,baseKnockback:150,growth:2.2,angle:88,hitbox:{x:0,y:-64,w:48,h:60},animation:'attack_b',effect:'#9de8ff'}),
      downAir:move('guitar-down-air','Drop D',{startup:.14,active:.11,recovery:.28,damage:10,baseKnockback:190,growth:2.55,angle:285,hitbox:{x:12,y:4,w:44,h:54},animation:'attack_b',effect:'#d77cff'}),
      charge:move('guitar-charge','Power Chord',{startup:.38,active:.12,recovery:.33,damage:16,baseKnockback:245,growth:3.25,angle:35,hitbox:{x:45,y:-31,w:78,h:48},movement:42,animation:'special',effect:'#ff6680'}),
      neutralSpecial:move('guitar-special','Riff Bolt',{startup:.18,active:.04,recovery:.26,damage:6,baseKnockback:128,growth:1.65,angle:30,hitbox:{x:30,y:-30,w:30,h:25},animation:'special',effect:'#62c7ff',projectile:{speed:430,life:1.25,radius:12}}),
      sideSpecial:move('guitar-side-special','Amp Rush',{startup:.13,active:.18,recovery:.3,damage:11,baseKnockback:205,growth:2.65,angle:30,hitbox:{x:38,y:-28,w:68,h:44},movement:220,animation:'special',effect:'#7ce4d1'}),
      recovery:move('guitar-recovery','Encore Rise',{startup:.08,active:.22,recovery:.34,damage:7,baseKnockback:150,growth:1.9,angle:78,hitbox:{x:0,y:-43,w:56,h:74},animation:'special',effect:'#9de8ff',recoveryImpulse:{x:90,y:-520}}),
      ultimate:move('guitar-ultimate','Aurora Headliner',{startup:.42,active:.24,recovery:.48,damage:22,baseKnockback:285,growth:3.8,angle:45,hitbox:{x:0,y:-40,w:190,h:120},animation:'special',effect:'#f6e36d'})
    });
  }

  function bassMoves() {
    return Object.freeze({
      neutral:move('bass-neutral','Low Pluck',{startup:.09,active:.08,recovery:.17,damage:6,baseKnockback:132,growth:1.6,angle:25,hitbox:{x:34,y:-28,w:50,h:38},animation:'attack_a',effect:'#ff9d57'}),
      forward:move('bass-forward','Cabinet Breaker',{startup:.18,active:.11,recovery:.3,damage:12,baseKnockback:225,growth:3.05,angle:31,hitbox:{x:45,y:-29,w:76,h:48},movement:24,animation:'attack_b',effect:'#ff825c',armour:.12}),
      up:move('bass-up','Upright Thunder',{startup:.15,active:.12,recovery:.27,damage:10,baseKnockback:205,growth:2.75,angle:84,hitbox:{x:4,y:-66,w:58,h:70},animation:'attack_b',effect:'#ffc857'}),
      down:move('bass-down','Sub Sweep',{startup:.16,active:.13,recovery:.29,damage:11,baseKnockback:190,growth:2.65,angle:18,hitbox:{x:38,y:-12,w:82,h:28},animation:'attack_a',effect:'#7df7a1'}),
      dash:move('bass-dash','Roadcase Rush',{startup:.12,active:.15,recovery:.32,damage:13,baseKnockback:235,growth:3.15,angle:27,hitbox:{x:43,y:-24,w:76,h:39},movement:145,animation:'attack_b',effect:'#ff9d57',armour:.1}),
      neutralAir:move('bass-neutral-air','Subwoofer Orbit',{startup:.1,active:.16,recovery:.24,damage:9,baseKnockback:168,growth:2.2,angle:44,hitbox:{x:0,y:-31,w:84,h:74},animation:'attack_a',effect:'#ff9d57'}),
      forwardAir:move('bass-forward-air','Air Cabinet',{startup:.14,active:.12,recovery:.27,damage:12,baseKnockback:220,growth:3.05,angle:35,hitbox:{x:44,y:-32,w:72,h:48},animation:'attack_b',effect:'#ff825c'}),
      backAir:move('bass-back-air','Reverse Groove',{startup:.11,active:.1,recovery:.25,damage:12,baseKnockback:218,growth:3,angle:38,hitbox:{x:-39,y:-30,w:60,h:44},animation:'attack_a',effect:'#d77cff'}),
      upAir:move('bass-up-air','Ceiling Rattle',{startup:.12,active:.12,recovery:.25,damage:10,baseKnockback:198,growth:2.7,angle:88,hitbox:{x:0,y:-67,w:58,h:64},animation:'attack_b',effect:'#ffc857'}),
      downAir:move('bass-down-air','Bass Drop',{startup:.19,active:.13,recovery:.36,damage:15,baseKnockback:250,growth:3.3,angle:282,hitbox:{x:8,y:7,w:54,h:58},animation:'special',effect:'#ff6680'}),
      charge:move('bass-charge','Earthshaker',{startup:.52,active:.14,recovery:.42,damage:21,baseKnockback:305,growth:4,angle:33,hitbox:{x:51,y:-33,w:92,h:54},movement:30,animation:'special',effect:'#ff6680',armour:.3}),
      neutralSpecial:move('bass-special','Subwave',{startup:.25,active:.04,recovery:.34,damage:9,baseKnockback:185,growth:2.45,angle:25,hitbox:{x:34,y:-20,w:34,h:24},animation:'special',effect:'#ff9d57',projectile:{speed:310,life:1.5,radius:17,grounded:true}}),
      sideSpecial:move('bass-side-special','Freight Train',{startup:.2,active:.22,recovery:.4,damage:16,baseKnockback:270,growth:3.45,angle:29,hitbox:{x:48,y:-28,w:86,h:48},movement:180,animation:'special',effect:'#ff825c',armour:.2}),
      recovery:move('bass-recovery','Cabinet Lift',{startup:.12,active:.24,recovery:.42,damage:10,baseKnockback:190,growth:2.4,angle:80,hitbox:{x:0,y:-47,w:68,h:80},animation:'special',effect:'#ffc857',recoveryImpulse:{x:65,y:-455},armour:.12}),
      ultimate:move('bass-ultimate','Faultline Finale',{startup:.55,active:.28,recovery:.56,damage:28,baseKnockback:350,growth:4.6,angle:42,hitbox:{x:0,y:-36,w:230,h:110},animation:'special',effect:'#ff9d57',armour:.4})
    });
  }

  var FIGHTERS = Object.freeze({
    guitar:Object.freeze({
      id:'guitar',name:'Guitar Virtuoso',shortName:'GUITAR',sprite:'eems',accent:'#f6e36d',
      description:'Fast pressure, flexible recovery, and precise riff projectiles.',weight:92,
      runSpeed:285,airSpeed:235,acceleration:1900,airAcceleration:980,jumpSpeed:520,gravity:1420,
      maxFall:650,friction:12,guardMax:100,moves:guitarMoves()
    }),
    bass:Object.freeze({
      id:'bass',name:'Bass Breaker',shortName:'BASS',sprite:'bass-player',accent:'#ff9d57',
      description:'Heavy armour, stage control, and enormous launch power.',weight:116,
      runSpeed:238,airSpeed:195,acceleration:1500,airAcceleration:760,jumpSpeed:470,gravity:1500,
      maxFall:690,friction:10,guardMax:118,moves:bassMoves()
    })
  });

  var STAGE = Object.freeze({
    id:'mossvale-amphitheatre',name:'Mossvale Amphitheatre',width:1200,height:560,
    blast:{left:-130,right:1330,top:-190,bottom:650},
    camera:{minX:330,maxX:870,minY:250,maxY:390},
    spawns:[{x:395,y:405},{x:805,y:405},{x:565,y:287},{x:635,y:287}],
    platforms:[
      {x:145,y:420,w:910,h:28,solid:true},
      {x:265,y:317,w:235,h:18,solid:false},
      {x:700,y:317,w:235,h:18,solid:false},
      {x:490,y:235,w:220,h:18,solid:false}
    ]
  });

  var PLANNED_MODES = Object.freeze([
    {id:'stock',name:'Stock Battle',status:'PLAYABLE',description:'Three lives, launch scaling, blast-zone knockouts.'},
    {id:'timed',name:'Timed Battle',status:'FOUNDATION',description:'Score-based rules remain in tuning.'},
    {id:'teams',name:'Duet Clash',status:'FOUNDATION',description:'Team ownership and friendly-fire rules are reserved.'},
    {id:'capture',name:'Capture the Beat',status:'FOUNDATION',description:'Objective routing is not enabled in competitive play.'},
    {id:'king',name:'King of the Stage',status:'FOUNDATION',description:'Control-zone rules are not enabled in competitive play.'},
    {id:'resonance',name:'Resonance Clash',status:'FOUNDATION',description:'Build modifiers require a separate balance pass.'}
  ]);

  function emptyInput() {
    return {x:0,y:0,guard:false,drop:false,action:null,lastActionSeq:0};
  }

  function createFighter(options,index) {
    var definition = FIGHTERS[options.instrument] || FIGHTERS.guitar;
    var spawn = STAGE.spawns[index % STAGE.spawns.length];
    return {
      id:options.id,name:clean(options.name,18) || ('Player ' + (index+1)),ownerId:options.ownerId || options.id,
      instrument:definition.id,definition:definition,colour:options.colour || definition.accent,
      controller:options.controller == null ? null : options.controller,isBot:!!options.isBot,
      x:spawn.x,y:spawn.y,vx:0,vy:0,previousX:spawn.x,previousY:spawn.y,facing:index % 2 ? -1 : 1,
      width:36,height:57,onGround:true,jumps:2,recoveryUsed:false,dropTimer:0,
      damage:0,stocks:STARTING_STOCKS,guard:definition.guardMax,guarding:false,guardStarted:0,
      guardBreak:0,dodge:0,dodgeCooldown:0,invuln:1.8,hitstun:0,respawn:0,
      attack:null,attackCooldown:0,ultimate:0,score:0,knockouts:0,falls:0,lastHitBy:'',
      animationTime:0,input:emptyInput(),lastButtons:{},target:null,
      disconnected:options.disconnected === true,disconnectUntil:0
    };
  }

  function PlatformArena() {
    this.integration = null;
    this.root = null;
    this.canvas = null;
    this.ctx = null;
    this.background = new Image();
    this.background.decoding = 'async';
    this.background.src = 'assets/echo-arena-background.webp';
    this.active = false;
    this.phase = 'lobby';
    this.matchType = '';
    this.matchId = '';
    this.authority = true;
    this.fighters = [];
    this.projectiles = [];
    this.effects = [];
    this.keys = new Set();
    this.touch = {x:0,y:0,guard:false};
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.matchTime = MATCH_SECONDS;
    this.countdown = 0;
    this.freeze = 0;
    this.result = null;
    this.lastMode = 'training';
    this.selectedInstrument = 'guitar';
    this.preferenceLoaded = false;
    this.lobbySelections = new Map();
    this.lobbyReady = new Map();
    this.currentRoom = '';
    this.inputSequence = 0;
    this.pendingNetworkAction = null;
    this.pendingMatchId = '';
    this.lastRoomWelcomeStamp = '';
    this.roomSyncRequestedFor = '';
    this.lastInputSent = 0;
    this.lastSnapshotSent = 0;
    this.lastSnapshotSequence = 0;
    this.lastSnapshotReceived = 0;
    this.snapshotHost = '';
    this.lastDomStatus = 0;
    this.networkInputs = new Map();
    this.camera = {x:600,y:325,zoom:.76,targetX:600,targetY:325,targetZoom:.76};
    this.gamepadAssignments = [];
    this.departureNotified = false;
    this.raf = 0;
    this.boundFrame = this.frame.bind(this);
    this.boundKeyDown = this.keyDown.bind(this);
    this.boundKeyUp = this.keyUp.bind(this);
    window.addEventListener('keydown',this.boundKeyDown,true);
    window.addEventListener('keyup',this.boundKeyUp,true);
    if (window.MossSprites) window.MossSprites.preload(['eems','bass-player','combat-effects']);
  }

  PlatformArena.prototype.network = function () {
    return this.integration && this.integration.network;
  };

  PlatformArena.prototype.isArenaVisible = function () {
    return !!(this.root && this.root.isConnected && this.root.querySelector('.v2-arena-root'));
  };

  PlatformArena.prototype.ensureLoop = function () {
    if (!this.raf) {
      this.lastTime = performance.now();
      this.raf = window.requestAnimationFrame(this.boundFrame);
    }
  };

  PlatformArena.prototype.cancelLoop = function () {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  PlatformArena.prototype.stop = function (reason) {
    this.keys.clear();
    this.touch = {x:0,y:0,guard:false};
    var leavingArena = reason === 'hub-closed' || reason === 'tab-changed';
    if (this.active && this.matchType === 'online' && leavingArena) {
      this.abandonOnlineMatch(reason);
    }
    if (!this.active) {
      this.projectiles.length = 0;
      this.effects.length = 0;
      this.cancelLoop();
      return;
    }
    this.active = false;
    this.phase = leavingArena ? 'lobby' : this.phase;
    this.projectiles.length = 0;
    this.effects.length = 0;
    this.cancelLoop();
  };

  PlatformArena.prototype.abandonOnlineMatch = function (reason) {
    if (!this.active || this.matchType !== 'online' || this.departureNotified) return false;
    var network = this.network();
    if (!network || !network.room) return false;
    this.departureNotified = true;
    var local = this.localFighter();
    var winner = this.fighters.find(function (fighter) {
      return fighter !== local && fighter.stocks > 0 && !fighter.disconnected;
    }) || null;
    if (this.authority) {
      this.finishMatch(winner,'abandoned',false);
    } else {
      // A guest cannot submit the host-only match-end packet. Leaving the room is
      // the relay-authorised forfeit signal; the host resolves the remaining set.
      this.active = false;
      this.phase = 'results';
      this.cancelLoop();
      this.result = {title:'Set left',summary:'Your forfeit was sent to the host safely.',
        winnerName:winner ? winner.name + ' continues' : 'No result recorded',detail:''};
      if (typeof network.leave === 'function') network.leave(reason || 'forfeit');
      this.renderLobby();
    }
    return true;
  };

  PlatformArena.prototype.audio = function (name) {
    var audio = window.MossAudio;
    if (!audio || typeof audio.sfx !== 'function') return;
    try { audio.sfx(name); } catch (error) { /* Main runtime reports audio failures. */ }
  };

  PlatformArena.prototype.ensureLobbyRoom = function () {
    var network = this.network();
    var room = network ? network.room : '';
    if (room === this.currentRoom) return;
    this.currentRoom = room;
    this.lobbySelections.clear();
    this.lobbyReady.clear();
    this.pendingMatchId = '';
    this.roomSyncRequestedFor = '';
    if (!room || !network) return;
    var selfPeer = network.peers.get(network.id);
    if (selfPeer && typeof selfPeer.ready === 'boolean' && FIGHTERS[selfPeer.instrument]) {
      this.selectedInstrument = selfPeer.instrument;
      this.lobbySelections.set(network.id,selfPeer.instrument);
      this.lobbyReady.set(network.id,selfPeer.ready);
    } else {
      this.lobbySelections.set(network.id,this.selectedInstrument);
      this.lobbyReady.set(network.id,false);
      network.send('select-instrument',{instrument:this.selectedInstrument});
      network.send('player-ready',{ready:false,instrument:this.selectedInstrument});
    }
  };

  PlatformArena.prototype.hydrateRoomState = function () {
    var network = this.network();
    var message = network && network.lastRoomWelcome;
    if (!message || message.room !== network.room || !message.payload) return false;
    var match = message.payload.match && typeof message.payload.match === 'object' ? message.payload.match : {};
    var stamp = [message.room,message.ts || 0,message.seq || 0,match.matchId || '',match.phase || ''].join('|');
    if (stamp === this.lastRoomWelcomeStamp) return false;
    this.receiveNetwork(message,network.peers.get(message.from) || null);
    return true;
  };

  PlatformArena.prototype.render = function (root,integration) {
    this.integration = integration || this.integration;
    this.root = root || this.root;
    if (!this.root) return;
    this.ensureLobbyRoom();
    var network = this.network();
    if (network && network.room && network.relayUrl && this.roomSyncRequestedFor !== network.room &&
        typeof network.requestRoomSync === 'function' && network.requestRoomSync()) {
      this.roomSyncRequestedFor = network.room;
    }
    this.hydrateRoomState();
    if (this.active) this.renderMatch();
    else this.renderLobby();
  };

  PlatformArena.prototype.renderLobby = function () {
    var self = this;
    var network = this.network();
    var current = this.integration && this.integration.snapshot ? this.integration.snapshot() : null;
    if (!this.preferenceLoaded && current && current.state.pvpV2 && FIGHTERS[current.state.pvpV2.preferredInstrument]) {
      this.selectedInstrument = current.state.pvpV2.preferredInstrument;
      this.preferenceLoaded = true;
    }
    var profile = current && current.state.onlineProfile || {rating:1000};
    var pvp = current && current.state.pvpV2 || {matches:0,wins:0,losses:0,knockouts:0};
    var inRoom = !!(network && network.room);
    var peers = inRoom ? Array.from(network.peers.values()) : [];
    var allReady = inRoom && peers.length >= 2 && peers.every(function (peer) {
      return self.lobbyReady.get(peer.id) === true;
    });
    var isHost = inRoom && network.host === network.id;
    var resultHtml = this.result ?
      '<section class="arena-v2-results-card"><p class="panel-kicker">LAST SET</p><h4>' +
      escapeHtml(this.result.title) + '</h4><p>' + escapeHtml(this.result.summary) + '</p>' +
      '<div><strong>' + escapeHtml(this.result.winnerName || 'No winner') + '</strong><span>' +
      escapeHtml(this.result.detail || '') + '</span></div></section>' : '';
    this.root.innerHTML = '<div class="v2-arena-root">' +
      '<div class="production-section-heading arena-v2-heading"><div><p class="panel-kicker">VERSION 2.0 · ORIGINAL PLATFORM FIGHTER</p>' +
      '<h3>Echo Arena: Mossvale Amphitheatre</h3><p>Fixed-step platform combat with launch scaling, three stocks, recovery, guard timing, local play, bots, and private-room host authority.</p></div>' +
      '<div class="arena-rating"><strong>' + Math.floor(profile.rating || 1000) + '</strong><span>legacy casual rating · ' +
      Math.floor(pvp.matches || 0) + ' V2 sets</span></div></div>' +
      resultHtml +
      '<section class="arena-v2-fighters" aria-labelledby="fighterSelectTitle"><div><p class="panel-kicker">COMPLETE STARTER IDENTITIES</p><h4 id="fighterSelectTitle">Choose an instrument fighter</h4></div>' +
      Object.keys(FIGHTERS).map(function (id) {
        var fighter = FIGHTERS[id];
        return '<button type="button" data-v2-fighter="' + id + '" class="arena-v2-fighter ' +
          (self.selectedInstrument === id ? 'active' : '') + '" style="--fighter-accent:' + fighter.accent + '">' +
          '<span class="arena-v2-fighter-portrait ' + id + '" aria-hidden="true"></span><span><strong>' +
          escapeHtml(fighter.name) + '</strong><small>' + escapeHtml(fighter.description) + '</small></span></button>';
      }).join('') + '</section>' +
      '<section class="arena-v2-modes"><p class="panel-kicker">RULESET STATUS</p><div>' +
      PLANNED_MODES.map(function (mode) {
        return '<article class="' + (mode.status === 'PLAYABLE' ? 'playable' : 'planned') + '"><strong>' +
          escapeHtml(mode.name) + '</strong><span>' + mode.status + '</span><small>' + escapeHtml(mode.description) + '</small></article>';
      }).join('') + '</div></section>' +
      '<div class="arena-v2-launch-grid"><section><p class="panel-kicker">OFFLINE</p><h4>Same-device set</h4>' +
      '<p>Keyboard versus a fair recovery-aware rival, or two local players using split keyboard / an attached controller.</p>' +
      '<div class="arena-v2-button-row"><button id="v2Training" class="game-button button-secondary" type="button">Training rival</button>' +
      '<button id="v2Local" class="game-button button-primary" type="button">Local versus</button></div>' +
      '<small class="arena-v2-device-status">' + this.gamepadStatus() + '</small></section>' +
      '<section><p class="panel-kicker">PRIVATE ONLINE</p><h4>' + (inRoom ? 'Room ' + escapeHtml(network.room) : 'Join through Echo Network') + '</h4>' +
      (inRoom ? '<div class="arena-v2-lobby-list">' + peers.map(function (peer,index) {
        var selected = self.lobbySelections.get(peer.id) || (peer.id === network.id ? self.selectedInstrument : 'guitar');
        return '<div><i style="--player-colour:' + self.playerColour(index) + '"></i><span><strong>' +
          escapeHtml((peer.profile || {}).displayName || (peer.id === network.id ? 'You' : 'Guest')) + '</strong><small>' +
          escapeHtml((FIGHTERS[selected] || FIGHTERS.guitar).shortName) + (peer.id === network.host ? ' · HOST' : '') +
          '</small></span><b class="' + (self.lobbyReady.get(peer.id) ? 'ready' : '') + '">' +
          (self.lobbyReady.get(peer.id) ? 'READY' : 'TUNING') + '</b></div>';
      }).join('') + '</div><div class="arena-v2-button-row"><button id="v2Ready" class="game-button button-secondary" type="button">' +
      (this.lobbyReady.get(network.id) ? 'Unready' : 'Ready up') + '</button><button id="v2OnlineStart" class="game-button button-primary" type="button"' +
      (!isHost || !allReady || this.pendingMatchId ? ' disabled' : '') + '>' +
      (this.pendingMatchId ? 'Waiting for relay...' : (isHost ? 'Start stock battle' : 'Host starts match')) + '</button></div>' :
      '<p>Create or join a six-character room in the Online tab. Private local rooms work between same-origin tabs; internet rooms require the relay.</p>' +
      '<button id="v2OpenOnline" class="game-button button-secondary" type="button">Open Online tab</button>') + '</section></div>' +
      '<section class="arena-v2-stage-preview"><div><p class="panel-kicker">POLISHED STARTER STAGE</p><h4>Mossvale Amphitheatre</h4>' +
      '<p>Three drop-through platforms, stable spawn points, wide recovery lanes, camera-safe blast boundaries, and a hazard-free competitive layout.</p></div>' +
      '<div class="arena-v2-stage-thumb" role="img" aria-label="Mossvale Amphitheatre stage preview"></div></section>' +
      '<p class="arena-legal">Stock Battle and Guitar/Bass are the completed V2 competitive slice. Other modes are displayed as foundations—not falsely advertised as finished. Online matches use the production relay and remain casual under host authority.</p>' +
      '</div>';

    Array.prototype.forEach.call(this.root.querySelectorAll('[data-v2-fighter]'),function (button) {
      button.addEventListener('click',function () {
        self.selectedInstrument = button.dataset.v2Fighter;
        if (network && network.room) {
          self.lobbySelections.set(network.id,self.selectedInstrument);
          self.lobbyReady.set(network.id,false);
          network.send('select-instrument',{instrument:self.selectedInstrument});
          network.send('player-ready',{ready:false});
        }
        if (window.__HIGH_NOTES__ && window.__HIGH_NOTES__.production && window.__HIGH_NOTES__.production.updatePvpV2) {
          window.__HIGH_NOTES__.production.updatePvpV2({preferredInstrument:self.selectedInstrument});
        }
        self.renderLobby();
      });
    });
    var training = document.getElementById('v2Training');
    if (training) training.addEventListener('click',function () { self.startOffline('training'); });
    var local = document.getElementById('v2Local');
    if (local) local.addEventListener('click',function () { self.startOffline('local'); });
    var ready = document.getElementById('v2Ready');
    if (ready) ready.addEventListener('click',function () {
      var value = !self.lobbyReady.get(network.id);
      self.lobbyReady.set(network.id,value);
      network.send('player-ready',{ready:value,instrument:self.selectedInstrument});
      self.renderLobby();
    });
    var start = document.getElementById('v2OnlineStart');
    if (start) start.addEventListener('click',function () { self.startOnlineAsHost(); });
    var openOnline = document.getElementById('v2OpenOnline');
    if (openOnline) openOnline.addEventListener('click',function () {
      var tab = document.querySelector('[data-production-tab="online"]');
      if (tab) tab.click();
    });
  };

  PlatformArena.prototype.playerColour = function (index) {
    return ['#7df7a1','#ff9d57','#9de8ff','#d77cff'][index % 4];
  };

  PlatformArena.prototype.gamepadStatus = function () {
    var pads = navigator.getGamepads ? Array.prototype.filter.call(navigator.getGamepads(),Boolean) : [];
    if (!pads.length) return 'P1: WASD · P2: arrows / numpad. Connect a controller for automatic P2 ownership.';
    return pads.length + ' controller' + (pads.length === 1 ? '' : 's') + ' detected · each pad owns one fighter.';
  };

  PlatformArena.prototype.startOffline = function (type) {
    var current = this.integration && this.integration.snapshot ? this.integration.snapshot() : null;
    var name = current && current.state.onlineProfile && current.state.onlineProfile.displayName || 'Mossvale Player';
    var pads = navigator.getGamepads ? Array.prototype.filter.call(navigator.getGamepads(),Boolean) : [];
    var opponentInstrument = this.selectedInstrument === 'guitar' ? 'bass' : 'guitar';
    var players = [
      {id:'local-p1',ownerId:'local-p1',name:name,instrument:this.selectedInstrument,colour:this.playerColour(0),controller:null},
      {id:type === 'training' ? 'training-bot' : 'local-p2',ownerId:type === 'training' ? 'bot' : 'local-p2',
        name:type === 'training' ? 'Echo Rival' : (pads.length ? 'Controller 1' : 'Player 2'),instrument:opponentInstrument,
        colour:this.playerColour(1),controller:type === 'training' ? null : (pads.length ? pads[0].index : 'keyboard2'),isBot:type === 'training'}
    ];
    this.lastMode = type;
    this.beginMatch(players,{type:type,authority:true,matchId:randomToken('L'),startDelay:1.35});
  };

  PlatformArena.prototype.startOnlineAsHost = function () {
    var network = this.network();
    if (!network || !network.room || network.host !== network.id || network.peers.size < 2) return false;
    if (network.relayUrl && (network.socketStatus !== 'connected' || !network.socket ||
        network.socket.readyState !== WebSocket.OPEN)) {
      this.pendingMatchId = '';
      this.result = {title:'Relay connection required',summary:'The secure room is reconnecting.',
        winnerName:'No match started',detail:'Wait for WSS CONNECTED, then try again.'};
      this.renderLobby();
      return false;
    }
    var self = this;
    var peerIds = Array.from(network.peers.keys()).sort(function (a,b) {
      if (a === network.host) return -1;
      if (b === network.host) return 1;
      return a.localeCompare(b);
    }).slice(0,4);
    if (!peerIds.every(function (id) { return self.lobbyReady.get(id) === true; })) return false;
    var payload = {
      matchId:randomToken('N'),mode:'stock',stage:STAGE.id,stocks:STARTING_STOCKS,
      duration:MATCH_SECONDS,startAt:Date.now()+1450,
      players:peerIds.map(function (id,index) {
        var peer = network.peers.get(id) || {};
        return {id:id,name:clean((peer.profile || {}).displayName || (id === network.id ? 'Host' : 'Guest'),18),
          instrument:self.lobbySelections.get(id) || 'guitar',colour:self.playerColour(index)};
      })
    };
    if (network.relayUrl) this.pendingMatchId = payload.matchId;
    var delivered = network.send('match-start',payload);
    if (network.relayUrl) {
      if (!delivered) {
        this.pendingMatchId = '';
        this.result = {title:'Relay connection changed',summary:'The start packet was not sent.',
          winnerName:'No match started',detail:'Reconnect the room and try again.'};
        this.renderLobby();
        return false;
      }
      // The relay echoes accepted host commands. Waiting for that echo keeps
      // every client out of a match when roster or readiness validation fails.
      this.renderLobby();
      var self = this;
      var expectedMatchId = payload.matchId;
      window.setTimeout(function () {
        if (self.pendingMatchId !== expectedMatchId || self.active) return;
        self.pendingMatchId = '';
        self.result = {title:'Relay start timed out',summary:'No approval arrived for that roster.',
          winnerName:'No match started',detail:'Check the room connection and ready state, then retry.'};
        if (self.isArenaVisible()) self.renderLobby();
      },Number(SHARED_NETWORK_CONFIG.connectionTimeoutMs) || 10000);
    } else {
      if (!delivered) return false;
      this.startNetworkMatch(payload);
    }
    return true;
  };

  PlatformArena.prototype.startNetworkMatch = function (payload) {
    var network = this.network();
    if (!network || !payload || clean(payload.stage,40) !== STAGE.id || clean(payload.mode,20) !== 'stock') return false;
    var seen = new Set();
    var players = (Array.isArray(payload.players) ? payload.players : []).slice(0,4).filter(function (item) {
      var id = clean(item && item.id,24);
      if (!/^[A-Z0-9]{12}$/.test(id) || seen.has(id) || !network.peers.has(id)) return false;
      seen.add(id); return true;
    }).map(function (item,index) {
      var id = clean(item.id,24);
      var peer = network.peers.get(id) || {};
      return {id:'net-' + id,ownerId:id,name:clean((peer.profile || {}).displayName || item.name,18),
        instrument:FIGHTERS[item.instrument] ? item.instrument : 'guitar',
        colour:/^#[0-9a-f]{6}$/i.test(item.colour || '') ? item.colour : ['#7df7a1','#ff9d57','#9de8ff','#d77cff'][index],
        disconnected:item.connected === false || peer.connected === false};
    });
    if (players.length < 2 || !seen.has(network.id)) return false;
    this.lastMode = 'online';
    var restored = payload.rehydrated === true;
    var startsIn = (Number(payload.startAt)-Date.now())/1000;
    this.beginMatch(players,{type:'online',authority:network.host === network.id,
      matchId:clean(payload.matchId,48),
      phase:restored && startsIn <= 0 ? 'playing' : 'countdown',
      matchTime:restored ? clamp(Number(payload.remainingMs)/1000,0,MATCH_SECONDS) : MATCH_SECONDS,
      startDelay:restored ? clamp(startsIn,.05,2.4) : clamp(startsIn,.45,2.4)});
    return true;
  };

  PlatformArena.prototype.beginMatch = function (players,options) {
    options = options || {};
    this.active = true;
    this.phase = options.phase === 'playing' ? 'playing' : 'countdown';
    this.matchType = options.type || 'training';
    this.matchId = options.matchId || randomToken('M');
    this.pendingMatchId = '';
    this.authority = options.authority !== false;
    this.fighters = players.map(createFighter);
    this.projectiles.length = 0;
    this.effects.length = 0;
    this.networkInputs.clear();
    this.matchTime = options.matchTime == null ? MATCH_SECONDS : clamp(Number(options.matchTime),0,MATCH_SECONDS);
    this.countdown = this.phase === 'playing' ? 0 : (Number(options.startDelay) || 1.2);
    this.freeze = 0;
    this.result = null;
    this.departureNotified = false;
    this.accumulator = 0;
    this.lastSnapshotSequence = 0;
    this.lastSnapshotReceived = 0;
    this.snapshotHost = '';
    this.camera = {x:600,y:325,zoom:.76,targetX:600,targetY:325,targetZoom:.76};
    this.keys.clear();
    this.touch = {x:0,y:0,guard:false};
    this.renderMatch();
    this.ensureLoop();
    this.audio('unlock');
  };

  PlatformArena.prototype.renderMatch = function () {
    if (!this.root) return;
    var self = this;
    var networkCopy = this.matchType === 'online' ? 'Private room · host-authoritative casual simulation' :
      this.matchType === 'local' ? 'Same-device versus · independent input ownership' : 'Offline training · recovery-aware rival';
    this.root.innerHTML = '<div class="v2-arena-root arena-v2-match-root">' +
      '<div class="arena-v2-match-bar"><div><p class="panel-kicker">STOCK BATTLE · ' + escapeHtml(networkCopy) + '</p>' +
      '<h3>Mossvale Amphitheatre</h3></div><div><span id="v2NetHealth" class="arena-v2-net-health">' +
      (this.matchType === 'online' ? (this.authority ? 'HOST AUTHORITY' : 'CLIENT PREDICTION') : '60 HZ FIXED STEP') +
      '</span><button id="v2LeaveMatch" class="game-button button-danger" type="button">Leave set</button></div></div>' +
      '<section class="arena-stage arena-v2-canvas-wrap"><canvas id="echoArenaCanvas" width="900" height="500" tabindex="0" ' +
      'aria-label="Mossvale Amphitheatre platform fighter match"></canvas>' +
      '<div class="arena-v2-controls" aria-label="Touch fighter controls"><div class="arena-v2-dpad">' +
      '<button type="button" data-v2-hold="left" aria-label="Move left">◀</button>' +
      '<button type="button" data-v2-action="jump" aria-label="Jump">▲</button>' +
      '<button type="button" data-v2-hold="down" aria-label="Fast fall or drop through platform">▼</button>' +
      '<button type="button" data-v2-hold="right" aria-label="Move right">▶</button></div>' +
      '<div class="arena-v2-actions"><button type="button" data-v2-action="dodge">DODGE</button>' +
      '<button type="button" data-v2-hold="guard">GUARD</button><button type="button" data-v2-action="special">SPECIAL</button>' +
      '<button type="button" data-v2-action="attack" class="primary">STRIKE</button>' +
      '<button type="button" data-v2-action="charge">CHARGE</button><button type="button" data-v2-action="recovery">RECOVER</button>' +
      '<button type="button" data-v2-action="ultimate">ULT</button></div></div></section>' +
      '<div class="arena-v2-help"><span>P1: A/D move · W jump · S fall · J strike · K special · L guard · Shift dodge · U charge · O ultimate</span>' +
      '<span>P2: arrows · Numpad 1/2/3 · Right Ctrl guard · Numpad 0 dodge</span></div>' +
      '<p id="v2ArenaAnnouncement" class="sr-only" aria-live="assertive"></p></div>';
    this.canvas = document.getElementById('echoArenaCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    var leave = document.getElementById('v2LeaveMatch');
    if (leave) leave.addEventListener('click',function () {
      if (self.matchType === 'online' && self.abandonOnlineMatch('forfeit')) return;
      self.active = false;
      self.cancelLoop();
      self.result = {title:'Set left',summary:'The performers returned to the lobby safely.',winnerName:'No result recorded',detail:''};
      self.renderLobby();
    });
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-v2-action]'),function (button) {
      button.addEventListener('pointerdown',function (event) {
        event.preventDefault();
        self.queueLocalAction(button.dataset.v2Action);
      });
    });
    Array.prototype.forEach.call(this.root.querySelectorAll('[data-v2-hold]'),function (button) {
      var code = 'Touch' + button.dataset.v2Hold.charAt(0).toUpperCase() + button.dataset.v2Hold.slice(1);
      function down(event) {
        event.preventDefault();
        self.keys.add(code);
        if (button.setPointerCapture && event.pointerId != null) {
          try { button.setPointerCapture(event.pointerId); } catch (error) {}
        }
      }
      function up(event) { event.preventDefault(); self.keys.delete(code); }
      button.addEventListener('pointerdown',down);
      button.addEventListener('pointerup',up);
      button.addEventListener('pointercancel',up);
      button.addEventListener('lostpointercapture',up);
    });
    if (this.canvas) {
      this.canvas.addEventListener('contextmenu',function (event) { event.preventDefault(); });
      this.canvas.focus({preventScroll:true});
    }
  };

  PlatformArena.prototype.localFighter = function () {
    var network = this.network();
    if (this.matchType === 'online' && network) {
      return this.fighters.find(function (fighter) { return fighter.ownerId === network.id; }) || null;
    }
    return this.fighters.find(function (fighter) { return fighter.ownerId === 'local-p1'; }) || this.fighters[0] || null;
  };

  PlatformArena.prototype.directionForFighter = function (fighter,secondKeyboard) {
    var x = 0;
    var y = 0;
    if (secondKeyboard) {
      x = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
      y = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
    } else {
      x = (this.keys.has('KeyD') || this.keys.has('TouchRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('TouchLeft') ? 1 : 0);
      y = (this.keys.has('KeyS') || this.keys.has('TouchDown') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    }
    return {x:x,y:y};
  };

  PlatformArena.prototype.keyDown = function (event) {
    if (!this.active || !this.isArenaVisible()) return;
    var target = event.target;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    var code = event.code;
    var relevant = ['KeyA','KeyD','KeyW','KeyS','KeyJ','KeyK','KeyL','KeyU','KeyO','Space','ShiftLeft','ShiftRight',
      'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Numpad1','Numpad2','Numpad3','Numpad0','NumpadEnter','ControlRight','Escape'];
    if (relevant.indexOf(code) < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.keys.add(code);
    if (event.repeat) return;
    if (code === 'Escape') {
      if (this.matchType === 'online' && this.abandonOnlineMatch('escape')) return;
      this.stop('escape');
      this.result = {title:'Set paused out',summary:'No progression was changed.',winnerName:'Returned to lobby',detail:''};
      this.renderLobby(); return;
    }
    if (code === 'KeyW') this.queueLocalAction('jump');
    else if (code === 'KeyJ' || code === 'Space') this.queueLocalAction('attack');
    else if (code === 'KeyK') this.queueLocalAction('special');
    else if (code === 'KeyU') this.queueLocalAction('charge');
    else if (code === 'KeyO') this.queueLocalAction('ultimate');
    else if (code === 'ShiftLeft' || code === 'ShiftRight') this.queueLocalAction('dodge');
    else if (code === 'ArrowUp') this.queueSecondAction('jump');
    else if (code === 'Numpad1') this.queueSecondAction('attack');
    else if (code === 'Numpad2') this.queueSecondAction('special');
    else if (code === 'Numpad3') this.queueSecondAction('charge');
    else if (code === 'NumpadEnter') this.queueSecondAction('ultimate');
    else if (code === 'Numpad0') this.queueSecondAction('dodge');
  };

  PlatformArena.prototype.keyUp = function (event) {
    this.keys.delete(event.code);
  };

  PlatformArena.prototype.queueLocalAction = function (type) {
    var fighter = this.localFighter();
    if (!fighter || this.phase !== 'playing') return;
    var direction = this.directionForFighter(fighter,false);
    if (type === 'recovery') {
      type = 'special';
      direction = {x:0,y:-1};
    }
    this.queueFighterAction(fighter,type,direction,true);
  };

  PlatformArena.prototype.queueSecondAction = function (type) {
    if (this.matchType !== 'local' || this.phase !== 'playing') return;
    var fighter = this.fighters.find(function (item) { return item.ownerId === 'local-p2'; });
    if (!fighter || fighter.controller !== 'keyboard2') return;
    this.queueFighterAction(fighter,type,this.directionForFighter(fighter,true),false);
  };

  PlatformArena.prototype.queueFighterAction = function (fighter,type,direction,networked) {
    if (!fighter || fighter.stocks <= 0 || fighter.respawn > 0) return false;
    var defensive = type === 'dodge' || type === 'guard';
    var canAct = fighter.hitstun <= 0 && fighter.guardBreak <= 0 && (!fighter.attack || defensive && fighter.attack.t < .08);
    if (!canAct) {
      fighter.actionBuffer = {type:type,direction:direction || {x:0,y:0},life:defensive ? .19 : .14,networked:networked};
      return false;
    }
    if (networked && this.matchType === 'online') {
      this.inputSequence++;
      this.pendingNetworkAction = {seq:this.inputSequence,type:type,x:clamp(Number(direction.x)||0,-1,1),
        y:clamp(Number(direction.y)||0,-1,1),sentAt:performance.now()};
    }
    return this.performAction(fighter,type,direction || {x:0,y:0});
  };

  PlatformArena.prototype.performAction = function (fighter,type,direction) {
    if (type === 'jump') return this.jump(fighter);
    if (type === 'dodge') return this.dodge(fighter,direction);
    if (type === 'ultimate' && fighter.ultimate < 100) return false;
    if (fighter.attack || fighter.hitstun > 0 || fighter.guardBreak > 0 || fighter.attackCooldown > 0) return false;
    var moves = fighter.definition.moves;
    var airborne = !fighter.onGround;
    var moveData;
    if (type === 'special') {
      if (direction.y < -.45 && airborne && !fighter.recoveryUsed) moveData = moves.recovery;
      else if (Math.abs(direction.x) > .35) moveData = moves.sideSpecial;
      else moveData = moves.neutralSpecial;
    } else if (type === 'charge') moveData = moves.charge;
    else if (type === 'ultimate') moveData = moves.ultimate;
    else if (airborne) {
      if (direction.y < -.45) moveData = moves.upAir;
      else if (direction.y > .45) moveData = moves.downAir;
      else if (Math.abs(direction.x) < .3) moveData = moves.neutralAir;
      else if (Math.sign(direction.x) !== fighter.facing) moveData = moves.backAir;
      else moveData = moves.forwardAir;
    } else if (Math.abs(fighter.vx) > fighter.definition.runSpeed * .72 && Math.abs(direction.x) > .35) moveData = moves.dash;
    else if (direction.y < -.45) moveData = moves.up;
    else if (direction.y > .45) moveData = moves.down;
    else if (Math.abs(direction.x) > .35) moveData = moves.forward;
    else moveData = moves.neutral;
    if (!moveData) return false;
    fighter.guarding = false;
    fighter.attack = {move:moveData,t:0,hit:new Set(),spawned:false};
    fighter.attackCooldown = moveData.total;
    fighter.animationTime = 0;
    if (type === 'ultimate') fighter.ultimate = 0;
    if (moveData.recoveryImpulse) {
      fighter.recoveryUsed = true;
      fighter.vx = fighter.facing * moveData.recoveryImpulse.x;
      fighter.vy = moveData.recoveryImpulse.y;
      fighter.onGround = false;
    } else if (moveData.movement) {
      fighter.vx += fighter.facing * moveData.movement;
    }
    this.audio(type === 'special' || type === 'ultimate' ? 'pulse' : 'attack');
    return true;
  };

  PlatformArena.prototype.jump = function (fighter) {
    if (fighter.attack || fighter.hitstun > 0 || fighter.guardBreak > 0 || fighter.respawn > 0) return false;
    if (fighter.onGround) fighter.jumps = 2;
    if (!fighter.onGround && fighter.jumps <= 0) return false;
    fighter.onGround = false;
    fighter.jumps--;
    fighter.vy = -fighter.definition.jumpSpeed * (fighter.jumps === 0 ? .94 : 1);
    fighter.y -= 2;
    fighter.guarding = false;
    this.addEffect(fighter.x,fighter.y,'jump',fighter.colour,14);
    return true;
  };

  PlatformArena.prototype.dodge = function (fighter,direction) {
    if (fighter.dodgeCooldown > 0 || fighter.hitstun > 0 || fighter.guardBreak > 0 || fighter.respawn > 0) return false;
    fighter.attack = null;
    fighter.guarding = false;
    fighter.dodge = fighter.onGround ? .27 : .34;
    fighter.invuln = Math.max(fighter.invuln,fighter.onGround ? .2 : .25);
    fighter.dodgeCooldown = fighter.onGround ? .62 : .82;
    var dx = Math.abs(direction.x) > .2 ? direction.x : fighter.facing;
    fighter.vx = dx * (fighter.onGround ? 390 : 310);
    if (!fighter.onGround) fighter.vy *= .32;
    this.addEffect(fighter.x,fighter.y,'dodge',fighter.colour,20);
    return true;
  };

  PlatformArena.prototype.frame = function (time) {
    this.raf = 0;
    if (!this.active) return;
    var elapsed = clamp((time-this.lastTime)/1000,0,MAX_FRAME);
    this.lastTime = time;
    this.accumulator = Math.min(this.accumulator + elapsed,FIXED_STEP * 4);
    var iterations = 0;
    while (this.accumulator >= FIXED_STEP && iterations < 4) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      iterations++;
    }
    this.draw();
    if (this.active) this.raf = window.requestAnimationFrame(this.boundFrame);
  };

  PlatformArena.prototype.step = function (dt) {
    var network = this.network();
    if (this.matchType === 'online' && network) {
      var becameAuthority = network.host === network.id;
      if (becameAuthority !== this.authority) {
        this.authority = becameAuthority;
        this.addEffect(600,190,'host', '#9de8ff',30);
      }
    }
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0,this.countdown-dt);
      this.updateCamera(dt);
      this.updateEffects(dt);
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.announce('Perform!');
      }
      return;
    }
    if (this.phase !== 'playing') return;
    if (this.freeze > 0) {
      this.freeze = Math.max(0,this.freeze-dt);
      this.updateEffects(dt*.25);
      return;
    }
    this.matchTime = Math.max(0,this.matchTime-dt);
    this.updateInputSources(dt);
    var self = this;
    this.fighters.forEach(function (fighter) {
      if (fighter.disconnected) {
        fighter.input = emptyInput();
        fighter.vx = 0;
        fighter.vy = 0;
        fighter.attack = null;
        fighter.guarding = false;
        return;
      }
      var simulate = self.matchType !== 'online' || self.authority || (self.network() && fighter.ownerId === self.network().id);
      if (simulate) self.updateFighter(fighter,dt);
      else self.updateRemoteVisual(fighter,dt);
    });
    if (this.matchType !== 'online' || this.authority) this.resolveFighterSeparation();
    if (this.matchType !== 'online' || this.authority) {
      this.updateProjectiles(dt);
      this.resolveMatchState();
    } else {
      this.interpolateProjectiles(dt);
    }
    this.updateEffects(dt);
    this.updateCamera(dt);
    if (this.matchType === 'online') this.networkTick();
    if (this.matchTime <= 0 && (this.matchType !== 'online' || this.authority)) this.finishByTime();
  };

  PlatformArena.prototype.updateInputSources = function (dt) {
    var network = this.network();
    var self = this;
    this.fighters.forEach(function (fighter,index) {
      if (fighter.isBot) {
        self.updateBotInput(fighter,dt);
        return;
      }
      if (self.matchType === 'online') {
        if (network && fighter.ownerId === network.id) {
          var localDirection = self.directionForFighter(fighter,false);
          fighter.input.x = localDirection.x;
          fighter.input.y = localDirection.y;
          fighter.input.guard = self.keys.has('KeyL') || self.keys.has('TouchGuard');
          fighter.input.drop = localDirection.y > .5;
        } else if (self.authority) {
          var remoteInput = self.networkInputs.get(fighter.ownerId);
          if (remoteInput) fighter.input = remoteInput;
          else fighter.input = emptyInput();
        }
        return;
      }
      if (fighter.controller != null && fighter.controller !== 'keyboard2') {
        self.pollGamepad(fighter,index);
      } else {
        var second = fighter.controller === 'keyboard2';
        var direction = self.directionForFighter(fighter,second);
        fighter.input.x = direction.x;
        fighter.input.y = direction.y;
        fighter.input.guard = second ? self.keys.has('ControlRight') :
          (self.keys.has('KeyL') || self.keys.has('TouchGuard'));
        fighter.input.drop = direction.y > .5;
      }
    });
  };

  PlatformArena.prototype.pollGamepad = function (fighter,index) {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var pad = pads && pads[fighter.controller];
    if (!pad) {
      fighter.input.x = 0; fighter.input.y = 0; fighter.input.guard = false;
      return;
    }
    var x = Math.abs(pad.axes[0] || 0) > .2 ? pad.axes[0] : 0;
    var y = Math.abs(pad.axes[1] || 0) > .24 ? pad.axes[1] : 0;
    if (pad.buttons[14] && pad.buttons[14].pressed) x = -1;
    if (pad.buttons[15] && pad.buttons[15].pressed) x = 1;
    if (pad.buttons[12] && pad.buttons[12].pressed) y = -1;
    if (pad.buttons[13] && pad.buttons[13].pressed) y = 1;
    fighter.input.x = clamp(x,-1,1);
    fighter.input.y = clamp(y,-1,1);
    fighter.input.guard = !!((pad.buttons[4] && pad.buttons[4].pressed) || (pad.buttons[5] && pad.buttons[5].pressed));
    fighter.input.drop = y > .5;
    var actions = [{button:0,type:'attack'},{button:1,type:'dodge'},{button:2,type:'special'},
      {button:3,type:'charge'},{button:9,type:'ultimate'},{button:12,type:'jump'}];
    var self = this;
    actions.forEach(function (binding) {
      var pressed = !!(pad.buttons[binding.button] && pad.buttons[binding.button].pressed);
      if (pressed && !fighter.lastButtons[binding.button]) {
        self.queueFighterAction(fighter,binding.type,{x:fighter.input.x,y:fighter.input.y},false);
      }
      fighter.lastButtons[binding.button] = pressed;
    });
  };

  PlatformArena.prototype.updateBotInput = function (fighter,dt) {
    fighter.aiThink = Math.max(0,(fighter.aiThink || 0)-dt);
    var opponents = this.fighters.filter(function (item) { return item !== fighter && item.stocks > 0 && item.respawn <= 0; });
    if (!opponents.length) { fighter.input = emptyInput(); return; }
    opponents.sort(function (a,b) { return Math.abs(a.x-fighter.x)-Math.abs(b.x-fighter.x); });
    var target = opponents[0];
    fighter.target = target;
    var dx = target.x-fighter.x;
    var dy = target.y-fighter.y;
    var offstage = fighter.x < 130 || fighter.x > 1070 || fighter.y > 455;
    fighter.input.x = offstage ? (fighter.x < 600 ? 1 : -1) : clamp(dx/120,-1,1);
    fighter.input.y = dy < -75 ? -1 : dy > 70 ? 1 : 0;
    fighter.input.guard = false;
    fighter.input.drop = dy > 70;
    if (fighter.aiThink > 0 || fighter.hitstun > 0 || fighter.respawn > 0) return;
    fighter.aiThink = .5 + Math.random()*.35;
    if (offstage && !fighter.onGround) {
      if (fighter.vy > 70 && !fighter.recoveryUsed) this.queueFighterAction(fighter,'special',{x:fighter.input.x,y:-1},false);
      else if (fighter.jumps > 0) this.queueFighterAction(fighter,'jump',{x:fighter.input.x,y:-1},false);
      return;
    }
    var distance = Math.abs(dx);
    if (target.attack && distance < 100 && Math.random() < .42) {
      if (Math.random() < .55) this.queueFighterAction(fighter,'dodge',{x:-Math.sign(dx),y:0},false);
      else { fighter.input.guard = true; fighter.aiThink = .28; }
    } else if (dy < -90 && fighter.jumps > 0 && Math.random() < .55) {
      this.queueFighterAction(fighter,'jump',{x:fighter.input.x,y:-1},false);
    } else if (distance < 82) {
      if (Math.random() < .55) {
        var choice = fighter.ultimate >= 100 && Math.random() < .18 ? 'ultimate' : Math.random() < .15 ? 'charge' : Math.random() < .24 ? 'special' : 'attack';
        this.queueFighterAction(fighter,choice,{x:Math.sign(dx),y:dy < -35 ? -1 : dy > 35 ? 1 : 0},false);
        fighter.aiThink += .22;
      } else {
        fighter.input.x = -Math.sign(dx);
        fighter.aiThink += .16;
      }
    } else if (distance < 250 && Math.random() < .24) {
      this.queueFighterAction(fighter,'special',{x:Math.sign(dx),y:0},false);
    }
  };

  PlatformArena.prototype.updateFighter = function (fighter,dt) {
    fighter.previousX = fighter.x;
    fighter.previousY = fighter.y;
    fighter.animationTime += dt;
    fighter.invuln = Math.max(0,fighter.invuln-dt);
    fighter.dodge = Math.max(0,fighter.dodge-dt);
    fighter.dodgeCooldown = Math.max(0,fighter.dodgeCooldown-dt);
    fighter.attackCooldown = Math.max(0,fighter.attackCooldown-dt);
    fighter.hitstun = Math.max(0,fighter.hitstun-dt);
    fighter.guardBreak = Math.max(0,fighter.guardBreak-dt);
    fighter.dropTimer = Math.max(0,fighter.dropTimer-dt);
    if (fighter.actionBuffer) {
      fighter.actionBuffer.life -= dt;
      if (fighter.actionBuffer.life <= 0) fighter.actionBuffer = null;
      else if (fighter.hitstun <= 0 && fighter.guardBreak <= 0 && !fighter.attack) {
        var buffered = fighter.actionBuffer;
        fighter.actionBuffer = null;
        this.queueFighterAction(fighter,buffered.type,buffered.direction,buffered.networked);
      }
    }
    if (fighter.stocks <= 0) return;
    if (fighter.respawn > 0) {
      fighter.respawn = Math.max(0,fighter.respawn-dt);
      if (fighter.respawn <= 0) this.respawnFighter(fighter);
      return;
    }
    var input = fighter.input || emptyInput();
    var canGuard = fighter.onGround && !fighter.attack && fighter.hitstun <= 0 && fighter.guardBreak <= 0 && fighter.dodge <= 0;
    var wantsGuard = !!input.guard && canGuard;
    if (wantsGuard && !fighter.guarding) fighter.guardAge = 0;
    fighter.guarding = wantsGuard;
    if (fighter.guarding) {
      fighter.guardAge = (fighter.guardAge || 0)+dt;
      fighter.guard = Math.max(0,fighter.guard-dt*9);
      fighter.vx *= Math.max(0,1-dt*15);
      if (fighter.guard <= 0) {
        fighter.guarding = false;
        fighter.guardBreak = .85;
        fighter.hitstun = .85;
        this.addEffect(fighter.x,fighter.y-30,'break','#ff6680',36);
      }
    } else {
      fighter.guardAge = 99;
      fighter.guard = Math.min(fighter.definition.guardMax,fighter.guard+dt*(fighter.hitstun > 0 ? 5 : 18));
    }
    var control = fighter.hitstun > 0 ? .08 : fighter.attack ? .28 : fighter.guarding ? .12 : 1;
    var maxSpeed = fighter.onGround ? fighter.definition.runSpeed : fighter.definition.airSpeed;
    var acceleration = fighter.onGround ? fighter.definition.acceleration : fighter.definition.airAcceleration;
    var targetVx = clamp(input.x,-1,1)*maxSpeed;
    if (Math.abs(input.x) > .05 && control > .1) fighter.facing = input.x < 0 ? -1 : 1;
    fighter.vx += clamp(targetVx-fighter.vx,-acceleration*control*dt,acceleration*control*dt);
    if (fighter.onGround && Math.abs(input.x) < .05) fighter.vx *= Math.max(0,1-fighter.definition.friction*dt);
    if (input.drop && fighter.onGround && fighter.y < 410) {
      fighter.dropTimer = .18;
      fighter.onGround = false;
      fighter.y += 4;
    }
    var gravity = fighter.definition.gravity;
    if (!fighter.onGround) {
      if (input.y > .55 && fighter.vy > -50) gravity *= 1.72;
      fighter.vy = Math.min(fighter.definition.maxFall,fighter.vy+gravity*dt);
    } else if (fighter.vy > 0) fighter.vy = 0;
    fighter.x += fighter.vx*dt;
    fighter.y += fighter.vy*dt;
    this.resolvePlatformCollision(fighter);
    this.updateAttack(fighter,dt);
  };

  PlatformArena.prototype.resolvePlatformCollision = function (fighter) {
    if (fighter.dropTimer > 0 || fighter.vy < 0) { fighter.onGround = false; return; }
    var landed = null;
    STAGE.platforms.forEach(function (platform) {
      if (fighter.x+fighter.width*.42 < platform.x || fighter.x-fighter.width*.42 > platform.x+platform.w) return;
      if (fighter.previousY <= platform.y+2 && fighter.y >= platform.y) {
        if (!landed || platform.y < landed.y) landed = platform;
      }
    });
    if (landed) {
      fighter.y = landed.y;
      fighter.vy = 0;
      fighter.onGround = true;
      fighter.jumps = 2;
      fighter.recoveryUsed = false;
    } else fighter.onGround = false;
  };

  PlatformArena.prototype.resolveFighterSeparation = function () {
    for (var i=0;i<this.fighters.length;i++) {
      var a=this.fighters[i];
      if (a.stocks<=0||a.respawn>0) continue;
      for (var j=i+1;j<this.fighters.length;j++) {
        var b=this.fighters[j];
        if (b.stocks<=0||b.respawn>0) continue;
        if (Math.abs((a.y-a.height*.5)-(b.y-b.height*.5))>48) continue;
        var minimum=(a.width+b.width)*.43;
        var dx=b.x-a.x;
        var previousDx=(Number.isFinite(a.previousX)&&Number.isFinite(b.previousX)) ? b.previousX-a.previousX : dx;
        var crossed=previousDx!==0&&dx!==0&&Math.sign(previousDx)!==Math.sign(dx);
        if (!crossed&&Math.abs(dx)>=minimum) continue;
        var direction=crossed?Math.sign(previousDx):(dx===0?(i<j?1:-1):Math.sign(dx));
        var signedDistance=direction*dx;
        var correction=(minimum-signedDistance)*.5;
        if (correction<=0) continue;
        a.x-=direction*correction;
        b.x+=direction*correction;
        if (direction > 0) {
          a.vx=Math.min(a.vx,0);
          b.vx=Math.max(b.vx,0);
        } else {
          a.vx=Math.max(a.vx,0);
          b.vx=Math.min(b.vx,0);
        }
      }
    }
  };

  PlatformArena.prototype.updateAttack = function (fighter,dt) {
    var attack = fighter.attack;
    if (!attack) return;
    attack.t += dt;
    var moveData = attack.move;
    if (!attack.spawned && attack.t >= moveData.startup) {
      attack.spawned = true;
      if (moveData.projectile) this.spawnProjectile(fighter,moveData);
    }
    var active = attack.t >= moveData.startup && attack.t < moveData.startup+moveData.active;
    if (active && (!this.matchType || this.matchType !== 'online' || this.authority)) {
      var self = this;
      this.fighters.forEach(function (target) {
        if (target === fighter || target.stocks <= 0 || target.respawn > 0 || attack.hit.has(target.id)) return;
        if (self.attackHits(fighter,target,moveData.hitbox)) {
          attack.hit.add(target.id);
          self.applyHit(fighter,target,moveData);
        }
      });
    }
    if (attack.t >= moveData.total) fighter.attack = null;
  };

  PlatformArena.prototype.attackHits = function (attacker,target,hitbox) {
    var centreX = attacker.x + attacker.facing*hitbox.x;
    var centreY = attacker.y + hitbox.y;
    return Math.abs(target.x-centreX) <= hitbox.w*.5+target.width*.42 &&
      Math.abs((target.y-target.height*.48)-centreY) <= hitbox.h*.5+target.height*.48;
  };

  PlatformArena.prototype.applyHit = function (attacker,target,moveData) {
    if (target.invuln > 0 || target.dodge > 0) return false;
    var trainingScale = attacker.isBot && this.matchType === 'training' ? .5 : 1;
    var damageValue = moveData.damage*trainingScale;
    if (target.guarding) {
      if ((target.guardAge || 99) <= .12) {
        attacker.attack = null;
        attacker.hitstun = Math.max(attacker.hitstun,.34);
        attacker.vx = -attacker.facing*120;
        target.ultimate = clamp(target.ultimate+8,0,100);
        this.freeze = Math.max(this.freeze,.045);
        this.addEffect(target.x,target.y-32,'perfect','#9de8ff',48);
        this.audio('block');
        return true;
      }
      target.guard = Math.max(0,target.guard-damageValue*5.2);
      target.vx += attacker.facing*moveData.baseKnockback*.16;
      this.addEffect(target.x,target.y-30,'guard','#62c7ff',24);
      if (target.guard <= 0) {
        target.guarding = false;
        target.guardBreak = .9;
        target.hitstun = .9;
      }
      return true;
    }
    target.damage = clamp(target.damage+damageValue,0,999);
    var radians = moveData.angle*Math.PI/180;
    var launch = clamp((moveData.baseKnockback + target.damage*moveData.growth)*trainingScale,80,880) * (100/target.definition.weight);
    var armour = target.attack && target.attack.move.armour && target.attack.t <= target.attack.move.armour;
    if (armour) launch *= .56;
    target.vx = Math.cos(radians)*launch*attacker.facing;
    target.vy = -Math.sin(radians)*launch;
    target.onGround = false;
    target.hitstun = armour ? Math.max(target.hitstun,.08) : clamp(moveData.hitstun+launch/760,.11,1.05);
    target.attack = armour ? target.attack : null;
    target.lastHitBy = attacker.id;
    attacker.ultimate = clamp(attacker.ultimate+damageValue*2.15,0,100);
    attacker.score += Math.round(damageValue*10);
    this.freeze = Math.max(this.freeze,damageValue >= 15 ? .075 : .038);
    this.addEffect(target.x,target.y-target.height*.5,'hit',moveData.effect,clamp(20+damageValue*2,20,62));
    this.audio(damageValue >= 12 ? 'pulse' : 'attack');
    return true;
  };

  PlatformArena.prototype.spawnProjectile = function (fighter,moveData) {
    if (this.projectiles.length >= MAX_PROJECTILES) this.projectiles.shift();
    var definition = moveData.projectile;
    this.projectiles.push({id:randomToken('P'),owner:fighter.id,move:moveData,x:fighter.x+fighter.facing*34,
      y:definition.grounded ? Math.min(fighter.y-12,405) : fighter.y-33,vx:fighter.facing*definition.speed,vy:0,
      life:definition.life,radius:definition.radius,colour:moveData.effect,hit:new Set()});
  };

  PlatformArena.prototype.updateProjectiles = function (dt) {
    var self = this;
    this.projectiles.forEach(function (projectile) {
      projectile.life -= dt;
      projectile.x += projectile.vx*dt;
      projectile.y += projectile.vy*dt;
      var owner = self.fighters.find(function (fighter) { return fighter.id === projectile.owner; });
      if (!owner || !projectile.move) { projectile.life = 0; return; }
      self.fighters.forEach(function (target) {
        if (target === owner || target.stocks <= 0 || target.respawn > 0 || projectile.hit.has(target.id)) return;
        if (Math.abs(target.x-projectile.x) <= projectile.radius+target.width*.4 &&
            Math.abs(target.y-target.height*.5-projectile.y) <= projectile.radius+target.height*.45) {
          projectile.hit.add(target.id);
          if (self.applyHit(owner,target,projectile.move)) projectile.life = 0;
        }
      });
    });
    this.projectiles = this.projectiles.filter(function (projectile) {
      return projectile.life > 0 && projectile.x > STAGE.blast.left && projectile.x < STAGE.blast.right;
    });
  };

  PlatformArena.prototype.interpolateProjectiles = function (dt) {
    this.projectiles.forEach(function (projectile) {
      projectile.x += (projectile.targetX == null ? projectile.x+projectile.vx*dt : projectile.targetX-projectile.x)*Math.min(1,dt*12);
      projectile.y += (projectile.targetY == null ? 0 : projectile.targetY-projectile.y)*Math.min(1,dt*12);
      projectile.life = Math.max(0,projectile.life-dt);
    });
    this.projectiles = this.projectiles.filter(function (projectile) { return projectile.life > 0; });
  };

  PlatformArena.prototype.resolveMatchState = function () {
    this.fighters.forEach(function (fighter) {
      if (fighter.stocks <= 0 || fighter.respawn > 0) return;
      if (fighter.x < STAGE.blast.left || fighter.x > STAGE.blast.right ||
          fighter.y < STAGE.blast.top || fighter.y > STAGE.blast.bottom) this.knockoutFighter(fighter);
    },this);
    var survivors = this.fighters.filter(function (fighter) { return fighter.stocks > 0; });
    if (survivors.length <= 1 && this.fighters.length > 1) this.finishMatch(survivors[0] || null,'last-note');
  };

  PlatformArena.prototype.knockoutFighter = function (fighter) {
    fighter.stocks = Math.max(0,fighter.stocks-1);
    fighter.falls++;
    var attacker = this.fighters.find(function (item) { return item.id === fighter.lastHitBy; });
    if (attacker && attacker !== fighter) {
      attacker.knockouts++;
      attacker.score += 1000;
      attacker.ultimate = clamp(attacker.ultimate+18,0,100);
    }
    this.addEffect(clamp(fighter.x,0,STAGE.width),clamp(fighter.y,0,STAGE.height),'knockout',fighter.colour,70);
    this.audio('quest');
    if (fighter.stocks > 0) {
      fighter.respawn = 1.05;
      fighter.attack = null;
      fighter.hitstun = 0;
      fighter.vx = fighter.vy = 0;
      fighter.x = STAGE.spawns[this.fighters.indexOf(fighter) % STAGE.spawns.length].x;
      fighter.y = STAGE.blast.top+20;
      fighter.previousX = fighter.x;
      fighter.previousY = fighter.y;
    }
    this.announce(fighter.name + ' lost a note. ' + fighter.stocks + ' remaining.');
  };

  PlatformArena.prototype.respawnFighter = function (fighter) {
    var spawn = STAGE.spawns[this.fighters.indexOf(fighter) % STAGE.spawns.length];
    fighter.x = spawn.x;
    fighter.y = spawn.y-85;
    fighter.previousX = fighter.x;
    fighter.previousY = fighter.y;
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.damage = 0;
    fighter.invuln = 2;
    fighter.dodge = 0;
    fighter.guard = fighter.definition.guardMax;
    fighter.guardBreak = 0;
    fighter.attack = null;
    fighter.attackCooldown = 0;
    fighter.onGround = false;
    fighter.jumps = 2;
    fighter.recoveryUsed = false;
    fighter.animationTime = 0;
    this.addEffect(fighter.x,fighter.y,'respawn',fighter.colour,48);
  };

  PlatformArena.prototype.finishByTime = function () {
    var sorted = this.fighters.slice().sort(function (a,b) {
      if (b.stocks !== a.stocks) return b.stocks-a.stocks;
      if (a.damage !== b.damage) return a.damage-b.damage;
      return b.score-a.score;
    });
    var tied = sorted.length > 1 && sorted[0].stocks === sorted[1].stocks &&
      Math.abs(sorted[0].damage-sorted[1].damage) < .01 && sorted[0].score === sorted[1].score;
    if (tied && !this.suddenDeath) {
      this.suddenDeath = true;
      this.matchTime = 30;
      sorted.forEach(function (fighter,index) {
        fighter.damage = Math.max(200,fighter.damage);
        fighter.stocks = 1;
        fighter.respawn = .6;
        fighter.x = STAGE.spawns[index % STAGE.spawns.length].x;
        fighter.y = STAGE.spawns[index % STAGE.spawns.length].y-80;
      });
      this.announce('Sudden crescendo! One clean launch decides the set.');
      return;
    }
    this.finishMatch(sorted[0] || null,'time');
  };

  PlatformArena.prototype.finishMatch = function (winner,reason,fromNetwork) {
    if (!this.active) return;
    var network = this.network();
    var local = this.localFighter();
    var won = !!(winner && local && winner.ownerId === local.ownerId);
    this.active = false;
    this.phase = 'results';
    this.cancelLoop();
    var detail = Math.max(0,Math.round(MATCH_SECONDS-this.matchTime)) + 's · ' + this.fighters.map(function (fighter) {
      return fighter.name + ' · ' + fighter.knockouts + ' KO · ' + Math.round(fighter.damage) + '%';
    }).join('  |  ');
    this.result = {
      title:winner ? (won ? 'Encore secured' : 'Set complete') : 'Set complete',
      summary:reason === 'time' ? 'The timer resolved the set by lives, damage, then score.' :
        reason === 'disconnect' || reason === 'abandoned' ? 'A performer left and the room resolved safely.' : 'The final note crossed the blast boundary.',
      winnerName:winner ? winner.name + ' wins' : 'No winner',detail:detail
    };
    if (reason !== 'disconnect' && reason !== 'abandoned' && window.__HIGH_NOTES__ && window.__HIGH_NOTES__.production && window.__HIGH_NOTES__.production.recordPvpV2Result && local) {
      window.__HIGH_NOTES__.production.recordPvpV2Result({won:won,online:this.matchType === 'online',
        mode:'stock',instrument:local.instrument,knockouts:local.knockouts,falls:local.falls,duration:MATCH_SECONDS-this.matchTime});
    }
    if (this.matchType === 'online' && this.authority && network && !fromNetwork) {
      var resultPayload = {matchId:this.matchId,winner:winner ? winner.ownerId : '',reason:reason,
        fighters:this.fighters.map(function (fighter) { return {id:fighter.ownerId,stocks:fighter.stocks,damage:Math.round(fighter.damage),knockouts:fighter.knockouts}; })};
      if (reason === 'abandoned') resultPayload.abandonedBy = network.id;
      network.send('match-end',resultPayload);
    }
    this.renderLobby();
  };

  PlatformArena.prototype.announce = function (text) {
    var node = document.getElementById('v2ArenaAnnouncement');
    if (node) node.textContent = clean(text,120);
  };

  PlatformArena.prototype.addEffect = function (x,y,type,colour,size) {
    if (this.effects.length >= MAX_EFFECTS) this.effects.splice(0,this.effects.length-MAX_EFFECTS+1);
    this.effects.push({x:x,y:y,type:type,colour:colour || '#fff',size:size || 24,life:.42,maxLife:.42});
  };

  PlatformArena.prototype.updateEffects = function (dt) {
    this.effects.forEach(function (effect) { effect.life -= dt; });
    this.effects = this.effects.filter(function (effect) { return effect.life > 0; });
  };

  PlatformArena.prototype.updateRemoteVisual = function (fighter,dt) {
    if (!fighter.target) return;
    fighter.x += (fighter.target.x-fighter.x)*Math.min(1,dt*13);
    fighter.y += (fighter.target.y-fighter.y)*Math.min(1,dt*13);
    fighter.vx = fighter.target.vx;
    fighter.vy = fighter.target.vy;
    fighter.animationTime += dt;
    fighter.invuln = Math.max(0,fighter.invuln-dt);
    fighter.hitstun = Math.max(0,fighter.hitstun-dt);
    fighter.dodge = Math.max(0,fighter.dodge-dt);
  };

  PlatformArena.prototype.updateCamera = function (dt) {
    var visible = this.fighters.filter(function (fighter) { return fighter.stocks > 0 && fighter.respawn <= 0; });
    if (!visible.length) return;
    var minX = Math.min.apply(Math,visible.map(function (fighter) { return fighter.x; }));
    var maxX = Math.max.apply(Math,visible.map(function (fighter) { return fighter.x; }));
    var minY = Math.min.apply(Math,visible.map(function (fighter) { return fighter.y; }));
    var maxY = Math.max.apply(Math,visible.map(function (fighter) { return fighter.y; }));
    var spanX = Math.max(480,maxX-minX+330);
    var spanY = Math.max(300,maxY-minY+230);
    this.camera.targetZoom = clamp(Math.min(820/spanX,430/spanY),.62,1.02);
    this.camera.targetX = clamp((minX+maxX)*.5,STAGE.camera.minX,STAGE.camera.maxX);
    this.camera.targetY = clamp((minY+maxY)*.5-20,STAGE.camera.minY,STAGE.camera.maxY);
    var smoothing = 1-Math.pow(.001,dt);
    this.camera.x += (this.camera.targetX-this.camera.x)*smoothing;
    this.camera.y += (this.camera.targetY-this.camera.y)*smoothing;
    this.camera.zoom += (this.camera.targetZoom-this.camera.zoom)*smoothing*.72;
  };

  PlatformArena.prototype.networkTick = function () {
    var network = this.network();
    if (!network || !network.room || !this.active) return;
    var now = performance.now();
    if (!this.authority && now-this.lastInputSent >= 1000/NETWORK_TICK_RATE) {
      this.lastInputSent = now;
      var fighter = this.localFighter();
      if (fighter) {
        var direction = this.directionForFighter(fighter,false);
        var action = this.pendingNetworkAction && now-this.pendingNetworkAction.sentAt < 260 ? this.pendingNetworkAction : null;
        network.send('arena-input',{matchId:this.matchId,seq:++this.inputSequence,x:direction.x,y:direction.y,
          guard:this.keys.has('KeyL') || this.keys.has('TouchGuard'),action:action});
        if (this.pendingNetworkAction && now-this.pendingNetworkAction.sentAt >= 260) this.pendingNetworkAction = null;
      }
    }
    if (this.authority && now-this.lastSnapshotSent >= 1000/NETWORK_SNAPSHOT_RATE) {
      this.lastSnapshotSent = now;
      network.send('arena-snapshot',this.serialiseSnapshot());
    }
  };

  PlatformArena.prototype.serialiseSnapshot = function () {
    return {matchId:this.matchId,seq:++this.lastSnapshotSequence,time:Math.round(this.matchTime*100)/100,
      phase:this.phase,fighters:this.fighters.map(function (fighter) {
        return {id:fighter.ownerId,x:Math.round(fighter.x*10)/10,y:Math.round(fighter.y*10)/10,
          vx:Math.round(fighter.vx),vy:Math.round(fighter.vy),facing:fighter.facing,damage:Math.round(fighter.damage*10)/10,
          stocks:fighter.stocks,guard:Math.round(fighter.guard),invuln:Math.round(fighter.invuln*100)/100,
          hitstun:Math.round(fighter.hitstun*100)/100,respawn:Math.round(fighter.respawn*100)/100,
          ultimate:Math.round(fighter.ultimate),attack:fighter.attack ? fighter.attack.move.id : '',
          attackTime:fighter.attack ? Math.round(fighter.attack.t*1000)/1000 : 0,
          attackHits:fighter.attack ? Array.from(fighter.attack.hit).slice(0,4) : [],knockouts:fighter.knockouts,
          falls:fighter.falls,disconnected:!!fighter.disconnected};
      }),projectiles:this.projectiles.slice(0,MAX_PROJECTILES).map(function (projectile) {
        return {id:projectile.id,owner:projectile.owner,x:Math.round(projectile.x),y:Math.round(projectile.y),
          vx:Math.round(projectile.vx),life:Math.round(projectile.life*100)/100,radius:projectile.radius,
          colour:projectile.colour,move:projectile.move && projectile.move.id ? projectile.move.id : '',
          hits:Array.from(projectile.hit || []).slice(0,4)};
      })};
  };

  PlatformArena.prototype.receiveNetwork = function (message,peer) {
    if (!message || message.v !== PROTOCOL_VERSION) return;
    var network = this.network();
    if (!network) return;
    var payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    if (message.type === 'error') {
      if (this.pendingMatchId) {
        this.pendingMatchId = '';
        this.result = {title:'Relay declined the start',summary:clean(payload.message || 'The room state changed before the set began.',100),
          winnerName:'No match recorded',detail:'Ready everyone again and retry.'};
        if (!this.active && this.isArenaVisible()) this.renderLobby();
      }
      return;
    }
    if (message.type === 'room-welcome') {
      var self = this;
      var roomMatch = payload.match && typeof payload.match === 'object' ? payload.match : {};
      this.lastRoomWelcomeStamp = [message.room,message.ts || 0,message.seq || 0,
        roomMatch.matchId || '',roomMatch.phase || ''].join('|');
      (Array.isArray(payload.peers) ? payload.peers : []).slice(0,4).forEach(function (item) {
        if (!item || !/^[A-Z0-9]{12}$/.test(item.id || '')) return;
        if (FIGHTERS[item.instrument]) self.lobbySelections.set(item.id,item.instrument);
        self.lobbyReady.set(item.id,item.ready === true);
        var activeFighter = self.fighters.find(function (fighter) { return fighter.ownerId === item.id; });
        if (activeFighter) activeFighter.disconnected = item.connected === false;
        if (item.id === network.id && FIGHTERS[item.instrument]) self.selectedInstrument = item.instrument;
      });
      var match = roomMatch;
      if (match && match.phase === 'playing' && Array.isArray(match.roster) &&
          match.roster.indexOf(network.id) >= 0 && (!this.active || this.matchId !== match.matchId)) {
        var restoredPlayers = match.roster.slice(0,4).map(function (id,index) {
          var peer = network.peers.get(id) || {};
          return {id:id,name:clean((peer.profile || {}).displayName || (id === network.id ? 'You' : 'Guest'),18),
            instrument:FIGHTERS[peer.instrument] ? peer.instrument : 'guitar',colour:self.playerColour(index),
            connected:peer.connected !== false};
        });
        this.pendingMatchId = '';
        this.startNetworkMatch({
          matchId:match.matchId,mode:match.mode,stage:match.stage,stocks:match.stocks,
          duration:Math.max(1,Math.round(Number(match.durationMs)/1000) || MATCH_SECONDS),
          startAt:Number(match.startedAt) || Date.now(),remainingMs:Number(match.remainingMs) || 0,
          players:restoredPlayers,rehydrated:true
        });
      }
      if (!this.active && this.isArenaVisible()) this.renderLobby();
      return;
    }
    if (message.type === 'host-migrate') {
      this.authority = network.host === network.id;
      this.networkInputs.clear();
      this.lastSnapshotReceived = 0;
      this.lastSnapshotSequence = 0;
      this.snapshotHost = this.authority ? '' : network.host;
      if (this.active) {
        this.announce(this.authority ? 'You are now the authoritative host.' : 'Host authority migrated safely.');
      }
      return;
    }
    if (message.type === 'select-instrument') {
      if (FIGHTERS[payload.instrument]) this.lobbySelections.set(message.from,payload.instrument);
      this.lobbyReady.set(message.from,false);
      if (!this.active && this.isArenaVisible()) this.renderLobby();
      return;
    }
    if (message.type === 'player-ready') {
      this.lobbyReady.set(message.from,!!payload.ready);
      if (FIGHTERS[payload.instrument]) this.lobbySelections.set(message.from,payload.instrument);
      if (!this.active && this.isArenaVisible()) this.renderLobby();
      return;
    }
    if (message.type === 'match-start') {
      if (message.from === network.host) {
        this.pendingMatchId = '';
        this.startNetworkMatch(payload);
      }
      return;
    }
    if (message.type === 'rematch') {
      if (message.from === network.host) {
        this.pendingMatchId = '';
        this.startNetworkMatch(payload);
      }
      return;
    }
    if (message.type === 'room-join' && payload.reconnected) {
      // Reconnect starts a fresh authenticated input epoch. Retaining the old
      // packet sequence would make a refreshed client wait to catch up before
      // the host accepted movement again.
      this.networkInputs.delete(message.from);
      var restoredFighter = this.fighters.find(function (fighter) { return fighter.ownerId === message.from; });
      if (restoredFighter) {
        restoredFighter.disconnected = false;
        restoredFighter.disconnectUntil = 0;
        restoredFighter.invuln = Math.max(restoredFighter.invuln,1.2);
        restoredFighter.input = emptyInput();
        this.announce(restoredFighter.name + ' rejoined the set.');
      }
      return;
    }
    if (message.type === 'room-leave') {
      var departedFighter = this.fighters.find(function (fighter) { return fighter.ownerId === message.from; });
      if (!departedFighter || !this.active) return;
      this.networkInputs.delete(message.from);
      departedFighter.input = emptyInput();
      departedFighter.attack = null;
      departedFighter.guarding = false;
      departedFighter.vx = 0;
      departedFighter.vy = 0;
      departedFighter.disconnected = true;
      departedFighter.disconnectUntil = Number(payload.reconnectUntil) || 0;
      departedFighter.invuln = Math.max(departedFighter.invuln,1);
      if (payload.temporary) {
        this.announce(departedFighter.name + ' lost connection. Holding their place for 30 seconds.');
        return;
      }
      departedFighter.stocks = 0;
      this.addEffect(departedFighter.x,departedFighter.y,'disconnect',departedFighter.colour,46);
      this.authority = network.host === network.id;
      if (this.authority) this.resolveMatchState();
      return;
    }
    if (!this.active || clean(payload.matchId,48) !== this.matchId) return;
    if (message.type === 'arena-input' && this.authority && message.from !== network.id && network.peers.has(message.from)) {
      var previous = this.networkInputs.get(message.from) || emptyInput();
      var sequence = clamp(Math.floor(Number(payload.seq)||0),0,2147483647);
      if (sequence <= (previous.packetSeq || 0)) return;
      var next = {x:clamp(Number(payload.x)||0,-1,1),y:clamp(Number(payload.y)||0,-1,1),guard:!!payload.guard,
        drop:Number(payload.y)>0.5,packetSeq:sequence,lastActionSeq:previous.lastActionSeq || 0};
      var action = payload.action && typeof payload.action === 'object' ? payload.action : null;
      var actionSeq = action ? clamp(Math.floor(Number(action.seq)||0),0,2147483647) : 0;
      if (action && actionSeq > next.lastActionSeq && ['jump','attack','special','dodge','charge','ultimate'].indexOf(action.type) >= 0) {
        next.lastActionSeq = actionSeq;
        var fighter = this.fighters.find(function (item) { return item.ownerId === message.from; });
        if (fighter) this.queueFighterAction(fighter,action.type,{x:clamp(Number(action.x)||0,-1,1),y:clamp(Number(action.y)||0,-1,1)},false);
      }
      this.networkInputs.set(message.from,next);
      return;
    }
    if (message.type === 'arena-snapshot' && !this.authority && message.from === network.host) {
      if (this.snapshotHost !== message.from) {
        this.snapshotHost = message.from;
        this.lastSnapshotReceived = 0;
      }
      var sequenceSnapshot = clamp(Math.floor(Number(payload.seq)||0),0,2147483647);
      if (sequenceSnapshot <= this.lastSnapshotReceived) return;
      this.lastSnapshotReceived = sequenceSnapshot;
      this.matchTime = clamp(Number(payload.time)||0,0,MATCH_SECONDS);
      var self = this;
      (Array.isArray(payload.fighters) ? payload.fighters : []).slice(0,4).forEach(function (data) {
        var fighter = self.fighters.find(function (item) { return item.ownerId === clean(data.id,24); });
        if (!fighter) return;
        var nextX = clamp(Number(data.x)||fighter.x,STAGE.blast.left-40,STAGE.blast.right+40);
        var nextY = clamp(Number(data.y)||fighter.y,STAGE.blast.top-40,STAGE.blast.bottom+40);
        fighter.target = {x:nextX,y:nextY,vx:clamp(Number(data.vx)||0,-1000,1000),vy:clamp(Number(data.vy)||0,-1000,1000)};
        var incomingDisconnected = data.disconnected === true;
        if (incomingDisconnected) {
          fighter.x = fighter.previousX = nextX;
          fighter.y = fighter.previousY = nextY;
          fighter.vx = fighter.target.vx;
          fighter.vy = fighter.target.vy;
        } else if (fighter.ownerId === network.id) {
          fighter.x += (nextX-fighter.x)*.32;
          fighter.y += (nextY-fighter.y)*.32;
          fighter.vx += (fighter.target.vx-fighter.vx)*.25;
          fighter.vy += (fighter.target.vy-fighter.vy)*.25;
        }
        fighter.facing = Number(data.facing) < 0 ? -1 : 1;
        fighter.damage = clamp(Number(data.damage)||0,0,999);
        fighter.stocks = clamp(Math.floor(Number(data.stocks)||0),0,STARTING_STOCKS);
        fighter.guard = clamp(Number(data.guard)||0,0,fighter.definition.guardMax);
        fighter.invuln = clamp(Number(data.invuln)||0,0,3);
        fighter.hitstun = clamp(Number(data.hitstun)||0,0,2);
        fighter.respawn = clamp(Number(data.respawn)||0,0,3);
        fighter.ultimate = clamp(Number(data.ultimate)||0,0,100);
        fighter.knockouts = clamp(Math.floor(Number(data.knockouts)||0),0,99);
        fighter.falls = clamp(Math.floor(Number(data.falls)||0),0,99);
        fighter.disconnected = incomingDisconnected;
        var attackId = clean(data.attack,40);
        if (attackId) {
          var moveData = Object.keys(fighter.definition.moves).map(function (key) { return fighter.definition.moves[key]; })
            .find(function (candidate) { return candidate.id === attackId; });
          if (moveData) {
            var attackHits = (Array.isArray(data.attackHits) ? data.attackHits : []).slice(0,4).map(function (id) {
              return clean(id,24);
            }).filter(function (id) { return /^(?:net-)?[A-Z0-9]{12}$/.test(id); });
            fighter.attack = {move:moveData,t:clamp(Number(data.attackTime)||0,0,moveData.total),
              hit:new Set(attackHits),spawned:true};
          }
        } else fighter.attack = null;
      });
      this.applyProjectileSnapshot(payload.projectiles);
      return;
    }
    if (message.type === 'match-end' && message.from === network.host) {
      var winner = this.fighters.find(function (fighter) { return fighter.ownerId === clean(payload.winner,24); }) || null;
      this.finishMatch(winner,clean(payload.reason,24) || 'last-note',true);
      return;
    }
  };

  PlatformArena.prototype.applyProjectileSnapshot = function (rows) {
    var self = this;
    var existing = new Map(this.projectiles.map(function (projectile) { return [projectile.id,projectile]; }));
    this.projectiles = (Array.isArray(rows) ? rows : []).slice(0,MAX_PROJECTILES).map(function (row) {
      var id = clean(row.id,48);
      var projectile = existing.get(id) || {id:id,hit:new Set()};
      projectile.owner = clean(row.owner,48);
      projectile.targetX = clamp(Number(row.x)||0,STAGE.blast.left,STAGE.blast.right);
      projectile.targetY = clamp(Number(row.y)||0,STAGE.blast.top,STAGE.blast.bottom);
      if (!Number.isFinite(projectile.x)) { projectile.x = projectile.targetX; projectile.y = projectile.targetY; }
      projectile.vx = clamp(Number(row.vx)||0,-700,700);
      projectile.life = clamp(Number(row.life)||0,0,3);
      projectile.radius = clamp(Number(row.radius)||10,4,30);
      projectile.colour = /^#[0-9a-f]{6}$/i.test(row.colour || '') ? row.colour : '#ffc857';
      projectile.hit = new Set((Array.isArray(row.hits) ? row.hits : []).slice(0,4).map(function (targetId) {
        return clean(targetId,24);
      }).filter(function (targetId) { return /^(?:net-)?[A-Z0-9]{12}$/.test(targetId); }));
      var owner = self.fighters.find(function (fighter) { return fighter.id === projectile.owner; });
      var moveId = clean(row.move,40);
      if (owner) {
        var projectileMoves = Object.keys(owner.definition.moves).map(function (key) { return owner.definition.moves[key]; })
          .filter(function (candidate) { return candidate && candidate.projectile; });
        projectile.move = projectileMoves.find(function (candidate) { return candidate.id === moveId; }) ||
          (projectile.move && projectile.move.projectile ? projectile.move : projectileMoves[0] || null);
      } else projectile.move = null;
      return projectile;
    });
  };

  PlatformArena.prototype.draw = function () {
    var ctx = this.ctx;
    var canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (this.background.complete && this.background.naturalWidth) {
      var sourceRatio = this.background.naturalWidth/this.background.naturalHeight;
      var targetRatio = canvas.width/canvas.height;
      var sx=0,sy=0,sw=this.background.naturalWidth,sh=this.background.naturalHeight;
      if (sourceRatio > targetRatio) { sw=sh*targetRatio; sx=(this.background.naturalWidth-sw)*.5; }
      else { sh=sw/targetRatio; sy=(this.background.naturalHeight-sh)*.5; }
      ctx.drawImage(this.background,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    } else {
      var fallback = ctx.createLinearGradient(0,0,0,canvas.height);
      fallback.addColorStop(0,'#071b18'); fallback.addColorStop(1,'#132c28');
      ctx.fillStyle=fallback; ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    ctx.fillStyle='rgba(2,9,16,.34)';ctx.fillRect(0,0,canvas.width,canvas.height);
    this.drawParallax(ctx);
    ctx.save();
    ctx.translate(canvas.width*.5,canvas.height*.56);
    ctx.scale(this.camera.zoom,this.camera.zoom);
    ctx.translate(-this.camera.x,-this.camera.y);
    this.drawStage(ctx);
    this.drawProjectiles(ctx);
    var self=this;
    this.fighters.forEach(function (fighter,index) { self.drawFighter(ctx,fighter,index); });
    this.drawEffects(ctx);
    ctx.restore();
    this.drawHud(ctx);
    this.drawOffscreenIndicators(ctx);
    if (this.phase === 'countdown') this.drawCountdown(ctx);
    var now=performance.now();
    if(now-this.lastDomStatus>=250){
      this.lastDomStatus=now;
      canvas.dataset.arenaState=this.phase;
      canvas.dataset.matchType=this.matchType;
      canvas.dataset.matchTime=String(Math.round(this.matchTime*10)/10);
      canvas.dataset.fighters=this.fighters.map(function(fighter){return [fighter.name,Math.round(fighter.damage),fighter.stocks,Math.round(fighter.x),Math.round(fighter.y)].join(':');}).join('|');
      canvas.dataset.projectiles=String(this.projectiles.length);
    }
  };

  PlatformArena.prototype.drawParallax = function (ctx) {
    var offset=(this.camera.x-600)*-.035;
    ctx.save();
    ctx.globalAlpha=.28;
    ctx.fillStyle='#7df7a1';
    for(var i=0;i<7;i++){
      var x=((i*173+offset)%1100)-100;
      ctx.beginPath();ctx.arc(x,90+(i%3)*32,2+(i%2),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  };

  PlatformArena.prototype.drawStage = function (ctx) {
    STAGE.platforms.forEach(function (platform,index) {
      ctx.save();
      ctx.shadowColor=index===0?'#7df7a1':'#9de8ff';ctx.shadowBlur=index===0?24:14;
      var gradient=ctx.createLinearGradient(0,platform.y,0,platform.y+platform.h);
      gradient.addColorStop(0,index===0?'#72d995':'#87d9cf');
      gradient.addColorStop(.18,index===0?'#35694c':'#345e68');
      gradient.addColorStop(1,'#132a2d');
      ctx.fillStyle=gradient;
      ctx.beginPath();ctx.roundRect(platform.x,platform.y,platform.w,platform.h,index===0?12:8);ctx.fill();
      ctx.shadowBlur=0;
      ctx.strokeStyle=index===0?'rgba(125,247,161,.8)':'rgba(157,232,255,.76)';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(platform.x+10,platform.y+2);ctx.lineTo(platform.x+platform.w-10,platform.y+2);ctx.stroke();
      if(index===0){
        ctx.fillStyle='rgba(125,247,161,.32)';
        for(var p=platform.x+20;p<platform.x+platform.w-10;p+=38){ctx.fillRect(p,platform.y+platform.h,4,16+(p%3)*4);}
      }
      ctx.restore();
    });
    ctx.save();
    ctx.strokeStyle='rgba(246,227,109,.34)';ctx.lineWidth=2;ctx.setLineDash([9,11]);
    ctx.strokeRect(STAGE.blast.left,STAGE.blast.top,STAGE.blast.right-STAGE.blast.left,STAGE.blast.bottom-STAGE.blast.top);
    ctx.setLineDash([]);ctx.restore();
  };

  PlatformArena.prototype.animationFor = function (fighter) {
    if (fighter.respawn > 0 || fighter.invuln > 1.35) return 'spawn';
    if (fighter.guardBreak > 0) return 'stunned';
    if (fighter.hitstun > 0) return 'hurt';
    if (fighter.attack) return fighter.attack.move.animation;
    var direction=fighter.facing<0?'west':'east';
    if (!fighter.onGround) return 'run_'+direction;
    if (Math.abs(fighter.vx)>24) return 'run_'+direction;
    return 'idle_'+direction;
  };

  PlatformArena.prototype.drawFighter = function (ctx,fighter,index) {
    if (fighter.stocks<=0 || fighter.respawn>0) return;
    var blink=fighter.invuln>0 && Math.floor(fighter.invuln*14)%2===0;
    ctx.save();
    ctx.globalAlpha=blink?.48:1;
    ctx.fillStyle='rgba(0,0,0,.38)';ctx.beginPath();ctx.ellipse(fighter.x,fighter.y+3,27,8,0,0,Math.PI*2);ctx.fill();
    var drawn=false;
    if(window.MossSprites){
      drawn=window.MossSprites.draw(ctx,fighter.definition.sprite,this.animationFor(fighter),fighter.animationTime,
        fighter.x,fighter.y,82,{flipX:false,glow:fighter.attack?fighter.attack.move.effect:fighter.colour,glowBlur:fighter.attack?18:7});
    }
    if(!drawn){
      ctx.strokeStyle=fighter.colour;ctx.lineWidth=4;ctx.shadowColor=fighter.colour;ctx.shadowBlur=16;
      ctx.beginPath();ctx.arc(fighter.x,fighter.y-30,23,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle='#f1f7f4';ctx.font='900 18px monospace';ctx.textAlign='center';ctx.fillText('♪',fighter.x,fighter.y-24);
    }
    if(fighter.guarding){
      ctx.strokeStyle=(fighter.guardAge||99)<=.12?'#f6e36d':'#62c7ff';ctx.lineWidth=5;ctx.globalAlpha=.76;
      ctx.beginPath();ctx.arc(fighter.x,fighter.y-31,38,-1.1,1.1);ctx.stroke();
    }
    if(fighter.attack){
      var attack=fighter.attack,moveData=attack.move;
      var progress=clamp((attack.t-moveData.startup)/Math.max(.01,moveData.active),0,1);
      if(attack.t>=moveData.startup&&attack.t<moveData.startup+moveData.active){
        ctx.strokeStyle=moveData.effect;ctx.lineWidth=5;ctx.globalAlpha=.82;ctx.shadowColor=moveData.effect;ctx.shadowBlur=14;
        ctx.beginPath();ctx.arc(fighter.x,fighter.y-31,39+progress*13,fighter.facing>0?-1.15:Math.PI+.15,
          fighter.facing>0?1.15:Math.PI*2-.15,fighter.facing<0);ctx.stroke();ctx.shadowBlur=0;
      }
    }
    ctx.fillStyle=fighter.colour;ctx.globalAlpha=1;ctx.beginPath();ctx.arc(fighter.x,fighter.y-67,5,0,Math.PI*2);ctx.fill();
    ctx.restore();
  };

  PlatformArena.prototype.drawProjectiles = function (ctx) {
    this.projectiles.forEach(function (projectile) {
      ctx.save();ctx.fillStyle=projectile.colour;ctx.shadowColor=projectile.colour;ctx.shadowBlur=18;
      ctx.beginPath();ctx.arc(projectile.x,projectile.y,projectile.radius,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(projectile.x,projectile.y,
        Math.max(3,projectile.radius*.45),0,Math.PI*2);ctx.stroke();ctx.restore();
    });
  };

  PlatformArena.prototype.drawEffects = function (ctx) {
    this.effects.forEach(function (effect) {
      var progress=1-effect.life/effect.maxLife;
      ctx.save();ctx.globalAlpha=clamp(effect.life/effect.maxLife,0,1);ctx.strokeStyle=effect.colour;
      ctx.lineWidth=Math.max(2,6*(1-progress));ctx.shadowColor=effect.colour;ctx.shadowBlur=18;
      ctx.beginPath();ctx.arc(effect.x,effect.y,effect.size*(.25+progress),0,Math.PI*2);ctx.stroke();
      if(effect.type==='hit'||effect.type==='knockout'){
        for(var i=0;i<6;i++){var a=i*Math.PI/3+progress;ctx.beginPath();ctx.moveTo(effect.x+Math.cos(a)*effect.size*.25,effect.y+Math.sin(a)*effect.size*.25);
          ctx.lineTo(effect.x+Math.cos(a)*effect.size*(.5+progress),effect.y+Math.sin(a)*effect.size*(.5+progress));ctx.stroke();}
      }
      ctx.restore();
    });
  };

  PlatformArena.prototype.drawHud = function (ctx) {
    var self=this;
    var count=this.fighters.length;
    var cardWidth=Math.min(205,(860-(count-1)*8)/count);
    this.fighters.forEach(function (fighter,index) {
      var x=20+index*(cardWidth+8),y=16;
      ctx.save();ctx.fillStyle='rgba(3,9,16,.86)';ctx.strokeStyle=fighter.colour;ctx.lineWidth=2;
      ctx.beginPath();ctx.roundRect(x,y,cardWidth,58,10);ctx.fill();ctx.stroke();
      ctx.fillStyle='#dfeceb';ctx.font='800 10px monospace';ctx.textAlign='left';ctx.fillText(fighter.name.toUpperCase(),x+9,y+14);
      ctx.fillStyle=fighter.damage>=120?'#ff6680':fighter.damage>=70?'#ffc857':'#f1f7f4';ctx.font='900 24px monospace';
      ctx.fillText(Math.round(fighter.damage)+'%',x+8,y+40);
      ctx.fillStyle=fighter.colour;ctx.font='800 10px monospace';ctx.textAlign='right';
      ctx.fillText('♪'.repeat(fighter.stocks),x+cardWidth-8,y+15);
      ctx.fillStyle='rgba(255,255,255,.1)';ctx.fillRect(x+85,y+31,cardWidth-96,5);
      ctx.fillStyle='#62c7ff';ctx.fillRect(x+85,y+31,(cardWidth-96)*clamp(fighter.guard/fighter.definition.guardMax,0,1),5);
      ctx.fillStyle='rgba(255,255,255,.1)';ctx.fillRect(x+85,y+43,cardWidth-96,5);
      ctx.fillStyle='#f6e36d';ctx.fillRect(x+85,y+43,(cardWidth-96)*fighter.ultimate/100,5);
      ctx.restore();
    });
    ctx.save();ctx.fillStyle='rgba(3,9,16,.88)';ctx.beginPath();ctx.roundRect(365,82,170,34,12);ctx.fill();
    ctx.fillStyle='#f1f7f4';ctx.textAlign='center';ctx.font='900 18px monospace';
    var minutes=Math.floor(this.matchTime/60),seconds=Math.floor(this.matchTime%60);
    ctx.fillText(minutes+':'+String(seconds).padStart(2,'0'),450,105);ctx.restore();
  };

  PlatformArena.prototype.drawOffscreenIndicators = function (ctx) {
    var self=this;
    this.fighters.forEach(function (fighter) {
      if(fighter.stocks<=0||fighter.respawn>0)return;
      var sx=450+(fighter.x-self.camera.x)*self.camera.zoom;
      var sy=280+(fighter.y-self.camera.y)*self.camera.zoom;
      if(sx>=20&&sx<=880&&sy>=88&&sy<=480)return;
      var x=clamp(sx,28,872),y=clamp(sy,96,472);
      ctx.save();ctx.translate(x,y);ctx.fillStyle=fighter.colour;ctx.shadowColor=fighter.colour;ctx.shadowBlur=12;
      var angle=Math.atan2(sy-y,sx-x);ctx.rotate(angle);ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(-8,-7);ctx.lineTo(-8,7);ctx.closePath();ctx.fill();
      ctx.restore();ctx.fillStyle='#fff';ctx.font='800 9px monospace';ctx.textAlign='center';ctx.fillText(Math.round(fighter.damage)+'%',x,y-11);
    });
  };

  PlatformArena.prototype.drawCountdown = function (ctx) {
    var label=this.countdown>.45?String(Math.max(1,Math.ceil(this.countdown-.2))):'PERFORM!';
    ctx.save();ctx.fillStyle='rgba(3,8,14,.72)';ctx.fillRect(0,0,900,500);
    ctx.fillStyle='#f6e36d';ctx.shadowColor='#f6e36d';ctx.shadowBlur=28;ctx.font='900 54px monospace';ctx.textAlign='center';
    ctx.fillText(label,450,275);ctx.shadowBlur=0;ctx.fillStyle='#dfeceb';ctx.font='800 13px monospace';
    ctx.fillText('THREE NOTES · BLAST-ZONE KNOCKOUTS · NO PVE STAT ADVANTAGE',450,309);ctx.restore();
  };

  var arena=new PlatformArena();
  window.HighNotesV2Arena={
    version:VERSION,
    protocolVersion:PROTOCOL_VERSION,
    render:function(root,integration){arena.render(root,integration);},
    stop:function(reason){arena.stop(reason);},
    receiveNetwork:function(message,peer){arena.receiveNetwork(message,peer);},
    data:{fighters:FIGHTERS,stage:STAGE,modes:PLANNED_MODES},
    debug:{startTraining:function(){arena.startOffline('training');},arena:arena}
  };
}());
