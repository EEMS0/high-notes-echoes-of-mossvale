(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  var W = canvas.width || 960;
  var H = canvas.height || 540;
  var WORLD = { w: 2800, h: 1900 };
  var HUB = { x: 1400, y: 930 };
  var BOSS_CENTER = { x: 2325, y: 1510 };
  var SAVE_KEY = 'highNotesSaveV7';
  var LEGACY_SAVE_KEY = 'highNotesSaveV6';
  var OLDER_SAVE_KEY = 'highNotesSaveV5';
  var OLDEST_SAVE_KEY = 'highNotesSaveV4';
  var ANCIENT_SAVE_KEY = 'highNotesSaveV2';
  var SETTINGS_KEY = 'highNotesSettingsV2';
  var GAME_VERSION = '2.0.0';
  var SAVE_SCHEMA_VERSION = 20;
  var NOTE_ORDER = ['C', 'E', 'G', 'B'];
  var NOTE_COLORS = { C: '#56f0c4', E: '#ffc857', G: '#66b8ff', B: '#db80ff' };
  var SPRITE_PATH = 'assets/sprites/runtime/';
  var spriteImages = {};
  /*
   * Only atlases that still own a gameplay system are loaded eagerly. Character
   * art is now supplied by MossSprites, so retaining the old NPC/enemy atlases
   * here would decode more than 100 MB of duplicate texture data on mobile.
   */
  ['hero', 'items', 'instrument-mastery'].forEach(function (name) {
    var image = new Image();
    image.decoding = 'async';
    image.onload = function () { canvasDirty = true; };
    image.onerror = function () {
      image.failed = true;
      reportRuntimeIssue('Legacy gameplay atlas "' + name + '" failed to load.', new Error(image.src));
    };
    image.src = SPRITE_PATH + name + '-sheet.png';
    spriteImages[name] = image;
  });
  var worldMapImage = new Image();
  worldMapImage.decoding = 'async';
  worldMapImage.onload = function () { canvasDirty = true; if (mapOpen) drawMap(); };
  worldMapImage.onerror = function () {
    worldMapImage.failed = true;
    reportRuntimeIssue('The illustrated world map failed to load.', new Error(worldMapImage.src));
  };
  worldMapImage.src = 'assets/world-map-illustrated.png';
  var touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  document.body.classList.toggle('no-pointer-events', !window.PointerEvent);
  var orientationBlocked = false;
  var viewportWidth = window.innerWidth || 960;
  var viewportHeight = window.innerHeight || 540;
  var viewportFrame = 0;
  var orientationReturnFocus = null;
  var resumeAudioOnGesture = false;
  var canvasDirty = true;

  function byId(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function distance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function length(x, y) { return Math.sqrt(x * x + y * y); }
  function normalize(x, y) {
    var l = Math.sqrt(x * x + y * y) || 1;
    return { x: x / l, y: y / l };
  }
  function angleDelta(a, b) {
    var d = (a - b + Math.PI) % (Math.PI * 2) - Math.PI;
    return d < -Math.PI ? d + Math.PI * 2 : d;
  }
  function roundedRect(c, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function spriteAvailable(name) {
    var image = spriteImages[name];
    return !!image && image.complete && image.naturalWidth > 0 && !image.failed;
  }

  function drawSpriteCell(name, row, col, x, y, size, anchorY, alpha) {
    if (!spriteAvailable(name)) return false;
    var image = spriteImages[name];
    var cellW = image.naturalWidth / 4;
    var cellH = image.naturalHeight / 4;
    ctx.save();
    ctx.globalAlpha *= alpha == null ? 1 : alpha;
    ctx.drawImage(image, col * cellW, row * cellH, cellW, cellH,
      Math.round(x - size / 2), Math.round(y - size * (anchorY == null ? 0.72 : anchorY)), size, size);
    ctx.restore();
    return true;
  }

  function drawAtlasCell(name, cols, rows, row, col, x, y, width, height, anchorY, alpha) {
    if (!spriteAvailable(name)) return false;
    var image = spriteImages[name];
    var cellW = image.naturalWidth / cols;
    var cellH = image.naturalHeight / rows;
    ctx.save();
    ctx.globalAlpha *= alpha == null ? 1 : alpha;
    ctx.drawImage(image, col * cellW, row * cellH, cellW, cellH,
      Math.round(x - width / 2), Math.round(y - height * (anchorY == null ? 0.72 : anchorY)), width, height);
    ctx.restore();
    return true;
  }

  function facingColumn(angle) {
    var x = Math.cos(angle);
    var y = Math.sin(angle);
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 2 : 3;
    return y < 0 ? 1 : 0;
  }

  function spriteDirection(angle) {
    return window.MossSprites ? window.MossSprites.directionFromAngle(angle) : 'south';
  }

  function setAnimationState(entity, stateName, lockSeconds) {
    if (!entity) return;
    if (entity.animState !== stateName) {
      entity.animState = stateName;
      entity.animTime = 0;
    }
    if (lockSeconds) entity.animLock = Math.max(entity.animLock || 0, lockSeconds);
  }

  function drawProductionSprite(id, animationName, elapsed, x, footY, size, options) {
    return !!(window.MossSprites &&
      window.MossSprites.draw(ctx, id, animationName, elapsed, x, footY, size, options));
  }

  function reportRuntimeIssue(key, error) {
    if (!reportRuntimeIssue.seen) reportRuntimeIssue.seen = new Set();
    if (reportRuntimeIssue.seen.has(key)) return;
    reportRuntimeIssue.seen.add(key);
    if (canvas) canvas.dataset.runtimeErrors = String(reportRuntimeIssue.seen.size);
    console.error('[HIGH NOTES] ' + key, error);
  }

  function reportUnexpectedDomError(key, error) {
    if (error && (error.name === 'InvalidStateError' || error.name === 'NotFoundError')) return;
    reportRuntimeIssue(key, error);
  }

  window.addEventListener('error', function (event) {
    reportRuntimeIssue('Unhandled runtime error.', event.error || new Error(event.message || 'Unknown script error'));
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unknown rejection'));
    reportRuntimeIssue('Unhandled promise rejection.', reason);
  });

  function itemCellStyle(row, col) {
    return 'background-position:' + (col * 100 / 3) + '% ' + (row * 100 / 3) + '%';
  }

  function shopItemCellStyle(index) {
    var col = index % 5;
    var row = Math.floor(index / 5);
    return 'background-position:' + (col * 25) + '% ' + (row * 100 / 3) + '%';
  }
  function mulberry32(seed) {
    return function () {
      var t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function safeJson(text, fallback) {
    try {
      var value = JSON.parse(text);
      return value && typeof value === 'object' ? value : fallback;
    } catch (error) {
      reportRuntimeIssue('Invalid saved JSON was ignored safely.', error);
      return fallback;
    }
  }
  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = !!hidden;
    el.classList.toggle('hidden', !!hidden);
    el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    canvasDirty = true;
  }
  function audioCall(name) {
    var audio = window.MossAudio;
    if (!audio || typeof audio[name] !== 'function') return;
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      return audio[name].apply(audio, args);
    } catch (error) {
      reportRuntimeIssue('Audio method "' + name + '" failed.', error);
      return undefined;
    }
  }

  function settlePromise(value) {
    if (value && typeof value.catch === 'function') {
      value.catch(function (error) { reportRuntimeIssue('An asynchronous game operation failed.', error); });
    }
    return value;
  }

  function focusSoon(id) {
    window.requestAnimationFrame(function () {
      var el = byId(id);
      if (!el || el.hidden || typeof el.focus !== 'function') return;
      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    });
  }

  function viewportSize() {
    var visual = window.visualViewport;
    var useVisual = visual && (!visual.scale || Math.abs(visual.scale - 1) < 0.01);
    return {
      width: Math.max(1, Math.round(useVisual ? visual.width : (window.innerWidth || 960))),
      height: Math.max(1, Math.round(useVisual ? visual.height : (window.innerHeight || 540))),
      left: useVisual ? visual.offsetLeft : 0,
      top: useVisual ? visual.offsetTop : 0
    };
  }

  function setOrientationIsolation(blocked) {
    var shell = byId('gameShell');
    var notice = byId('rotateNotice');
    if (!shell || !notice) return;
    Array.prototype.forEach.call(shell.children, function (child) {
      if (child === notice) return;
      if (blocked) {
        if (!child.hasAttribute('data-orientation-aria')) {
          child.setAttribute('data-orientation-aria', child.hasAttribute('aria-hidden') ? child.getAttribute('aria-hidden') : '__missing__');
          child.setAttribute('data-orientation-inert', child.inert ? 'true' : 'false');
        }
        child.inert = true;
        child.setAttribute('aria-hidden', 'true');
      } else if (child.hasAttribute('data-orientation-aria')) {
        var previous = child.getAttribute('data-orientation-aria');
        child.inert = child.getAttribute('data-orientation-inert') === 'true';
        if (previous === '__missing__') child.removeAttribute('aria-hidden');
        else child.setAttribute('aria-hidden', previous);
        child.removeAttribute('data-orientation-aria');
        child.removeAttribute('data-orientation-inert');
      }
    });
    if (blocked) {
      orientationReturnFocus = document.activeElement;
      focusSoon('rotateNotice');
    } else {
      var target = started && paused ? byId('resumeButton') : orientationReturnFocus;
      orientationReturnFocus = null;
      if (target && typeof target.focus === 'function') {
        window.requestAnimationFrame(function () {
          try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
        });
      }
    }
  }

  function syncViewport() {
    viewportFrame = 0;
    var size = viewportSize();
    viewportWidth = size.width;
    viewportHeight = size.height;
    var root = document.documentElement;
    root.style.setProperty('--app-width', size.width + 'px');
    root.style.setProperty('--app-height', size.height + 'px');
    document.body.classList.toggle('touch-capable', touchCapable);

    var shell = byId('gameShell');
    if (shell) {
      var rect = shell.getBoundingClientRect();
      root.style.setProperty('--shell-gutter-left', Math.max(0, rect.left - size.left) + 'px');
      root.style.setProperty('--shell-gutter-right', Math.max(0, size.left + size.width - rect.right) + 'px');
      root.style.setProperty('--shell-gutter-top', Math.max(0, rect.top - size.top) + 'px');
      root.style.setProperty('--shell-gutter-bottom', Math.max(0, size.top + size.height - rect.bottom) + 'px');
    }

    var wasBlocked = orientationBlocked;
    orientationBlocked = touchCapable && size.height > size.width;
    document.body.classList.toggle('is-portrait', orientationBlocked);
    canvasDirty = true;
    if (orientationBlocked !== wasBlocked) {
      releaseHeldInputs();
      if (orientationBlocked && started) pauseForInterruption();
      setOrientationIsolation(orientationBlocked);
    }
  }

  function queueViewportSync() {
    if (viewportFrame) return;
    viewportFrame = window.requestAnimationFrame(syncViewport);
  }

  var overlayIsolationRecords = new Map();
  function setOverlayIsolation(token, panelId, active) {
    if (!active) {
      var saved = overlayIsolationRecords.get(token);
      if (!saved) return;
      saved.forEach(function (record) {
        record.element.inert = record.inert;
        if (record.ariaHidden === null) record.element.removeAttribute('aria-hidden');
        else record.element.setAttribute('aria-hidden', record.ariaHidden);
      });
      overlayIsolationRecords.delete(token);
      return;
    }
    if (overlayIsolationRecords.has(token)) return;
    var shell = byId('gameShell');
    var panel = byId(panelId);
    var rotate = byId('rotateNotice');
    if (!shell || !panel) return;
    var records = [];
    Array.prototype.forEach.call(shell.children, function (child) {
      if (child === panel || child === rotate) return;
      records.push({
        element: child,
        inert: !!child.inert,
        ariaHidden: child.hasAttribute('aria-hidden') ? child.getAttribute('aria-hidden') : null
      });
      child.inert = true;
      child.setAttribute('aria-hidden', 'true');
    });
    overlayIsolationRecords.set(token, records);
  }

  var defaults = {
    difficulty: 'standard',
    musicVolume: 0.62,
    sfxVolume: 0.78,
    screenShake: true,
    reducedMotion: false,
    objectiveArrow: true,
    largeText: false,
    interfaceSize: 'standard',
    adaptiveFirstStage: true
  };
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      reportRuntimeIssue('Browser storage could not be read.', error);
      return null;
    }
  }
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      reportRuntimeIssue('Browser storage could not be written.', error);
      return false;
    }
  }
  function removeStoredSaves() {
    try {
      [SAVE_KEY, LEGACY_SAVE_KEY, OLDER_SAVE_KEY, OLDEST_SAVE_KEY, ANCIENT_SAVE_KEY].forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (error) {
      reportRuntimeIssue('Saved adventures could not be removed.', error);
    }
  }
  var settings = Object.assign({}, defaults, safeJson(readStorage(SETTINGS_KEY), {}));

  function freshStatistics() {
    return {
      distanceTravelled: 0,
      attacksSwung: 0,
      dashes: 0,
      pulses: 0,
      damageDealt: 0,
      damageTaken: 0,
      heartsRecovered: 0,
      deaths: 0,
      beatcoinsEarned: 0,
      beatcoinsSpent: 0,
      shopPurchases: 0,
      healingItemsCollected: 0,
      healingItemsUsed: 0,
      bestBossTimes: {},
      highestCombo: 0,
      perfectBeats: 0,
      blocksPerformed: 0,
      perfectBlocks: 0,
      damageBlocked: 0,
      counterAttacks: 0,
      eliteEnemiesDefeated: 0,
      miniBossesDefeated: 0,
      worldEventsCompleted: 0,
      instrumentsMastered: 0,
      questsCompleted: 0
    };
  }

  function freshState() {
    return {
      version: SAVE_SCHEMA_VERSION,
      chapter: 1,
      odinRecruited: false,
      metMara: false,
      metPip: false,
      metZephra: false,
      metNix: false,
      metTavi: false,
      metLuma: false,
      chapterRelics: [],
      stageBosses: [],
      campaignFinaleSeen: false,
      stage: 1,
      beatcoins: 0,
      skillPoints: 0,
      skills: [],
      purchases: [],
      heartblooms: 0,
      collectedHeartblooms: [],
      statistics: freshStatistics(),
      stagePositions: {},
      stageTokens: [],
      collectibles: [],
      collectibleRewards: [],
      activeResonance: '',
      equippedInstrument: 'guitar',
      unlockedInstruments: ['guitar'],
      equipmentVisual: {
        schemaVersion: 1,
        cosmeticVariant: 'standard',
        preferredLoadout: ['guitar']
      },
      instrumentMastery: {
        guitar: { xp: 0, level: 1 },
        bass: { xp: 0, level: 1 },
        synth: { xp: 0, level: 1 },
        drums: { xp: 0, level: 1 },
        microphone: { xp: 0, level: 1 },
        violin: { xp: 0, level: 1 }
      },
      masteryNodes: [],
      home: {
        unlocked: false,
        level: 1,
        odinFriendship: 0,
        odinFedAt: 0,
        greenhousePlantedAt: 0,
        greenhouseCrop: '',
        greenhouseHarvests: 0,
        workshopLevel: 1,
        jukeboxTrack: 'Mossvale Overture',
        decorations: ['woven-rug'],
        activeDecoration: 'woven-rug'
      },
      questStates: {},
      completedQuests: [],
      eliteDefeated: [],
      miniBossesDefeated: [],
      discoveredLocations: ['mossvale-hub'],
      discoveredSecrets: [],
      worldEventsSeen: [],
      achievements: [],
      weather: 'clear',
      weeds: [],
      notes: [],
      drums: [],
      speakers: [],
      defeated: [],
      melody: ['C', '-', 'E', '-', 'G', '-', 'B', '-'],
      composed: false,
      bossDefeated: false,
      metEems: false,
      metJimbo: false,
      metBlu: false,
      pruner: false,
      pulse: false,
      extraHeart: false,
      charged: false,
      perfectHarvest: false,
      encoreUsed: false,
      totalKills: 0,
      damagingPulses: 0,
      playSeconds: 0,
      firstStageOnboarding: {
        graceConsumed: false,
        graceRemaining: 18,
        tutorialFlags: [],
        struggle: 0,
        checkpointReloads: 0
      },
      professions: {
        crafting:{xp:0,level:1}, fishing:{xp:0,level:1}, cooking:{xp:0,level:1},
        gardening:{xp:0,level:1}, exploration:{xp:0,level:1}, blocking:{xp:0,level:1},
        dodging:{xp:0,level:1}, bossHunting:{xp:0,level:1}, questing:{xp:0,level:1},
        trading:{xp:0,level:1}
      },
      craftingMaterials: {heartwood:0,sporeSilk:0,prismDust:0,tidePearl:0,echoCore:0},
      craftedItems: {},
      knownRecipes: ['field-stew','mossguard-charm','tempo-tea'],
      relationships: {},
      regionalReputation: {mossvale:0,rootsong:0,skyglass:0,moonwake:0},
      activeContracts: [],
      completedContracts: [],
      dreamEncore: {unlocked:false,rank:1,bestWave:0,runs:0,active:false},
      onlineProfile: {
        displayName:'Mossvale Player',cosmetic:'grove',rating:1000,wins:0,losses:0,
        seasonalTokens:0
      },
      pvpV2: {
        matches:0,wins:0,losses:0,knockouts:0,falls:0,playSeconds:0,
        localMatches:0,onlineMatches:0,preferredInstrument:'guitar',
        cosmetics:['mossvale-standard'],matchHistory:[]
      },
      x: HUB.x,
      y: HUB.y + 115
    };
  }

  var state = freshState();
  var started = false;
  var paused = false;
  var mapOpen = false;
  var inventoryOpen = false;
  var inventoryReturnsToPause = false;
  var inventoryCategory = 'harvest';
  var inventorySelection = 'glowweed';
  var composerOpen = false;
  var instrumentsOpen = false;
  var homeOpen = false;
  var dialogue = null;
  var pendingComposer = false;
  var lastSaveTime = 0;
  var nowTime = 0;
  var toastTimer = 0;
  var toastQueue = [];
  var shake = 0;
  var gameWonTimer = 0;
  var hudSignature = '';
  var melodyPreviewTimer = null;
  var mapAnimationTime = 0;
  var skillFilter = 'all';
  var skillZoom = 1;
  var skillPan = { x: 0, y: 0 };

  var player = {
    x: HUB.x,
    y: HUB.y + 115,
    r: 13,
    speed: 168,
    facing: -Math.PI / 2,
    moveX: 0,
    moveY: 0,
    health: 5,
    maxHealth: 5,
    invuln: 0,
    attackCooldown: 0,
    attackHeld: false,
    attackHold: 0,
    chargedThisHold: false,
    dashTimer: 0,
    dashCooldown: 0,
    dashX: 0,
    dashY: -1,
    pulseCooldown: 0,
    stepTimer: 0,
    blocking: false,
    blockStamina: 100,
    blockMaxStamina: 100,
    blockStartedAt: -99,
    guardBroken: 0,
    counterWindow: 0,
    blockFlash: 0,
    hurtTimer: 0
  };
  var equipmentVisualRuntime = {
    animationState:'idle', animationElapsed:0,
    switching:false, from:'guitar', to:'guitar', switchElapsed:0, switchDuration:0.58,
    lastRequestedAt:-99, lastPose:null, diagnosticSignature:''
  };
  var camera = { x: player.x, y: player.y };
  var keys = new Set();
  var attacks = [];
  var pulses = [];
  var particles = [];
  var particlePool = [];
  var floatingTextCount = 0;
  var projectiles = [];
  var projectilePool = [];
  var hazards = [];
  var MAX_ACTIVE_ENEMIES = 72;
  var MAX_FLOATING_TEXT = 48;
  var MAX_ENEMY_PROJECTILES = 180;
  var MAX_PROJECTILE_POOL = 180;
  // Stage-specific onboarding values. Later worlds continue using their existing
  // enemy scale and encounter rules.
  var FIRST_STAGE_BALANCE = Object.freeze({
    safeZoneRadius: 360,
    introductoryZoneRadius: 760,
    standardZoneRadius: 1250,
    minimumEnemyDistance: 340,
    minimumOffscreenSpawnDistance: 150,
    openingGracePeriodSeconds: 18,
    enemySpawnWarmupSeconds: 1.35,
    safeZoneDisengageDelaySeconds: 1.5,
    enemyHealthMultiplier: 0.86,
    enemyDamageMultiplier: 0.80,
    enemyAggressionMultiplier: 0.82,
    projectileSpeedMultiplier: 0.82,
    attackTelegraphMultiplier: 1.35,
    attackCooldownMultiplier: 1.28,
    maximumActiveEnemies: 24,
    maximumIntroAttackers: 1,
    maximumLaterAttackers: 2,
    encounterCooldownSeconds: 44,
    healingDropModifier: 1.35,
    healingDropCooldownSeconds: 7,
    mobileDodgeForgivenessSeconds: 0.09,
    mobileBlockForgivenessSeconds: 0.08,
    inputBufferSeconds: 0.16,
    adaptiveDeathThreshold: 2,
    adaptiveLowHealthThreshold: 3,
    spawnValidationRetries: 12
  });
  var firstStageRuntime = {
    graceRemaining: 0,
    respawnGrace: 0,
    safe: false,
    zone: 'final',
    attackSlots: new Set(),
    healingDropCooldown: 0,
    tutorialPromptCooldown: 0,
    movementStartX: 0,
    movementStartY: 0,
    lowHealthLatch: false,
    debugSignature: ''
  };
  var inputBuffer = { attack:0, dodge:0, block:0, interact:0 };
  var PROFESSION_IDS = ['crafting','fishing','cooking','gardening','exploration','blocking','dodging','bossHunting','questing','trading'];
  var PRODUCTION_RECIPE_IDS = [
    'field-stew','mossguard-charm','tempo-tea','heartwood-pickup','spore-tonic','prism-coil',
    'tideglass-brooch','echo-core-mod','odin-trail-mix','festival-lantern','legendary-bridge','encore-crown'
  ];
  var onlineRemotePlayers = [];
  var onlineWorldPings = [];
  var ENEMY_ROWS = { thorn: 0, slime: 1, buzz: 2, wisp: 3 };
  var ENEMY_DRAW_OPTIONS = {};
  var WISP_ENEMY_DRAW_OPTIONS = { alpha: 0.94 };
  var healthPickups = [];
  var shopOpen = false;
  var skillsOpen = false;
  var statisticsOpen = false;
  var instrumentsReturnsToPause = false;
  var homeReturnsToPause = false;
  var shopReturnsToPause = false;
  var skillsReturnsToPause = false;
  var statisticsReturnsToPause = false;
  var campaignFinaleShown = false;
  var activeBuffs = {
    speedTimer: 0,
    defenseTimer: 0,
    mapTimer: 0,
    autoCollectTimer: 0,
    odinHowlTimer: 0,
    massivePulse: false,
    bossBane: false,
    revivalReady: false
  };
  var rhythmCombo = { count:0, multiplier:1, timer:0, lastQuality:'', flash:0, beatLength:0.5 };
  var encounterDirector = {tension:0,cooldown:24,activeEvent:null,weatherTimer:0,recentDamage:0};
  var boss = null;
  var bossPadLatch = null;

  var weeds = [
    [1, 1320, 1030], [2, 1495, 1060], [3, 1215, 820], [4, 1580, 885], [5, 1370, 690],
    [6, 1170, 1110], [7, 930, 980], [8, 780, 865], [9, 650, 730], [10, 510, 1035],
    [11, 360, 930], [12, 450, 660], [13, 690, 1105], [14, 1070, 1310], [15, 920, 1425],
    [16, 1035, 1595], [17, 1165, 1545], [18, 1320, 1660], [19, 750, 1600], [20, 1515, 1300],
    [21, 1730, 1125], [22, 1910, 930], [23, 2090, 780], [24, 2230, 930], [25, 2425, 710],
    [26, 2320, 465], [27, 2020, 530], [28, 1860, 690], [29, 1975, 1250], [30, 2590, 1320]
  ].map(function (v) { return { id: 'w' + v[0], x: v[1], y: v[2] }; });

  var shrines = [
    { note: 'C', x: 1400, y: 350, title: 'Garden Chime' },
    { note: 'E', x: 360, y: 830, title: 'Bramble Bell' },
    { note: 'G', x: 1080, y: 1610, title: 'Marsh Drum' },
    { note: 'B', x: 2330, y: 520, title: 'Static Choir' }
  ];
  var drums = [
    { id: 'd1', x: 905, y: 1400, note: 'C' },
    { id: 'd2', x: 1100, y: 1435, note: 'E' },
    { id: 'd3', x: 1290, y: 1530, note: 'G' }
  ];
  var speakers = [
    { id: 's1', x: 2070, y: 780 },
    { id: 's2', x: 2440, y: 825 },
    { id: 's3', x: 2290, y: 360 }
  ];
  var npcs = [
    { id: 'jimbo', name: 'JIMBO', x: 1175, y: 930, color: '#ffb454' },
    { id: 'eems', name: 'EEMS', x: 1435, y: 880, color: '#d77cff' },
    { id: 'blu', name: 'BLU', x: 1760, y: 740, color: '#62c7ff' },
    { id: 'mara', name: 'MARA', x: 1540, y: 1110, color: '#f28c72' },
    { id: 'pip', name: 'PIP', x: 720, y: 1360, color: '#d9a85d' },
    { id: 'zephra', name: 'ZEPHRA', x: 1970, y: 470, color: '#9de8ff' },
    { id: 'nix', name: 'NIX', x: 1120, y: 560, color: '#b7a0ff' },
    { id: 'tavi', name: 'TAVI', x: 1520, y: 1570, color: '#61d8c8' },
    { id: 'luma', name: 'LUMA', x: 2190, y: 1110, color: '#ff91d5' },
    { id: 'brad', name: 'BRAD', x: 1320, y: 1180, color: '#f4d35e' }
  ];

  var stagePortals = [
    { id:'rootsong-gate', x:1660, y:1080, target:2, name:'Rootsong Hollows' }
  ];
  var STAGE_NAMES = { 1:'Mossvale Grove', 2:'Rootsong Hollows', 3:'Skyglass Reach', 4:'Moonwake Coast' };
  var STAGE_KICKERS = { 1:'STAGE I · MOSSVALE', 2:'STAGE II · ROOTSONG', 3:'STAGE III · SKYGLASS', 4:'STAGE IV · MOONWAKE' };
  var STAGE_HEARTBLOOMS = {
    1:[{x:1510,y:1015},{x:980,y:1135}],
    2:[{x:590,y:840},{x:1420,y:1030}],
    3:[{x:620,y:1010},{x:1510,y:920}],
    4:[{x:720,y:610},{x:1570,y:1120}]
  };
  var HEARTBLOOM_CAPACITY = 9;

  var BOSS_DEFS = {
    1: {
      id:'nullspeaker', assetId:'nullspeaker', name:'THE NULLSPEAKER', shortName:'Nullspeaker', spriteRow:0,
      mechanic:'sequence', color:'#ff5f83', shieldColor:'#d77cff', projectileColor:'#f05ad7',
      hp:{story:14,standard:18,hard:22},
      intro:'Strike the core. When it shields, play your gate-tone on the floor pads.',
      victory:'The Feedback Amphitheatre is silent at last.'
    },
    2: {
      id:'rootbound', assetId:'rootbound-colossus', name:'THE ROOTBOUND COLOSSUS', shortName:'Rootbound Colossus', spriteRow:1,
      mechanic:'root-knots', color:'#ffc857', shieldColor:'#c9d66b', projectileColor:'#d8a63f',
      hp:{story:18,standard:24,hard:30},
      intro:'Cut through the drumwood. Echo Pulse each glowing root knot when its shield rises.',
      victory:'The oldest roots release the road to Skyglass.'
    },
    3: {
      id:'prism-choir', assetId:'prism-choir', name:'THE PRISM CHOIR', shortName:'Prism Choir', spriteRow:2,
      mechanic:'prism-shards', color:'#62c7ff', shieldColor:'#d77cff', projectileColor:'#82dfff',
      hp:{story:20,standard:27,hard:34},
      intro:'Break the orbiting prisms with your rhythm staff whenever the choir shields.',
      victory:'The shattered choir reforms as a clear, harmless chord.'
    },
    4: {
      id:'tidebreaker', assetId:'tidebreaker', name:'THE TIDEBREAKER', shortName:'Tidebreaker', spriteRow:3,
      mechanic:'tide-surges', color:'#61d8c8', shieldColor:'#86cfff', projectileColor:'#63dfea',
      hp:{story:22,standard:30,hard:38},
      intro:'Dodge three moon-tide surges—or Pulse the open core to cut them short.',
      victory:'Moonwake settles, and all four stages answer the same beat.'
    }
  };

  function bossDefForStage(stage) {
    return BOSS_DEFS[stage] || BOSS_DEFS[1];
  }

  function bossDefeatedForStage(stage) {
    var def = bossDefForStage(stage);
    return state.stageBosses.indexOf(def.id) >= 0 || (stage === 1 && state.bossDefeated);
  }

  function bossPrerequisiteMet(stage) {
    if (stage === 1) return state.composed;
    if (stage === 2) return state.chapterRelics.indexOf('rootsong') >= 0;
    if (stage === 3) return state.chapterRelics.indexOf('skyglass') >= 0;
    return state.chapterRelics.indexOf('moonwake') >= 0;
  }

  function portalUnlocked(portal) {
    if (portal.back) return true;
    return (portal.target === 2 && bossDefeatedForStage(1)) ||
      (portal.target === 3 && bossDefeatedForStage(2)) ||
      (portal.target === 4 && bossDefeatedForStage(3));
  }

  function portalLockReason(portal) {
    if (portal.back) return '';
    if (portal.target === 2) return 'Silence the Nullspeaker to wake this gate.';
    if (portal.target === 3) return 'Defeat the Rootbound Colossus first.';
    return 'Defeat the Prism Choir first.';
  }

  var odin = {
    x: HUB.x - 42, y: HUB.y + 125, facing: 0, moving: false, sniffing: false,
    command: 'follow', biteCooldown: 0, pounceCooldown: 0, howlCooldown: 0,
    guardianCooldown: 0, spiritTimer: 0, attackFlash: 0, attackDuration: 0, target: null,
    targetScanTimer: 0,
    followAngle: player.facing, motionGrace: 0, gait: 0, spriteColumn: 3,
    directionCandidate: 3, directionHold: 0, animState:'idle', animTime:0,
    activity:'', activityTimer:0, idleActionCooldown:3
  };
  var ODIN_TARGET_SCAN_INTERVAL = 0.12;
  var ODIN_EXPANDED_ACTIONS = new Set([
    'sleep','sit','roll','happy','excited','eat','drink','dig','sniff','play',
    'guard','growl','attack','dash','carry_item','celebrate','petting_reaction','spirit_howl'
  ]);
  var ODIN_DRAW_OPTIONS = Object.freeze({});

  /*
   * Odin's generated cells do not share a common internal origin. These
   * measurements align every world pose by its visible horizontal center and
   * foot line, preventing a pose or direction change from shifting the dog.
   * Row 3 contains dialogue portraits and is intentionally never used here.
   */
  var ODIN_CELL_METRICS = [
    [{cx:161,bottom:308},{cx:149,bottom:314},{cx:162,bottom:308},{cx:126,bottom:308}],
    [{cx:160,bottom:293},{cx:132,bottom:296},{cx:146,bottom:262},{cx:137,bottom:270}],
    [{cx:149,bottom:249},{cx:140,bottom:313},{cx:132,bottom:313},{cx:147,bottom:240}]
  ];
  var ODIN_CELL_SIZE = 313.5;

  function resetOdinVisuals() {
    odin.facing = player.facing;
    odin.followAngle = player.facing;
    odin.moving = false;
    odin.sniffing = false;
    odin.motionGrace = 0;
    odin.gait = 0;
    odin.attackFlash = 0;
    odin.attackDuration = 0;
    odin.target = null;
    odin.targetScanTimer = 0;
    odin.spriteColumn = facingColumn(odin.facing);
    odin.directionCandidate = odin.spriteColumn;
    odin.directionHold = 0;
    odin.animState = 'idle';
    odin.animTime = 0;
    odin.activity = '';
    odin.activityTimer = 0;
    odin.idleActionCooldown = 3;
  }

  function triggerOdinAttack(duration, action) {
    odin.attackDuration = Math.max(0.01, duration);
    odin.attackFlash = odin.attackDuration;
    odin.activity = action || 'attack';
    odin.activityTimer = odin.attackDuration;
    setAnimationState(odin, odin.activity);
  }

  function updateOdinSpriteDirection(dt) {
    if (odin.attackFlash > 0) return;
    var candidate = facingColumn(odin.facing);
    if (candidate === odin.spriteColumn) {
      odin.directionCandidate = candidate;
      odin.directionHold = 0;
      return;
    }
    if (candidate !== odin.directionCandidate) {
      odin.directionCandidate = candidate;
      odin.directionHold = 0;
      return;
    }
    odin.directionHold += dt;
    if (odin.directionHold >= 0.075) {
      odin.spriteColumn = candidate;
      odin.directionHold = 0;
    }
  }

  function drawOdinSpriteCell(row, col, x, footY, size, alpha) {
    var metric = ODIN_CELL_METRICS[row] && ODIN_CELL_METRICS[row][col];
    if (!metric) return drawSpriteCell('odin', row, col, x, footY, size, 0.72, alpha);
    var alignedX = x - (metric.cx / ODIN_CELL_SIZE - 0.5) * size;
    return drawSpriteCell('odin', row, col, alignedX, footY, size, metric.bottom / ODIN_CELL_SIZE, alpha);
  }

  var INVENTORY_CATEGORIES = [
    { id: 'harvest', label: 'Harvest' },
    { id: 'supplies', label: 'Supplies' },
    { id: 'songbook', label: 'Songbook' },
    { id: 'gear', label: 'Gear' },
    { id: 'quest', label: 'Quest' }
  ];
  var INVENTORY_ITEMS = [
    { id: 'glowweed', name: 'Glowweed', category: 'harvest', row: 0, col: 0, color: '#7df7a1',
      description: 'Bright sprigs that lean toward music and hop into a nearby satchel.', unlocked: function () { return state.weeds.length > 0; },
      quantity: function () { return state.weeds.length + ' / 30'; }, meta: function () { return 'Next grove gift: ' + (state.weeds.length < 6 ? 'Pruner Edge at 6' : state.weeds.length < 14 ? 'Grove Heart at 14' : state.weeds.length < 24 ? 'Charged Cleave at 24' : state.weeds.length < 30 ? 'Golden Bloom at 30' : 'Perfect harvest complete'); } },
    { id: 'golden-bloom', name: 'Golden Bloom', category: 'harvest', row: 0, col: 1, color: '#f6e36d',
      description: 'The grove\'s answer to a perfect harvest. It will join the final song.', unlocked: function () { return state.perfectHarvest; }, meta: function () { return 'Legendary harvest keepsake'; } },
    { id: 'grove-heart', name: 'Grove Heart', category: 'harvest', row: 0, col: 2, color: '#ff7892',
      description: 'A living moss charm that strengthened your maximum health.', unlocked: function () { return state.extraHeart; }, meta: function () { return '+1 maximum heart'; } },
    { id: 'field-pack', name: 'Field Backpack', category: 'harvest', row: 0, col: 3, color: '#56f0c4',
      description: 'A weatherproof satchel for songs, tools, and luminous plants.', unlocked: function () { return true; }, meta: function () { return 'No weight limit. Adventure should feel adventurous.'; } },
    { id: 'pocket-heartbloom', name: 'Pocket Heartbloom', category: 'supplies', row: 0, col: 2, color: '#ff7892',
      description: 'A fresh healing bloom kept safely in your medicine pouch until you need it.',
      unlocked: function () { return state.heartblooms > 0 || state.statistics.healingItemsCollected > 0; },
      quantity: function () { return state.heartblooms + ' / ' + HEARTBLOOM_CAPACITY; },
      meta: function () {
        if (!state.heartblooms) return 'Pouch empty · collect glowing hearts in the field';
        if (player.health >= player.maxHealth) return 'Health full · saved for later';
        var critical = player.health <= Math.max(1, Math.floor(player.maxHealth / 2));
        var amount = critical && state.skills.indexOf('grove-vitality') >= 0 ? 2 : 1;
        if (state.purchases.indexOf('heartbloom-pouch') >= 0) amount += 1;
        if (activeResonance('nature')) amount += 1;
        return 'Restores ' + amount + (amount === 1 ? ' heart' : ' hearts') + ' · ' + state.heartblooms + ' stored';
      },
      actionLabel: 'Use Heartbloom', unavailableLabel: function () {
        return !state.heartblooms ? 'Pouch empty' : 'Health already full';
      },
      canUse: function () { return state.heartblooms > 0 && player.health < player.maxHealth; },
      action: useStoredHeartbloom },
    { id: 'note-c', name: 'Garden Chime C', category: 'songbook', row: 1, col: 0, color: NOTE_COLORS.C,
      description: 'A clear mint note recovered from the moon garden.', unlocked: function () { return state.notes.indexOf('C') >= 0; }, actionLabel: 'Play note C', action: function () { audioCall('previewNote', 'C'); } },
    { id: 'note-e', name: 'Bramble Bell E', category: 'songbook', row: 1, col: 1, color: NOTE_COLORS.E,
      description: 'A warm golden note freed from the western brambles.', unlocked: function () { return state.notes.indexOf('E') >= 0; }, actionLabel: 'Play note E', action: function () { audioCall('previewNote', 'E'); } },
    { id: 'note-g', name: 'Marsh Drum G', category: 'songbook', row: 1, col: 2, color: NOTE_COLORS.G,
      description: 'A deep blue note awakened by the Lowtone drums.', unlocked: function () { return state.notes.indexOf('G') >= 0; }, actionLabel: 'Play note G', action: function () { audioCall('previewNote', 'G'); } },
    { id: 'note-b', name: 'Static Choir B', category: 'songbook', row: 1, col: 3, color: NOTE_COLORS.B,
      description: 'A violet note tuned out of the eastern static.', unlocked: function () { return state.notes.indexOf('B') >= 0; }, actionLabel: 'Play note B', action: function () { audioCall('previewNote', 'B'); } },
    { id: 'rhythm-staff', name: 'Instrument Case', category: 'gear', row: 2, col: 0, color: '#eaf7d8',
      description: 'A modular case for six fully playable instruments, their legendary forms, and every mastery path.', unlocked: function () { return true; },
      meta: function () { return equippedInstrument().name + ' equipped · Mastery ' + instrumentMasteryRecord(state.equippedInstrument).level + '/10'; },
      actionLabel:'Open Instrument Mastery',action:function(){closeInventory();window.requestAnimationFrame(openInstruments);} },
    { id: 'pruner-edge', name: 'Pruner Edge', category: 'gear', row: 2, col: 1, color: '#ffc857',
      description: 'Jimbo\'s tuned pruning edge now slots into every physical instrument as a workshop modification.', unlocked: function () { return state.pruner; }, meta: function () { return 'Universal instrument mod · tuned by Jimbo'; } },
    { id: 'echo-pulse', name: 'Resonance Pulse', category: 'gear', row: 2, col: 2, color: '#62c7ff',
      description: 'Blu\'s quiet lesson made visible: a wave that wakes drums and breaks spectral shields.', unlocked: function () { return state.pulse; }, meta: function () { return touchCapable ? 'Use the Pulse action' : 'Q / L to pulse'; } },
    { id: 'charged-cleave', name: 'Harvest Capacitor', category: 'gear', row: 2, col: 1, color: '#ffd66b',
      description: 'Stored harvest energy adds another damage tier to every instrument’s unique charged attack.', unlocked: function () { return state.charged; }, meta: function () { return 'Hold Strike · charged attacks deal +1 damage'; } },
    { id: 'blu-keepsake', name: 'Blu\'s Bell', category: 'quest', row: 2, col: 2, color: '#62c7ff',
      description: 'A tiny bell that only rings when the space between notes is just right.', unlocked: function () { return state.metBlu; }, meta: function () { return 'A reminder to leave room for silence'; } },
    { id: 'jimbo-keepsake', name: 'Jimbo\'s Leaf Pin', category: 'quest', row: 0, col: 2, color: '#ffb454',
      description: 'A sturdy little pin from Mossvale\'s most enthusiastic gardener.', unlocked: function () { return state.metJimbo; }, meta: function () { return 'Soil says hello'; } },
    { id: 'eems-mossbox', name: 'EEMS Mossbox', category: 'quest', row: 2, col: 3, color: '#d77cff',
      description: 'A pocket loop machine holding every recovered frequency.', unlocked: function () { return state.metEems; }, meta: function () { return state.notes.length + ' / 4 frequencies recovered'; },
      actionLabel: 'Open composer', action: function () { if (hasAllNotes()) { closeInventory(); openComposer(); } else audioCall('sfx', 'error'); } },
    { id: 'gate-tone', name: 'Eight-Beat Gate-Tone', category: 'quest', row: 1, col: 3, color: '#e39bff',
      description: 'Your own arrangement. The Feedback Amphitheatre knows its shape.', unlocked: function () { return state.composed; }, meta: function () { return state.melody.join(' · '); },
      actionLabel: 'Play gate-tone', action: function () { audioCall('playMelody', state.melody); } },
    { id:'beatcoin-pouch', name:'Beatcoin Pouch', category:'gear', row:3, col:0, color:'#f4d35e',
      description:'Brad accepts these warm, humming coins for field supplies and upgrades.', unlocked:function(){return true;}, meta:function(){return state.beatcoins + ' Beatcoins';} },
    { id:'rootsong-relic', name:'Rootsong Record', category:'quest', row:3, col:1, color:'#d9a85d',
      description:'A bass-heavy wooden record cut from the oldest singing root.', unlocked:function(){return state.chapterRelics.indexOf('rootsong')>=0;}, meta:function(){return bossDefeatedForStage(2) ? 'Stage II complete' : 'The Rootbound arena is open';} },
    { id:'skyglass-relic', name:'Skyglass Prism', category:'quest', row:3, col:2, color:'#9de8ff',
      description:'A clear prism holding the chord that rebuilt the wind bridge.', unlocked:function(){return state.chapterRelics.indexOf('skyglass')>=0;}, meta:function(){return bossDefeatedForStage(3) ? 'Stage III complete' : 'The Prism arena is open';} },
    { id:'moonwake-relic', name:'Moonwake Shell', category:'quest', row:3, col:3, color:'#61d8c8',
      description:'Three tide-songs braided into one shell that never stops humming.', unlocked:function(){return state.chapterRelics.indexOf('moonwake')>=0;}, meta:function(){return bossDefeatedForStage(4) ? 'Stage IV complete' : 'The Tidebreaker arena is open';} }
  ];

  var ENEMY_SPECIES = {
    1: [
      {id:'forest-wolf',name:'Forest Wolf',type:'thorn',ai:'charger',weakness:'guitar',loot:'Wolfmoss'},
      {id:'living-bush',name:'Living Bush',type:'slime',ai:'turret',weakness:'bass',loot:'Bramble Fibre'},
      {id:'sapling-guardian',name:'Sapling Guardian',type:'thorn',ai:'skirmisher',weakness:'violin',loot:'Young Root'},
      {id:'spore-bat',name:'Spore Bat',type:'buzz',ai:'swoop',weakness:'synth',loot:'Spore Dust'},
      {id:'moss-slime',name:'Moss Slime',type:'slime',ai:'splitter',weakness:'drums',loot:'Moss Gel'},
      {id:'musical-beetle',name:'Musical Beetle',type:'buzz',ai:'orbiter',weakness:'microphone',loot:'Chime Shell'},
      {id:'flower-hopper',name:'Flower Hopper',type:'buzz',ai:'swoop',weakness:'guitar',loot:'Spring Petal'},
      {id:'thorn-crawler',name:'Thorn Crawler',type:'thorn',ai:'ambusher',weakness:'drums',loot:'Crawler Thorn'},
      {id:'wood-sprite',name:'Wood Sprite',type:'wisp',ai:'support',weakness:'microphone',loot:'Spirit Bark'},
      {id:'bark-guardian',name:'Bark Guardian',type:'thorn',ai:'guardian',weakness:'bass',loot:'Bark Plate'}
    ],
    2: [
      {id:'root-beast',name:'Root Beast',type:'thorn',ai:'charger',weakness:'bass',loot:'Iron Root'},
      {id:'fungus-shaman',name:'Fungus Shaman',type:'wisp',ai:'support',weakness:'synth',loot:'Amber Cap'},
      {id:'bone-crow',name:'Bone Crow',type:'buzz',ai:'swoop',weakness:'guitar',loot:'Hollow Feather'},
      {id:'root-spider',name:'Root Spider',type:'thorn',ai:'ambusher',weakness:'drums',loot:'Root Silk'},
      {id:'corrupted-stag',name:'Corrupted Stag',type:'thorn',ai:'charger',weakness:'violin',loot:'Fungal Antler'},
      {id:'toxic-bloom',name:'Toxic Bloom',type:'slime',ai:'turret',weakness:'microphone',loot:'Toxic Petal'},
      {id:'rot-slime',name:'Rot Slime',type:'slime',ai:'splitter',weakness:'drums',loot:'Rot Gel'},
      {id:'spore-mage',name:'Spore Mage',type:'wisp',ai:'support',weakness:'synth',loot:'Mage Cap'},
      {id:'hollow-knight',name:'Hollow Knight',type:'thorn',ai:'guardian',weakness:'bass',loot:'Hollow Plate'},
      {id:'ancient-root',name:'Ancient Root',type:'thorn',ai:'ambusher',weakness:'violin',loot:'Ancient Fibre'}
    ],
    3: [
      {id:'crystal-sentinel',name:'Crystal Sentinel',type:'thorn',ai:'guardian',weakness:'bass',loot:'Sentinel Shard'},
      {id:'storm-wisp',name:'Storm Wisp',type:'wisp',ai:'storm',weakness:'guitar',loot:'Storm Spark'},
      {id:'flying-shard',name:'Flying Shard',type:'buzz',ai:'swoop',weakness:'synth',loot:'Wing Crystal'},
      {id:'sky-serpent',name:'Sky Serpent',type:'buzz',ai:'orbiter',weakness:'violin',loot:'Cloud Scale'},
      {id:'crystal-golem',name:'Crystal Golem',type:'slime',ai:'guardian',weakness:'drums',loot:'Prism Core'},
      {id:'lightning-moth',name:'Lightning Moth',type:'buzz',ai:'storm',weakness:'microphone',loot:'Static Wing'},
      {id:'crystal-wolf',name:'Crystal Wolf',type:'thorn',ai:'charger',weakness:'bass',loot:'Crystal Fang'},
      {id:'floating-eye',name:'Floating Eye',type:'wisp',ai:'storm',weakness:'synth',loot:'Lens Shard'},
      {id:'glass-beetle',name:'Glass Beetle',type:'buzz',ai:'orbiter',weakness:'guitar',loot:'Glass Wing'},
      {id:'storm-elemental',name:'Storm Elemental',type:'wisp',ai:'storm',weakness:'microphone',loot:'Storm Core'}
    ],
    4: [
      {id:'ghost-sailor',name:'Ghost Sailor',type:'wisp',ai:'skirmisher',weakness:'microphone',loot:'Ghost Coin'},
      {id:'moon-crab',name:'Moon Crab',type:'thorn',ai:'guardian',weakness:'bass',loot:'Moon Shell'},
      {id:'deep-eel',name:'Deep Eel',type:'buzz',ai:'ambusher',weakness:'guitar',loot:'Lumen Scale'},
      {id:'coral-guardian',name:'Coral Guardian',type:'thorn',ai:'guardian',weakness:'drums',loot:'Living Coral'},
      {id:'spectral-jellyfish',name:'Spectral Jellyfish',type:'wisp',ai:'storm',weakness:'synth',loot:'Spectral Gel'},
      {id:'tidal-spirit',name:'Tidal Spirit',type:'slime',ai:'splitter',weakness:'violin',loot:'Tide Pearl'},
      {id:'sea-wraith',name:'Sea Wraith',type:'wisp',ai:'skirmisher',weakness:'microphone',loot:'Wraith Sail'},
      {id:'moon-owl',name:'Moon Owl',type:'buzz',ai:'swoop',weakness:'violin',loot:'Moon Feather'},
      {id:'shell-golem',name:'Shell Golem',type:'thorn',ai:'guardian',weakness:'bass',loot:'Shell Plate'},
      {id:'leviathan-spawn',name:'Leviathan Spawn',type:'slime',ai:'ambusher',weakness:'drums',loot:'Deep Scale'}
    ]
  };
  var ELITE_VARIANTS = [
    {id:'golden-slime',name:'Golden Slime',color:'#f6e36d'},
    {id:'ancient-treant',name:'Ancient Treant',color:'#a9f58b'},
    {id:'echo-knight',name:'Echo Knight',color:'#d77cff'},
    {id:'crystal-alpha',assetId:'crystal-alpha-wolf',name:'Crystal Alpha',color:'#9de8ff'},
    {id:'moon-revenant',name:'Moon Revenant',color:'#86e8ff'},
    {id:'forest-colossus',name:'Forest Colossus',color:'#7df7a1'},
    {id:'storm-conductor',name:'Storm Conductor',color:'#62c7ff'},
    {id:'ancient-mycelium',name:'Ancient Mycelium',color:'#ff9d57'}
  ];
  var MINIBOSS_DEFS = [
    {id:'forest-guardian',stage:1,name:'FOREST GUARDIAN',x:520,y:430,species:2,hp:18,pattern:'roots',color:'#7df7a1',loot:'Guardian Rosette'},
    {id:'groove-beetle',stage:1,name:'GROOVE BEETLE PRIME',x:2520,y:1030,species:5,hp:16,pattern:'notes',color:'#f6e36d',loot:'Golden Chime Shell'},
    {id:'mushroom-colossus',stage:2,name:'MUSHROOM COLOSSUS',x:680,y:1120,species:1,hp:24,pattern:'spores',color:'#ff9d57',loot:'Colossus Cap'},
    {id:'echo-conductor',stage:2,name:'ECHO CONDUCTOR',x:1480,y:280,species:2,hp:21,pattern:'notes',color:'#d77cff',loot:'Broken Baton'},
    {id:'crystal-dragon',stage:3,name:'CRYSTAL DRAGON',x:760,y:1160,species:3,hp:27,pattern:'storm',color:'#9de8ff',loot:'Dragon Prism'},
    {id:'storm-harpist',stage:3,name:'STORM HARPIST',x:1660,y:260,species:5,hp:22,pattern:'storm',color:'#62c7ff',loot:'Stormsilk Wing'},
    {id:'moon-leviathan',stage:4,name:'MOON LEVIATHAN',x:760,y:850,species:2,hp:30,pattern:'tides',color:'#86e8ff',loot:'Leviathan Scale'},
    {id:'coral-oracle',stage:4,name:'CORAL ORACLE',x:1970,y:1040,species:3,hp:25,pattern:'tides',color:'#ff91d5',loot:'Oracle Coral'},
    {id:'root-titan',stage:2,name:'ROOT TITAN',x:1850,y:350,species:7,hp:28,pattern:'roots',color:'#d9a85d',loot:'Titan Heartwood'},
    {id:'storm-phoenix',stage:3,name:'STORM PHOENIX',x:1900,y:1080,species:8,hp:29,pattern:'storm',color:'#86e8ff',loot:'Phoenix Conductor'},
    {id:'ancient-guitar-golem',stage:4,name:'ANCIENT GUITAR GOLEM',x:1050,y:360,species:9,hp:32,pattern:'notes',color:'#d77cff',loot:'Ancient Pickup'}
  ];

  var enemyBlueprints = [
    ['br1', 'thorn', 630, 770, 'bramble'], ['br2', 'thorn', 515, 930, 'bramble'],
    ['br3', 'slime', 400, 1010, 'bramble'], ['br4', 'buzz', 320, 700, 'bramble'],
    ['blu1', 'thorn', 1705, 690, 'blu'], ['blu2', 'buzz', 1815, 700, 'blu'],
    ['m1', 'slime', 885, 1330, 'marsh'], ['m2', 'buzz', 1220, 1370, 'marsh'],
    ['m3', 'slime', 1320, 1620, 'marsh'], ['m4', 'thorn', 830, 1590, 'marsh'],
    ['s1e', 'wisp', 2070, 650, 'static'], ['s2e', 'slime', 2190, 860, 'static'],
    ['s3e', 'wisp', 2435, 650, 'static'], ['s4e', 'buzz', 2320, 930, 'static'],
    ['r1', 'thorn', 1650, 1180, 'wild'], ['r2', 'buzz', 1890, 1070, 'wild']
  ];
  var enemies = [];

  function stageEnemyScale() {
    var stage = clamp(Number(state.stage) || 1, 1, 4);
    return {
      healthBonus: stage - 1,
      speed: 1 + (stage - 1) * 0.12,
      cooldown: 1 - (stage - 1) * 0.09,
      projectileSpeed: 1 + (stage - 1) * 0.1,
      power: stage >= 4 ? 2 : 1
    };
  }

  function makeEnemy(data, blueprintIndex) {
    var stageSpecies = ENEMY_SPECIES[state.stage] || ENEMY_SPECIES[1];
    var speciesIndex = Math.abs(Number(blueprintIndex) || 0) % stageSpecies.length;
    var species = stageSpecies[speciesIndex];
    var type = species.type || data[1];
    var baseHp = type === 'slime' ? 3 : type === 'wisp' ? 2 : type === 'thorn' ? 2 : 1;
    var scaling = stageEnemyScale();
    var hash = String(data[0]).split('').reduce(function (sum, letter) { return sum + letter.charCodeAt(0); }, state.stage * 17);
    var elite = hash % 11 === 0;
    var eliteDef = elite ? ELITE_VARIANTS[(hash + state.stage) % ELITE_VARIANTS.length] : null;
    var hp = baseHp + scaling.healthBonus + (elite ? 4 : 0);
    return {
      id: data[0], type: type, x: data[2], y: data[3], homeX: data[2], homeY: data[3],
      group: data[4], r: (type === 'slime' ? 18 : 14) + (elite ? 7 : 0), hp: hp, maxHp: hp, dead: false,
      mode: 'idle', timer: Math.random() * 1.5, cooldown: (0.4 + Math.random()) * scaling.cooldown, angle: Math.random() * 6.28,
      vx: 0, vy: 0, stun: 0, flash: 0, shielded: type === 'wisp',
      stageScale: scaling.speed, projectileScale: scaling.projectileSpeed, power: scaling.power, elite: elite,
      eliteId: eliteDef && eliteDef.id, eliteName: eliteDef && eliteDef.name, eliteColor: eliteDef && eliteDef.color,
      eliteAssetId: eliteDef && (eliteDef.assetId || eliteDef.id),
      speciesId: species.id, name: species.name, ai: species.ai, weakness: species.weakness, loot: species.loot,
      speciesIndex:speciesIndex, splitGeneration:0, splitTriggered:false,
      atlasRow: state.stage - 1, atlasCol: speciesIndex, armorBroken:0, bleedTimer:0, bleedTick:0,
      facing:0, animState:'spawn', animTime:0, animLock:0.72, deathTimer:null, deathDuration:1.3
    };
  }
  function resetEnemies() {
    enemies = [];
    enemyBlueprints.forEach(function (blueprint, index) {
      var enemy = makeEnemy(blueprint, index);
      prepareEnemyForSpawn(enemy, { fixed:true, playerPosition:currentLevel && currentLevel.spawn });
      enemies.push(enemy);
    });
    var gone = new Set(state.defeated || []);
    enemies.forEach(function (e) { if (gone.has(e.id)) e.dead = true; });
    MINIBOSS_DEFS.filter(function (definition) {
      return definition.stage === state.stage && state.miniBossesDefeated.indexOf(definition.id) < 0;
    }).forEach(function (definition,index) {
      var mini = makeEnemy(['miniboss_' + definition.id,'thorn',definition.x,definition.y,'miniboss'],definition.species);
      mini.isMiniBoss = true;
      mini.miniBossId = definition.id;
      mini.name = definition.name;
      mini.hp = mini.maxHp = definition.hp + (settings.difficulty === 'hard' ? 8 : settings.difficulty === 'story' ? -4 : 0);
      mini.r = 32;
      mini.power = state.stage >= 3 ? 2 : 1;
      mini.miniPattern = definition.pattern;
      mini.miniColor = definition.color;
      mini.assetId = definition.id === 'groove-beetle' ? 'groove-beetle-prime' : definition.id;
      mini.loot = definition.loot;
      mini.shielded = false;
      mini.elite = false;
      mini.cooldown = 1.1 + index*.35;
      prepareEnemyForSpawn(mini, { fixed:true, playerPosition:currentLevel && currentLevel.spawn });
      enemies.push(mini);
    });
  }

  var obstacles = [
    { x: 100, y: 180, r: 110 }, { x: 330, y: 230, r: 95 }, { x: 650, y: 250, r: 85 },
    { x: 930, y: 190, r: 100 }, { x: 1120, y: 170, r: 75 }, { x: 1680, y: 200, r: 90 },
    { x: 1900, y: 250, r: 115 }, { x: 2570, y: 280, r: 120 }, { x: 2670, y: 620, r: 110 },
    { x: 120, y: 620, r: 105 }, { x: 115, y: 1190, r: 130 }, { x: 310, y: 1350, r: 90 },
    { x: 520, y: 1500, r: 85 }, { x: 560, y: 1770, r: 130 }, { x: 1530, y: 1770, r: 110 },
    { x: 1780, y: 1610, r: 85 }, { x: 2690, y: 1050, r: 110 }, { x: 2680, y: 1770, r: 125 },
    { x: 720, y: 480, r: 48 }, { x: 900, y: 610, r: 42 }, { x: 1910, y: 480, r: 52 },
    { x: 2020, y: 1020, r: 48 }, { x: 700, y: 1230, r: 55 }, { x: 1470, y: 1430, r: 58 },
    { x: 1080, y: 700, r: 38 }, { x: 1640, y: 985, r: 42 }, { x: 1235, y: 585, r: 34 },
    { x: 1580, y: 605, r: 43 }, { x: 1030, y: 1070, r: 36 }, { x: 1720, y: 875, r: 34 }
  ];
  var waterPools = [
    { x: 850, y: 1500, rx: 145, ry: 85 },
    { x: 1325, y: 1460, rx: 135, ry: 80 },
    { x: 2120, y: 1030, rx: 105, ry: 60 }
  ];

  var decorations = [];
  var stageTokens = [];
  var collectibles = [];
  var currentLevel = null;


  var COLLECTIBLE_SETS = {
    mossvale:{name:'Lost Mixtapes', reward:'Mixtape Mastery', color:'#f6e36d'},
    rootsong:{name:'Root Runes', reward:'Rootguard Charm', color:'#ffc857'},
    skyglass:{name:'Prism Fragments', reward:'Prismatic Tempo', color:'#9de8ff'},
    moonwake:{name:'Moon Pearls', reward:'Tidal Fortune', color:'#86e8ff'}
  };
  function collectibleSetCount(setId) {
    return allLevelItems('collectibles').filter(function(c){return c.set===setId;}).length;
  }
  function collectedSetCount(setId) {
    return allLevelItems('collectibles').filter(function(c){return c.set===setId && state.collectibles.indexOf(c.id)>=0;}).length;
  }

  var LEVELS = {
    1: {
      id:1, name:'Mossvale Grove', world:{w:2800,h:1900}, spawn:{x:1400,y:1045}, hub:{x:1400,y:930}, boss:{x:2325,y:1510}, seed:90421,
      weeds:weeds, shrines:shrines, drums:drums, speakers:speakers,
      npcs:npcs.filter(function (n) { return ['jimbo','eems','blu','mara','nix','brad'].indexOf(n.id) >= 0; }),
      enemies:enemyBlueprints, obstacles:obstacles, water:waterPools, tokens:[], collectibles:[{id:'mix-1',set:'mossvale',x:610,y:540,label:'Fernside Demo'},{id:'mix-2',set:'mossvale',x:1030,y:1460,label:'Marsh Session'},{id:'mix-3',set:'mossvale',x:2080,y:700,label:'Static Bootleg'},{id:'mix-4',set:'mossvale',x:2470,y:1250,label:'Afterglow Tape'}], portals:stagePortals,
      labels:[[1400,610,'MOSSVALE GROVE'],[470,520,'BRAMBLEBEAT THICKET'],[1040,1260,'LOWTONE MARSH'],[2300,1070,'STATIC WILDS'],[2325,1190,'FEEDBACK AMPHITHEATRE']],
      zones:[[500,850,620,610,'rgba(41,72,52,0.98)','rgba(30,57,45,0.84)'],[1400,880,690,610,'rgba(36,82,64,0.98)','rgba(29,68,55,0.86)'],[1080,1540,690,560,'rgba(19,67,72,0.98)','rgba(20,57,61,0.86)'],[2280,690,640,650,'rgba(31,43,79,0.98)','rgba(26,38,66,0.84)'],[2310,1510,620,530,'rgba(68,35,66,0.98)','rgba(52,34,56,0.84)']],
      routes:[[1400,930,1350,625,1400,350],[1400,930,900,780,360,830],[1400,930,1190,1240,1080,1610],[1400,930,1920,820,2330,520],[1780,1100,2050,1330,2325,1510]],
      palette:{ground:'#102c29',fade:'rgba(16,44,41,0)',routeOuter:'rgba(33,70,57,0.9)',route:'#75694f',routeGlow:'rgba(185,164,116,0.22)',border:'#426b57',waterA:'#2a7180',waterB:'#123d50',waterLine:'#56a2a0',grass:['#3f7857','#376c50'],flowers:['#8fe3c1','#8fb6ff','#e28adb','#ffbe70'],obstacle:'tree'}
    },
    2: {
      id:2, name:'Rootsong Hollows', world:{w:2200,h:1500}, spawn:{x:220,y:750}, hub:{x:220,y:750}, boss:{x:1800,y:750}, seed:22881,
      weeds:[], shrines:[],
      drums:[{id:'rh-d1',x:650,y:390,note:'C'},{id:'rh-d2',x:1090,y:790,note:'E'},{id:'rh-d3',x:1540,y:410,note:'G'}], speakers:[],
      npcs:[{id:'pip',name:'PIP',x:1800,y:1190,color:'#d9a85d'},{id:'nix',name:'NIX',x:1080,y:1120,color:'#b7a0ff'}],
      enemies:[['rh1','thorn',520,610,'rootsong'],['rh2','slime',720,510,'rootsong'],['rh3','buzz',920,890,'rootsong'],['rh4','thorn',1210,620,'rootsong'],['rh5','slime',1430,530,'rootsong'],['rh6','wisp',1560,1170,'rootsong'],['rh7','buzz',1500,450,'rootsong'],['rh8','slime',1300,1110,'rootsong'],['rh9','thorn',1040,460,'rootsong'],['rh10','wisp',1840,1060,'rootsong']],
      obstacles:[{x:180,y:160,r:105},{x:480,y:150,r:90},{x:790,y:170,r:82},{x:1190,y:150,r:100},{x:1580,y:150,r:92},{x:2040,y:170,r:115},{x:170,y:1320,r:120},{x:520,y:1340,r:95},{x:920,y:1320,r:105},{x:1450,y:1330,r:120},{x:2040,y:1310,r:120},{x:800,y:680,r:48},{x:1280,y:410,r:52},{x:1510,y:980,r:58},{x:470,y:980,r:48}],
      water:[{x:820,y:1080,rx:145,ry:70},{x:1370,y:730,rx:120,ry:62}], tokens:[], collectibles:[{id:'rune-1',set:'rootsong',x:440,y:1160,label:'Low Root Rune'},{id:'rune-2',set:'rootsong',x:980,y:340,label:'Humming Rune'},{id:'rune-3',set:'rootsong',x:1460,y:930,label:'Bass Rune'},{id:'rune-4',set:'rootsong',x:1920,y:420,label:'Elder Rune'}],
      portals:[{id:'rh-return',x:110,y:750,target:1,name:'Mossvale Grove',back:true},{id:'skyglass-gate',x:2070,y:750,target:3,name:'Skyglass Reach'}],
      labels:[[1080,235,'ROOTSONG HOLLOWS'],[620,330,'HUMMING ROOTS'],[1390,1160,'BASSMOSS DEEP']],
      zones:[[620,620,630,520,'rgba(72,65,38,0.98)','rgba(54,53,35,0.86)'],[1280,720,720,600,'rgba(47,73,40,0.98)','rgba(41,59,36,0.86)'],[1780,740,470,500,'rgba(75,49,34,0.98)','rgba(55,43,34,0.82)']],
      routes:[[220,750,480,500,650,390],[650,390,850,620,1090,790],[1090,790,1320,540,1540,410],[1090,790,1450,850,1790,740],[1790,740,1940,750,2070,750]],
      palette:{ground:'#24291f',fade:'rgba(36,41,31,0)',routeOuter:'rgba(74,62,38,0.9)',route:'#8b7145',routeGlow:'rgba(246,201,105,0.24)',border:'#6c6138',waterA:'#526f4c',waterB:'#223f35',waterLine:'#8ab879',grass:['#8a8245','#656d39'],flowers:['#ffd66b','#d9a85d','#8fe08c','#e69b67'],obstacle:'root'}
    },
    3: {
      id:3, name:'Skyglass Reach', world:{w:2200,h:1500}, spawn:{x:220,y:750}, hub:{x:220,y:750}, boss:{x:1800,y:750}, seed:77331,
      weeds:[], shrines:[], drums:[],
      speakers:[{id:'sg-s1',x:650,y:390},{id:'sg-s2',x:1110,y:790},{id:'sg-s3',x:1570,y:420}],
      npcs:[{id:'zephra',name:'ZEPHRA',x:1810,y:1190,color:'#9de8ff'},{id:'luma',name:'LUMA',x:1080,y:1120,color:'#ff91d5'}],
      enemies:[['sg1','wisp',520,560,'skyglass'],['sg2','buzz',730,510,'skyglass'],['sg3','wisp',930,900,'skyglass'],['sg4','thorn',1200,600,'skyglass'],['sg5','buzz',1440,530,'skyglass'],['sg6','wisp',1600,1180,'skyglass'],['sg7','slime',1500,460,'skyglass'],['sg8','buzz',1320,1130,'skyglass'],['sg9','thorn',1060,430,'skyglass'],['sg10','wisp',1880,1040,'skyglass']],
      obstacles:[{x:170,y:150,r:95},{x:480,y:155,r:80},{x:790,y:145,r:88},{x:1200,y:155,r:92},{x:1580,y:145,r:86},{x:2040,y:170,r:108},{x:170,y:1325,r:110},{x:520,y:1340,r:90},{x:920,y:1320,r:100},{x:1450,y:1335,r:105},{x:2040,y:1320,r:115},{x:820,y:690,r:45},{x:1290,y:430,r:50},{x:1500,y:1000,r:54},{x:480,y:1010,r:44}],
      water:[{x:820,y:1090,rx:155,ry:72},{x:1390,y:735,rx:130,ry:64},{x:1020,y:315,rx:90,ry:48}], tokens:[], collectibles:[{id:'prism-1',set:'skyglass',x:460,y:1130,label:'Azure Fragment'},{id:'prism-2',set:'skyglass',x:910,y:350,label:'Rose Fragment'},{id:'prism-3',set:'skyglass',x:1390,y:980,label:'Violet Fragment'},{id:'prism-4',set:'skyglass',x:1900,y:430,label:'Choir Fragment'}],
      portals:[{id:'sg-return',x:110,y:750,target:2,name:'Rootsong Hollows',back:true},{id:'moonwake-gate',x:2070,y:750,target:4,name:'Moonwake Coast'}],
      labels:[[1090,235,'SKYGLASS REACH'],[650,330,'CHIME RIDGE'],[1450,1160,'PRISM FALLS']],
      zones:[[610,610,620,520,'rgba(40,64,92,0.98)','rgba(31,50,76,0.86)'],[1290,690,720,600,'rgba(44,58,105,0.98)','rgba(34,46,83,0.86)'],[1790,730,470,500,'rgba(57,45,103,0.98)','rgba(43,38,78,0.84)']],
      routes:[[220,750,470,490,650,390],[650,390,870,610,1110,790],[1110,790,1330,520,1570,420],[1110,790,1460,850,1790,740],[1790,740,1940,750,2070,750]],
      palette:{ground:'#151d39',fade:'rgba(21,29,57,0)',routeOuter:'rgba(50,69,111,0.92)',route:'#7894b5',routeGlow:'rgba(157,232,255,0.28)',border:'#596da2',waterA:'#52b8cf',waterB:'#244f83',waterLine:'#9de8ff',grass:['#5c79a4','#526792'],flowers:['#9de8ff','#c2b4ff','#ff91d5','#70f0e5'],obstacle:'crystal'}
    },
    4: {
      id:4, name:'Moonwake Coast', world:{w:2300,h:1500}, spawn:{x:220,y:750}, hub:{x:220,y:750}, boss:{x:1850,y:750}, seed:44119,
      weeds:[], shrines:[], drums:[], speakers:[],
      npcs:[{id:'tavi',name:'TAVI',x:1840,y:1220,color:'#61d8c8'},{id:'luma',name:'LUMA',x:2040,y:560,color:'#ff91d5'}],
      enemies:[['mw1','slime',500,560,'moonwake'],['mw2','buzz',730,430,'moonwake'],['mw3','wisp',900,930,'moonwake'],['mw4','thorn',1190,620,'moonwake'],['mw5','slime',1430,520,'moonwake'],['mw6','wisp',1550,1160,'moonwake'],['mw7','buzz',1500,460,'moonwake'],['mw8','slime',1380,1160,'moonwake'],['mw9','wisp',760,1170,'moonwake'],['mw10','thorn',1860,390,'moonwake']],
      obstacles:[{x:170,y:150,r:100},{x:520,y:155,r:82},{x:890,y:150,r:90},{x:1280,y:155,r:84},{x:1690,y:150,r:90},{x:2150,y:170,r:112},{x:170,y:1320,r:110},{x:560,y:1340,r:88},{x:1010,y:1330,r:96},{x:1510,y:1330,r:108},{x:2150,y:1320,r:118},{x:930,y:650,r:45},{x:1320,y:420,r:48},{x:1580,y:1020,r:52},{x:520,y:970,r:42}],
      water:[{x:710,y:830,rx:170,ry:82},{x:1190,y:1080,rx:180,ry:84},{x:1530,y:710,rx:145,ry:72},{x:1930,y:1050,rx:160,ry:80}],
      tokens:[{id:'mw-shell-1',x:650,y:390,label:'Dawn Shell'},{id:'mw-shell-2',x:1110,y:1180,label:'Deep Shell'},{id:'mw-shell-3',x:1650,y:400,label:'Star Shell'}], collectibles:[{id:'pearl-1',set:'moonwake',x:480,y:390,label:'Dawn Pearl'},{id:'pearl-2',set:'moonwake',x:880,y:1120,label:'Deep Pearl'},{id:'pearl-3',set:'moonwake',x:1390,y:350,label:'Foam Pearl'},{id:'pearl-4',set:'moonwake',x:2020,y:1110,label:'Night Pearl'}],
      portals:[{id:'mw-return',x:110,y:750,target:3,name:'Skyglass Reach',back:true}],
      labels:[[1140,235,'MOONWAKE COAST'],[650,330,'TIDELIGHT STRAND'],[1500,1200,'ECHOING SHOALS']],
      zones:[[620,590,620,520,'rgba(27,76,78,0.98)','rgba(24,59,66,0.86)'],[1320,720,760,610,'rgba(33,58,86,0.98)','rgba(28,48,72,0.86)'],[1900,720,500,520,'rgba(62,48,89,0.98)','rgba(45,41,72,0.84)']],
      routes:[[220,750,440,500,650,390],[650,390,880,730,1110,1180],[1110,1180,1380,670,1650,400],[1110,780,1500,830,1840,760]],
      palette:{ground:'#102c35',fade:'rgba(16,44,53,0)',routeOuter:'rgba(36,80,83,0.92)',route:'#8a8269',routeGlow:'rgba(126,235,220,0.24)',border:'#386d75',waterA:'#287f95',waterB:'#153e66',waterLine:'#61d8c8',grass:['#3e7c70','#34675f'],flowers:['#61d8c8','#86cfff','#ff91d5','#d8e7a2'],obstacle:'coast'}
    }
  };

  /*
   * Production NPCs are distributed across the existing regions as ambient
   * residents. They use the same schedule/dialogue/interaction pipeline as the
   * story cast, so every commissioned sheet is live rather than merely shipped.
   */
  var AMBIENT_NPCS = {
    1: [
      ['village-elder','VILLAGE ELDER',1220,760,'#d9a85d','keeping the grove records'],
      ['blacksmith','BLACKSMITH',1600,1010,'#ff9d57','tuning field gear'],
      ['chef','CHEF',1510,1240,'#ffb454','testing a mushroom broth'],
      ['gardener','GARDENER',1030,900,'#7df7a1','tending singing seedlings'],
      ['child-a','ROWAN',1340,680,'#ffc857','chasing fireflies'],
      ['villager-a','MAE',1840,890,'#a9f58b','carrying market flowers'],
      ['electric-guitarist','RIFF',2010,1180,'#d77cff','rehearsing a lightning solo']
    ],
    2: [
      ['travelling-merchant','WREN',390,850,'#ffc857','sorting road charms'],
      ['explorer','ORIN',830,350,'#9de8ff','mapping the old roots'],
      ['librarian','SABLE',1040,1030,'#b7a0ff','cataloguing bark-runes'],
      ['arena-master','BRONT',1630,930,'#ff7892','surveying the arena'],
      ['travelling-bard','LYRIC',1300,330,'#d77cff','playing for the mushrooms'],
      ['child-b','MICA',560,1050,'#ffb454','collecting amber caps'],
      ['drummer','KICK',1880,570,'#ff9d57','answering the Rootsong']
    ],
    3: [
      ['band-manager','CASS',390,920,'#f4d35e','organising the sky stage'],
      ['quest-giver','AERIN',690,340,'#9de8ff','pinning expedition notices'],
      ['potion-brewer','VIOLET',940,1120,'#d77cff','distilling storm tonic'],
      ['dj','PHASE',1240,900,'#62c7ff','mixing crystal echoes'],
      ['bass-player','LOWE',1530,1130,'#7df7a1','testing the bridge bass'],
      ['synth-performer','ARIA',1760,460,'#ff91d5','sequencing cloud tones'],
      ['trumpeter','BRASS',1950,920,'#ffc857','calling the wind home']
    ],
    4: [
      ['fisherman','FINN',390,960,'#61d8c8','checking the moon nets'],
      ['innkeeper','NORA',650,330,'#ffb454','preparing guest lanterns'],
      ['villager-b','SOL',900,1180,'#86e8ff','gathering tideglass'],
      ['violinist','VESPER',1160,390,'#d77cff','playing for the tidal pools'],
      ['singer','ECHO',1460,920,'#ff91d5','warming up by the ruins'],
      ['street-busker','PATCH',1750,410,'#ffc857','busking beneath the moon'],
      ['festival-band-leader','NOVA',2050,930,'#f6e36d','planning the final concert']
    ]
  };
  Object.keys(AMBIENT_NPCS).forEach(function (stageId) {
    AMBIENT_NPCS[stageId].forEach(function (entry) {
      LEVELS[stageId].npcs.push({
        id:entry[0], spriteId:entry[0], name:entry[1], x:entry[2], y:entry[3],
        color:entry[4], occupation:entry[5], ambient:true, collisionRadius:14
      });
    });
  });

  function preloadLevelSprites(stage) {
    if (!window.MossSprites) return;
    var level = LEVELS[stage] || LEVELS[1];
    var ids = level.npcs.map(function (npc) { return npc.spriteId || npc.id; });
    ids = ids.concat((ENEMY_SPECIES[stage] || ENEMY_SPECIES[1]).map(function (species) { return species.id; }));
    ids = ids.concat(ELITE_VARIANTS.map(function (elite) { return elite.assetId || elite.id; }));
    ids = ids.concat(MINIBOSS_DEFS.filter(function (mini) { return mini.stage === Number(stage); })
      .map(function (mini) { return mini.id === 'groove-beetle' ? 'groove-beetle-prime' : mini.id; }));
    ids.push(bossDefForStage(Number(stage)).assetId);
    ids.push('odin', 'odin-expanded-actions', 'combat-effects');
    settlePromise(window.MossSprites.preload(ids).then(function () { canvasDirty = true; }));
  }

  function allLevelItems(key) {
    return Object.keys(LEVELS).reduce(function (items, id) { return items.concat(LEVELS[id][key] || []); }, []);
  }

  function generateDecorations(level) {
    decorations = [];
    var random = mulberry32(level.seed);
    var count = Math.round(level.world.w * level.world.h / 6200);
    for (var i = 0; i < count; i++) {
      var x = 45 + random() * (level.world.w - 90);
      var y = 45 + random() * (level.world.h - 90);
      var kind = random() < 0.56 ? 'grass' : random() < 0.82 ? 'flower' : 'mushroom';
      decorations.push({ x:x, y:y, kind:kind, phase:random()*6.28, tint:Math.floor(random()*4) });
    }
  }

  function activateLevel(stage) {
    var level = LEVELS[stage] || LEVELS[1];
    currentLevel = level;
    WORLD.w = level.world.w; WORLD.h = level.world.h;
    HUB.x = level.hub.x; HUB.y = level.hub.y;
    BOSS_CENTER.x = level.boss.x; BOSS_CENTER.y = level.boss.y;
    weeds = level.weeds; shrines = level.shrines; drums = level.drums; speakers = level.speakers;
    npcs = level.npcs; enemyBlueprints = level.enemies; obstacles = level.obstacles; waterPools = level.water;
    stageTokens = level.tokens; collectibles = level.collectibles || []; stagePortals = level.portals;
    if(encounterDirector.weatherTimer<=0)state.weather=stage===2?'fog':stage===3?'wind':stage===4?'rain':'clear';
    generateDecorations(level);
    canvas.setAttribute('aria-label', level.name + ' game world');
    preloadLevelSprites(stage);
    canvasDirty = true;
  }

  function sanitizeState(raw) {
    var clean = freshState();
    if (!raw || typeof raw !== 'object') return clean;
    function validUnique(values, validValues) {
      var valid = new Set(validValues);
      return Array.from(new Set(Array.isArray(values) ? values : [])).filter(function (v) {
        return typeof v === 'string' && valid.has(v);
      });
    }
    clean.weeds = validUnique(raw.weeds, allLevelItems('weeds').map(function (w) { return w.id; }));
    clean.notes = validUnique(raw.notes, NOTE_ORDER).sort(function (a, b) {
      return NOTE_ORDER.indexOf(a) - NOTE_ORDER.indexOf(b);
    });
    clean.drums = validUnique(raw.drums, allLevelItems('drums').map(function (d) { return d.id; }));
    clean.speakers = validUnique(raw.speakers, allLevelItems('speakers').map(function (s) { return s.id; }));
    clean.defeated = validUnique(raw.defeated, allLevelItems('enemies').map(function (e) { return e[0]; }));
    clean.stageTokens = validUnique(raw.stageTokens, allLevelItems('tokens').map(function (t) { return t.id; }));
    clean.collectibles = validUnique(raw.collectibles, allLevelItems('collectibles').map(function (c) { return c.id; }));
    clean.collectibleRewards = validUnique(raw.collectibleRewards, Object.keys(COLLECTIBLE_SETS));
    clean.activeResonance = ['nature','psychedelic','heavy','conductor'].indexOf(raw.activeResonance) >= 0 ? raw.activeResonance : '';
    var instrumentIds = ['guitar','bass','synth','drums','microphone','violin'];
    clean.unlockedInstruments = validUnique(raw.unlockedInstruments, instrumentIds);
    if (clean.unlockedInstruments.indexOf('guitar') < 0) clean.unlockedInstruments.unshift('guitar');
    clean.equippedInstrument = instrumentIds.indexOf(raw.equippedInstrument) >= 0 &&
      clean.unlockedInstruments.indexOf(raw.equippedInstrument) >= 0 ? raw.equippedInstrument : 'guitar';
    var rawEquipmentVisual = raw.equipmentVisual && typeof raw.equipmentVisual === 'object' ? raw.equipmentVisual : {};
    clean.equipmentVisual.schemaVersion = 1;
    // Only variants backed by connected art are restored. Unknown future or
    // renamed variants fall back safely without affecting item ownership.
    clean.equipmentVisual.cosmeticVariant = rawEquipmentVisual.cosmeticVariant === 'standard' ? 'standard' : 'standard';
    clean.equipmentVisual.preferredLoadout = validUnique(rawEquipmentVisual.preferredLoadout,instrumentIds)
      .filter(function (id) { return clean.unlockedInstruments.indexOf(id) >= 0; }).slice(0,3);
    if (clean.equipmentVisual.preferredLoadout.indexOf(clean.equippedInstrument) < 0) {
      clean.equipmentVisual.preferredLoadout.unshift(clean.equippedInstrument);
      clean.equipmentVisual.preferredLoadout = clean.equipmentVisual.preferredLoadout.slice(0,3);
    }
    var rawMastery = raw.instrumentMastery && typeof raw.instrumentMastery === 'object' ? raw.instrumentMastery : {};
    instrumentIds.forEach(function (id) {
      var record = rawMastery[id] && typeof rawMastery[id] === 'object' ? rawMastery[id] : {};
      clean.instrumentMastery[id] = {
        xp: clamp(Math.floor(Number(record.xp) || 0), 0, 999999),
        level: clamp(Math.floor(Number(record.level) || 1), 1, 10)
      };
    });
    clean.masteryNodes = validUnique(raw.masteryNodes, instrumentIds.reduce(function (ids, id) {
      return ids.concat([id + '-combo', id + '-passive', id + '-special', id + '-legendary']);
    }, []));
    var rawHome = raw.home && typeof raw.home === 'object' ? raw.home : {};
    clean.home.unlocked = !!rawHome.unlocked;
    clean.home.level = clamp(Math.floor(Number(rawHome.level) || 1), 1, 4);
    clean.home.odinFriendship = clamp(Math.floor(Number(rawHome.odinFriendship) || 0), 0, 100);
    clean.home.odinFedAt = clamp(Number(rawHome.odinFedAt) || 0, 0, 9999999);
    clean.home.greenhousePlantedAt = clamp(Number(rawHome.greenhousePlantedAt) || 0, 0, 9999999);
    clean.home.greenhouseCrop = ['','heartbloom','glowweed','moon-orchid'].indexOf(rawHome.greenhouseCrop) >= 0 ? rawHome.greenhouseCrop : '';
    clean.home.greenhouseHarvests = clamp(Math.floor(Number(rawHome.greenhouseHarvests) || 0), 0, 9999);
    clean.home.workshopLevel = clamp(Math.floor(Number(rawHome.workshopLevel) || 1), 1, 4);
    clean.home.jukeboxTrack = ['Mossvale Overture','Rootsong Underfoot','Skyglass Weather','Moonwake Nocturne','Final Concert'].indexOf(rawHome.jukeboxTrack) >= 0 ?
      rawHome.jukeboxTrack : 'Mossvale Overture';
    clean.home.decorations = validUnique(rawHome.decorations, ['woven-rug','nullspeaker-trophy','root-lantern','skyglass-mobile','moonwake-aquarium','festival-lights','vinyl-wall','golden-bloom']);
    if (!clean.home.decorations.length) clean.home.decorations.push('woven-rug');
    clean.home.activeDecoration = clean.home.decorations.indexOf(rawHome.activeDecoration) >= 0 ? rawHome.activeDecoration : clean.home.decorations[0];
    clean.completedQuests = validUnique(raw.completedQuests, [
      'forest-amplifiers','ancient-speakers','lost-vinyl','travelling-band','missing-musicians','corrupted-resonance','dream-realm','final-concert',
      'mara-pantry','jimbo-garden','eems-remix','blu-silence','pip-practice','zephra-parts','nix-relics','tavi-tides','luma-festival','brad-contract'
    ]);
    clean.eliteDefeated = validUnique(raw.eliteDefeated, ELITE_VARIANTS.map(function (elite) { return elite.id; }));
    clean.miniBossesDefeated = validUnique(raw.miniBossesDefeated, MINIBOSS_DEFS.map(function (mini) { return mini.id; }));
    clean.discoveredLocations = validUnique(raw.discoveredLocations, [
      'mossvale-hub','rootsong-hub','skyglass-hub','moonwake-hub','player-home','dream-gate',
      'fernside-secret','root-camp','cloud-sanctum','tidal-vault'
    ]);
    if (clean.discoveredLocations.indexOf('mossvale-hub') < 0) clean.discoveredLocations.unshift('mossvale-hub');
    clean.discoveredSecrets = validUnique(raw.discoveredSecrets, ['fernside-secret','root-camp','cloud-sanctum','tidal-vault','dream-gate']);
    clean.worldEventsSeen = validUnique(raw.worldEventsSeen, [
      'ambush','elite-patrol','travelling-merchant','band-rehearsal','campfire','treasure-caravan','lost-explorer',
      'rare-collectible','secret-cave','meteor-strike','shrine-awakening','ghost-procession','music-festival',
      'blood-moon','crystal-storm','forest-bloom'
    ]);
    clean.achievements = validUnique(raw.achievements, [
      'first-encore','instrumentalist','master-of-six','elite-hunter','home-sweet-home','green-thumb','best-friend',
      'world-tour','secret-listener','final-headliner'
    ]);
    clean.weather = ['clear','rain','fog','wind','crystal-storm','blood-moon','forest-bloom'].indexOf(raw.weather) >= 0 ? raw.weather : 'clear';
    clean.questStates = {};
    if (raw.questStates && typeof raw.questStates === 'object') {
      Object.keys(raw.questStates).slice(0, 40).forEach(function (id) {
        if (!/^[a-z0-9-]{1,40}$/.test(id)) return;
        clean.questStates[id] = clamp(Math.floor(Number(raw.questStates[id]) || 0), 0, 99);
      });
    }
    clean.stageBosses = validUnique(raw.stageBosses, Object.keys(BOSS_DEFS).map(function (id) { return BOSS_DEFS[id].id; }));
    var validHeartbloomIds = Object.keys(STAGE_HEARTBLOOMS).reduce(function (ids, stage) {
      return ids.concat(STAGE_HEARTBLOOMS[stage].map(function (_, index) {
        return 'stage-' + stage + '-heart-' + index;
      }));
    }, []);
    clean.collectedHeartblooms = validUnique(raw.collectedHeartblooms, validHeartbloomIds);
    ['composed', 'bossDefeated', 'campaignFinaleSeen', 'metEems', 'metJimbo', 'metBlu', 'odinRecruited', 'metMara', 'metPip',
      'metZephra', 'metNix', 'metTavi', 'metLuma', 'pruner', 'pulse',
      'extraHeart', 'charged', 'perfectHarvest', 'encoreUsed'].forEach(function (key) { clean[key] = !!raw[key]; });
    if (Array.isArray(raw.melody) && raw.melody.length === 8) {
      clean.melody = raw.melody.map(function (n) { return NOTE_ORDER.indexOf(n) >= 0 ? n : '-'; });
    }
    clean.totalKills = clamp(Number(raw.totalKills) || 0, 0, 99999);
    clean.damagingPulses = clamp(Math.floor(Number(raw.damagingPulses) || 0), 0, 99999);
    clean.playSeconds = clamp(Number(raw.playSeconds) || 0, 0, 9999999);
    var rawOnboarding = raw.firstStageOnboarding && typeof raw.firstStageOnboarding === 'object' ?
      raw.firstStageOnboarding : {};
    var hadOpeningProgress = !!(raw.metEems || raw.metJimbo || raw.metBlu || (Number(raw.totalKills) || 0) > 0 ||
      (Array.isArray(raw.notes) && raw.notes.length) || (Number(raw.stage) || 1) > 1);
    clean.firstStageOnboarding.graceConsumed = typeof rawOnboarding.graceConsumed === 'boolean' ?
      rawOnboarding.graceConsumed : hadOpeningProgress;
    clean.firstStageOnboarding.graceRemaining = clamp(
      Number(rawOnboarding.graceRemaining),
      0,
      FIRST_STAGE_BALANCE.openingGracePeriodSeconds
    );
    if (!isFinite(Number(rawOnboarding.graceRemaining))) {
      clean.firstStageOnboarding.graceRemaining = clean.firstStageOnboarding.graceConsumed ?
        0 : FIRST_STAGE_BALANCE.openingGracePeriodSeconds;
    }
    clean.firstStageOnboarding.tutorialFlags = validUnique(rawOnboarding.tutorialFlags, [
      'move','interact','attack','dodge','block','heal','odin','rhythm','instrument','resonance','first-victory'
    ]);
    clean.firstStageOnboarding.struggle = clamp(Number(rawOnboarding.struggle) || 0, 0, 10);
    clean.firstStageOnboarding.checkpointReloads = clamp(
      Math.floor(Number(rawOnboarding.checkpointReloads) || 0), 0, 999
    );
    var rawProfessions = raw.professions && typeof raw.professions === 'object' ? raw.professions : {};
    PROFESSION_IDS.forEach(function (professionId) {
      var record = rawProfessions[professionId] && typeof rawProfessions[professionId] === 'object' ?
        rawProfessions[professionId] : {};
      clean.professions[professionId] = {
        xp:clamp(Math.floor(Number(record.xp) || 0),0,999999),
        level:clamp(Math.floor(Number(record.level) || 1),1,25)
      };
    });
    var rawMaterials = raw.craftingMaterials && typeof raw.craftingMaterials === 'object' ?
      raw.craftingMaterials : {};
    Object.keys(clean.craftingMaterials).forEach(function (materialId) {
      clean.craftingMaterials[materialId] = clamp(Math.floor(Number(rawMaterials[materialId]) || 0),0,9999);
    });
    clean.knownRecipes = validUnique(raw.knownRecipes,PRODUCTION_RECIPE_IDS);
    ['field-stew','mossguard-charm','tempo-tea'].forEach(function (recipeId) {
      if (clean.knownRecipes.indexOf(recipeId) < 0) clean.knownRecipes.push(recipeId);
    });
    clean.craftedItems = {};
    if (raw.craftedItems && typeof raw.craftedItems === 'object') {
      PRODUCTION_RECIPE_IDS.forEach(function (recipeId) {
        var amount = clamp(Math.floor(Number(raw.craftedItems[recipeId]) || 0),0,999);
        if (amount) clean.craftedItems[recipeId] = amount;
      });
    }
    var validNpcIds = allLevelItems('npcs').map(function (npc) { return npc.id; });
    clean.relationships = {};
    if (raw.relationships && typeof raw.relationships === 'object') {
      validNpcIds.forEach(function (npcId) {
        var value = clamp(Math.floor(Number(raw.relationships[npcId]) || 0),0,100);
        if (value) clean.relationships[npcId] = value;
      });
    }
    var rawReputation = raw.regionalReputation && typeof raw.regionalReputation === 'object' ?
      raw.regionalReputation : {};
    Object.keys(clean.regionalReputation).forEach(function (regionId) {
      clean.regionalReputation[regionId] = clamp(Math.floor(Number(rawReputation[regionId]) || 0),0,100);
    });
    clean.activeContracts = Array.from(new Set(Array.isArray(raw.activeContracts) ? raw.activeContracts : []))
      .filter(function (id) { return typeof id === 'string' && /^contract-[a-z0-9-]{1,48}$/.test(id); }).slice(0,3);
    clean.completedContracts = Array.from(new Set(Array.isArray(raw.completedContracts) ? raw.completedContracts : []))
      .filter(function (id) { return typeof id === 'string' && /^contract-[a-z0-9-]{1,48}$/.test(id); }).slice(0,200);
    var rawDreamEncore = raw.dreamEncore && typeof raw.dreamEncore === 'object' ? raw.dreamEncore : {};
    clean.dreamEncore.unlocked = !!rawDreamEncore.unlocked;
    clean.dreamEncore.rank = clamp(Math.floor(Number(rawDreamEncore.rank) || 1),1,25);
    clean.dreamEncore.bestWave = clamp(Math.floor(Number(rawDreamEncore.bestWave) || 0),0,999);
    clean.dreamEncore.runs = clamp(Math.floor(Number(rawDreamEncore.runs) || 0),0,99999);
    clean.dreamEncore.active = false;
    var rawOnlineProfile = raw.onlineProfile && typeof raw.onlineProfile === 'object' ? raw.onlineProfile : {};
    clean.onlineProfile.displayName = typeof rawOnlineProfile.displayName === 'string' ?
      rawOnlineProfile.displayName.replace(/[^\w \-']/g,'').trim().slice(0,18) || 'Mossvale Player' : 'Mossvale Player';
    var legacyCosmetics = {root:'rootsong',prism:'skyglass',tide:'moonwake',static:'grove',dream:'moonwake'};
    var restoredCosmetic = legacyCosmetics[rawOnlineProfile.cosmetic] || rawOnlineProfile.cosmetic;
    clean.onlineProfile.cosmetic = ['grove','rootsong','skyglass','moonwake'].indexOf(restoredCosmetic) >= 0 ?
      restoredCosmetic : 'grove';
    clean.onlineProfile.rating = clamp(Math.floor(Number(rawOnlineProfile.rating) || 1000),100,5000);
    clean.onlineProfile.wins = clamp(Math.floor(Number(rawOnlineProfile.wins) || 0),0,999999);
    clean.onlineProfile.losses = clamp(Math.floor(Number(rawOnlineProfile.losses) || 0),0,999999);
    clean.onlineProfile.seasonalTokens = clamp(Math.floor(Number(rawOnlineProfile.seasonalTokens) || 0),0,999999);
    var rawPvpV2 = raw.pvpV2 && typeof raw.pvpV2 === 'object' ? raw.pvpV2 : {};
    ['matches','wins','losses','knockouts','falls','localMatches','onlineMatches'].forEach(function (key) {
      clean.pvpV2[key] = clamp(Math.floor(Number(rawPvpV2[key]) || 0),0,999999);
    });
    clean.pvpV2.playSeconds = clamp(Number(rawPvpV2.playSeconds) || 0,0,99999999);
    clean.pvpV2.preferredInstrument = ['guitar','bass'].indexOf(rawPvpV2.preferredInstrument) >= 0 ?
      rawPvpV2.preferredInstrument : 'guitar';
    clean.pvpV2.cosmetics = validUnique(rawPvpV2.cosmetics,['mossvale-standard','amphitheatre-banner','golden-headliner']);
    if (clean.pvpV2.cosmetics.indexOf('mossvale-standard') < 0) clean.pvpV2.cosmetics.unshift('mossvale-standard');
    clean.pvpV2.matchHistory = (Array.isArray(rawPvpV2.matchHistory) ? rawPvpV2.matchHistory : []).slice(-12).map(function (entry) {
      entry = entry && typeof entry === 'object' ? entry : {};
      return {
        won:!!entry.won,online:!!entry.online,mode:'stock',
        instrument:['guitar','bass'].indexOf(entry.instrument) >= 0 ? entry.instrument : 'guitar',
        knockouts:clamp(Math.floor(Number(entry.knockouts)||0),0,99),
        falls:clamp(Math.floor(Number(entry.falls)||0),0,99),
        duration:clamp(Number(entry.duration)||0,0,3600),
        at:clamp(Math.floor(Number(entry.at)||0),0,9999999999999)
      };
    });
    clean.chapter = clamp(Math.floor(Number(raw.chapter) || (raw.bossDefeated ? 2 : 1)), 1, 4);
    // V2/V3 stored placeholder relics before the extra stages existed, so only V4
    // records may restore them as genuine stage completion.
    clean.chapterRelics = Number(raw.version) >= 4 ? validUnique(raw.chapterRelics, ['rootsong', 'skyglass', 'moonwake']) : [];
    clean.stage = clamp(Math.floor(Number(raw.stage) || 1), 1, 4);
    clean.beatcoins = clamp(Math.floor(Number(raw.beatcoins) || 0), 0, 99999);
    clean.skillPoints = clamp(Math.floor(Number(raw.skillPoints) || 0), 0, 99);
    clean.heartblooms = clamp(Math.floor(Number(raw.heartblooms) || 0), 0, HEARTBLOOM_CAPACITY);
    clean.skills = validUnique(raw.skills, ['strong-strike','fleet-foot','wide-pulse','grove-vitality','odin-bond','odin-pounce','odin-howl','odin-fetch','odin-guardian','odin-spirit','lucky-leaf','echo-chamber','moss-treader','bloom-sense','shield-harmony','resonance-cascade','verdant-vigor','rhythm-master','spectral-sight','encore','critical-rhythm','battle-focus','echo-step','coin-magnet','relic-hunter','pulse-mender']);
    clean.purchases = validUnique(raw.purchases, ['heart-tonic','coin-charm','pulse-coil','stamina-salve','thorn-ward','melody-map','grove-blessing','echo-amplifier','weed-whisperer','boss-bane','revival-seed','pruner-polish','moss-boots','crystal-lens','tempo-ring','collector-compass','ironbark-plate','fortune-charm','heartbloom-pouch']);
    var rawStatistics = raw.statistics && typeof raw.statistics === 'object' ? raw.statistics : {};
    Object.keys(clean.statistics).forEach(function (key) {
      if (key === 'bestBossTimes') return;
      clean.statistics[key] = clamp(Number(rawStatistics[key]) || 0, 0, 999999999);
    });
    if (rawStatistics.bestBossTimes && typeof rawStatistics.bestBossTimes === 'object') {
      Object.keys(BOSS_DEFS).forEach(function (id) {
        var bossId = BOSS_DEFS[id].id;
        var best = Number(rawStatistics.bestBossTimes[bossId]);
        if (isFinite(best) && best > 0) clean.statistics.bestBossTimes[bossId] = clamp(best, 0.1, 999999);
      });
    }
    var savedLevel = LEVELS[clean.stage] || LEVELS[1];
    var migrateToRealMap = Number(raw.version) < 5 && clean.stage > 1;
    clean.x = migrateToRealMap ? savedLevel.spawn.x : clamp(Number(raw.x) || savedLevel.spawn.x, 40, savedLevel.world.w - 40);
    clean.y = migrateToRealMap ? savedLevel.spawn.y : clamp(Number(raw.y) || savedLevel.spawn.y, 40, savedLevel.world.h - 40);
    clean.stagePositions = {};
    if (Number(raw.version) >= 5 && raw.stagePositions && typeof raw.stagePositions === 'object') {
      Object.keys(LEVELS).forEach(function (id) {
        var position = raw.stagePositions[id];
        var level = LEVELS[id];
        if (!position || typeof position !== 'object') return;
        clean.stagePositions[id] = {
          x:clamp(Number(position.x) || level.spawn.x,40,level.world.w-40),
          y:clamp(Number(position.y) || level.spawn.y,40,level.world.h-40)
        };
      });
    }
    if (Number(raw.version) < 5) {
      clean.beatcoins = Math.max(clean.beatcoins, Math.min(40, clean.defeated.length * 2 + (clean.bossDefeated ? 8 : 0)));
      var migratedPoints = Math.floor(clean.totalKills / 5) + (clean.bossDefeated ? 2 : 0) + clean.chapterRelics.length - clean.skills.length;
      clean.skillPoints = Math.max(clean.skillPoints, Math.min(8, Math.max(0,migratedPoints)));
    }
    if (Number(raw.version) < 6) {
      clean.statistics.beatcoinsEarned = Math.max(clean.statistics.beatcoinsEarned, clean.beatcoins);
    }
    clean.extraHeart = clean.extraHeart || clean.weeds.length >= 14;
    clean.charged = clean.charged || clean.weeds.length >= 24;
    clean.perfectHarvest = clean.perfectHarvest || clean.weeds.length >= 30;
    clean.composed = clean.composed && NOTE_ORDER.every(function (n) { return clean.notes.indexOf(n) >= 0; }) &&
      NOTE_ORDER.every(function (n) { return clean.melody.indexOf(n) >= 0; });
    clean.bossDefeated = clean.bossDefeated && clean.composed;
    if (clean.bossDefeated && clean.stageBosses.indexOf('nullspeaker') < 0) clean.stageBosses.push('nullspeaker');
    if (clean.stageBosses.indexOf('nullspeaker') >= 0 && clean.composed) clean.bossDefeated = true;
    if (clean.bossDefeated || clean.metMara) {
      clean.home.unlocked = true;
      if (clean.discoveredLocations.indexOf('player-home') < 0) clean.discoveredLocations.push('player-home');
    }
    if (clean.bossDefeated && clean.unlockedInstruments.indexOf('bass') < 0) clean.unlockedInstruments.push('bass');
    if ((clean.chapterRelics.indexOf('rootsong') >= 0 || clean.metPip) && clean.unlockedInstruments.indexOf('drums') < 0) clean.unlockedInstruments.push('drums');
    if ((clean.chapterRelics.indexOf('skyglass') >= 0 || clean.metZephra) && clean.unlockedInstruments.indexOf('synth') < 0) clean.unlockedInstruments.push('synth');
    if (clean.home.unlocked && clean.unlockedInstruments.indexOf('microphone') < 0) clean.unlockedInstruments.push('microphone');
    if ((clean.chapterRelics.indexOf('moonwake') >= 0 || clean.metTavi) && clean.unlockedInstruments.indexOf('violin') < 0) clean.unlockedInstruments.push('violin');
    if (clean.unlockedInstruments.indexOf(clean.equippedInstrument) < 0) clean.equippedInstrument = 'guitar';
    return clean;
  }

  function saveSettings() {
    writeStorage(SETTINGS_KEY, JSON.stringify(settings));
  }
  function saveGame(force) {
    if (!started || (!force && nowTime - lastSaveTime < 4)) return;
    if (!boss || boss.dead) {
      state.x = Math.round(player.x);
      state.y = Math.round(player.y);
      state.stagePositions[String(state.stage)] = { x:state.x, y:state.y };
    }
    if (writeStorage(SAVE_KEY, JSON.stringify(state))) {
      lastSaveTime = nowTime;
      refreshContinue();
    }
  }
  function hasSave() {
    return !!(readStorage(SAVE_KEY) || readStorage(LEGACY_SAVE_KEY) || readStorage(OLDER_SAVE_KEY) ||
      readStorage(OLDEST_SAVE_KEY) || readStorage(ANCIENT_SAVE_KEY));
  }
  function refreshContinue() {
    var button = byId('continueButton');
    if (button) setHidden(button, !hasSave());
  }

  var relationshipLastGain = {};
  var fishingLastCast = -999;
  var dreamEncoreRuntime = {wave:0,waveCooldown:0,activeEnemyIds:new Set(),completedWaves:0};
  var PRODUCTION_RECIPES = [
    {id:'field-stew',name:"Mara's Field Stew",profession:'cooking',level:1,cost:{heartwood:1,beatcoins:3},effect:'Full heal and a short defence boost.'},
    {id:'mossguard-charm',name:'Mossguard Charm',profession:'crafting',level:1,cost:{heartwood:3,beatcoins:8},effect:'Craft the permanent Ironbark Plate effect.'},
    {id:'tempo-tea',name:'Tempo Tea',profession:'cooking',level:1,cost:{sporeSilk:1,beatcoins:3},effect:'Speed and attack tempo rise for twenty seconds.'},
    {id:'heartwood-pickup',name:'Heartwood Pickup',profession:'crafting',level:3,cost:{heartwood:4,echoCore:1,beatcoins:10},effect:'Add 24 mastery XP to the equipped instrument.'},
    {id:'spore-tonic',name:'Luminous Spore Tonic',profession:'cooking',level:3,cost:{sporeSilk:3,beatcoins:6},effect:'Store two Heartblooms and gain recovery protection.'},
    {id:'prism-coil',name:'Skyglass Prism Coil',profession:'crafting',level:5,cost:{prismDust:4,echoCore:1,beatcoins:14},effect:'Permanently unlock the Pulse Coil upgrade.'},
    {id:'tideglass-brooch',name:'Tideglass Brooch',profession:'crafting',level:5,cost:{tidePearl:4,prismDust:2,beatcoins:16},effect:'Permanently unlock the Fortune Charm effect.'},
    {id:'echo-core-mod',name:'Resonant Echo Mod',profession:'crafting',level:7,cost:{echoCore:3,prismDust:3,beatcoins:20},effect:'Add 50 mastery XP and fully charge the instrument ultimate.'},
    {id:'odin-trail-mix',name:"Odin's Trail Mix",profession:'cooking',level:5,cost:{sporeSilk:2,heartwood:2,beatcoins:8},effect:'Increase Odin friendship and reset care fatigue.'},
    {id:'festival-lantern',name:'Festival Resonance Lantern',profession:'crafting',level:8,cost:{tidePearl:3,prismDust:3,heartwood:3,beatcoins:24},effect:'Craft a permanent home decoration.'},
    {id:'legendary-bridge',name:'Legendary Instrument Bridge',profession:'crafting',level:12,cost:{echoCore:6,prismDust:5,tidePearl:5,beatcoins:40},effect:"Learn the equipped instrument's legendary mastery node."},
    {id:'encore-crown',name:'Dream Encore Crown',profession:'crafting',level:15,cost:{echoCore:10,heartwood:8,sporeSilk:8,prismDust:8,tidePearl:8,beatcoins:75},effect:'A release-tier trophy and permanent Encore skill.'}
  ];

  function professionThreshold(level) {
    return 28 + level * 18;
  }

  function gainProfessionXp(id, amount, reason) {
    if (PROFESSION_IDS.indexOf(id) < 0) return false;
    var record = state.professions[id] || (state.professions[id] = {xp:0,level:1});
    record.xp += Math.max(1,Math.floor(Number(amount) || 1));
    var levelled = false;
    while (record.level < 25 && record.xp >= professionThreshold(record.level)) {
      record.xp -= professionThreshold(record.level);
      record.level++;
      levelled = true;
      state.beatcoins += 2 + Math.floor(record.level / 3);
    }
    if (levelled) {
      showToast(id.replace(/([A-Z])/g,' $1').toUpperCase() + ' ' + record.level,
        (reason || 'Practice') + ' unlocked new recipes, titles and rewards.','#ffc857',3.1);
      audioCall('sfx','unlock');
    }
    return levelled;
  }

  function regionIdForStage(stage) {
    return ['mossvale','rootsong','skyglass','moonwake'][clamp(Number(stage) || 1,1,4)-1];
  }

  function gainRelationship(npcId, amount) {
    if (!npcId || !/^[a-z0-9-]{1,40}$/.test(npcId)) return 0;
    var last = relationshipLastGain[npcId] || -999;
    if (state.playSeconds - last < 45) return state.relationships[npcId] || 0;
    relationshipLastGain[npcId] = state.playSeconds;
    var previous = state.relationships[npcId] || 0;
    var next = clamp(previous + Math.max(1,Math.floor(amount || 1)),0,100);
    state.relationships[npcId] = next;
    var regionId = regionIdForStage(state.stage);
    state.regionalReputation[regionId] = clamp(state.regionalReputation[regionId] + 1,0,100);
    if (Math.floor(previous / 25) !== Math.floor(next / 25)) {
      showToast('FRIENDSHIP DEEPENED',npcId.replace(/-/g,' ').toUpperCase() + ' now shares more personal dialogue.','#ff91d5',2.8);
    }
    return next;
  }

  function addCraftingMaterial(id, amount) {
    if (!Object.prototype.hasOwnProperty.call(state.craftingMaterials,id)) return 0;
    state.craftingMaterials[id] = clamp(state.craftingMaterials[id] + Math.max(1,Math.floor(amount || 1)),0,9999);
    return state.craftingMaterials[id];
  }

  function nearFishableWater() {
    for (var waterIndex = 0; waterIndex < waterPools.length; waterIndex++) {
      var pool = waterPools[waterIndex];
      var normalX = (player.x-pool.x)/Math.max(1,pool.rx);
      var normalY = (player.y-pool.y)/Math.max(1,pool.ry);
      var edgeDistance = Math.abs(Math.sqrt(normalX*normalX+normalY*normalY)-1) * Math.min(pool.rx,pool.ry);
      if (edgeDistance <= 58) return true;
    }
    return false;
  }

  function tryFishing() {
    var cooldown = Math.max(0,14-(state.playSeconds-fishingLastCast));
    if (!started || paused || dialogue) return {ok:false,reason:'unavailable'};
    if (!nearFishableWater()) {
      showToast('NO WATER IN REACH','Stand near a pond, river, or Moonwake pool before casting.','#9de8ff',2.8);
      return {ok:false,reason:'not_near_water'};
    }
    if (cooldown > 0) return {ok:false,reason:'cooldown',seconds:Math.ceil(cooldown)};
    fishingLastCast = state.playSeconds;
    var catchMaterial = ['heartwood','sporeSilk','prismDust','tidePearl'][clamp(state.stage,1,4)-1];
    var catchAmount = Math.random() < 0.18 ? 2 : 1;
    addCraftingMaterial(catchMaterial,catchAmount);
    gainProfessionXp('fishing',6 + state.stage * 2,'Landing a regional catch');
    if (Math.random() < 0.14) addCraftingMaterial('echoCore',1);
    audioCall('sfx','note');
    for (var splash = 0; splash < 12; splash++) spawnParticle(player.x,player.y,'#9de8ff',65,3);
    showToast('RESONANT CATCH','+' + catchAmount + ' ' + catchMaterial.replace(/([A-Z])/g,' $1') + ' · Fishing mastery XP','#9de8ff',2.9);
    saveGame(true);
    return {ok:true,material:catchMaterial,amount:catchAmount};
  }

  function recipeById(id) {
    return PRODUCTION_RECIPES.find(function (recipe) { return recipe.id === id; });
  }

  function canAffordRecipe(recipe) {
    if (!recipe) return false;
    return Object.keys(recipe.cost).every(function (key) {
      if (key === 'beatcoins') return state.beatcoins >= recipe.cost[key];
      return (state.craftingMaterials[key] || 0) >= recipe.cost[key];
    });
  }

  function applyRecipeEffect(recipe) {
    if (recipe.id === 'field-stew') {
      healPlayer(999);
      activeBuffs.defenseTimer = Math.max(activeBuffs.defenseTimer,18);
    } else if (recipe.id === 'mossguard-charm' && state.purchases.indexOf('ironbark-plate') < 0) {
      state.purchases.push('ironbark-plate');
    } else if (recipe.id === 'tempo-tea') {
      activeBuffs.speedTimer = Math.max(activeBuffs.speedTimer,22);
      player.attackCooldown = 0;
    } else if (recipe.id === 'heartwood-pickup') {
      gainInstrumentMastery(24);
    } else if (recipe.id === 'spore-tonic') {
      state.heartblooms = Math.min(HEARTBLOOM_CAPACITY,state.heartblooms + 2);
      player.invuln = Math.max(player.invuln,1.5);
    } else if (recipe.id === 'prism-coil' && state.purchases.indexOf('pulse-coil') < 0) {
      state.purchases.push('pulse-coil');
    } else if (recipe.id === 'tideglass-brooch' && state.purchases.indexOf('fortune-charm') < 0) {
      state.purchases.push('fortune-charm');
    } else if (recipe.id === 'echo-core-mod') {
      gainInstrumentMastery(50);
      instrumentUltimateCharge = 100;
    } else if (recipe.id === 'odin-trail-mix') {
      state.home.odinFriendship = Math.min(100,state.home.odinFriendship + 12);
      state.home.odinFedAt = Math.max(0,state.playSeconds - 90);
    } else if (recipe.id === 'festival-lantern' && state.home.decorations.indexOf('festival-lights') < 0) {
      state.home.decorations.push('festival-lights');
    } else if (recipe.id === 'legendary-bridge') {
      var legendaryNode = state.equippedInstrument + '-legendary';
      if (state.masteryNodes.indexOf(legendaryNode) < 0) state.masteryNodes.push(legendaryNode);
    } else if (recipe.id === 'encore-crown') {
      if (state.skills.indexOf('encore') < 0) state.skills.push('encore');
      if (state.home.decorations.indexOf('golden-bloom') < 0) state.home.decorations.push('golden-bloom');
    }
  }

  function craftProductionRecipe(id) {
    var recipe = recipeById(id);
    if (!recipe || state.knownRecipes.indexOf(id) < 0) return {ok:false,reason:'recipe_locked'};
    var profession = state.professions[recipe.profession];
    if (!profession || profession.level < recipe.level) return {ok:false,reason:'mastery_too_low'};
    if (!canAffordRecipe(recipe)) return {ok:false,reason:'missing_materials'};
    Object.keys(recipe.cost).forEach(function (key) {
      if (key === 'beatcoins') {
        state.beatcoins -= recipe.cost[key];
        state.statistics.beatcoinsSpent += recipe.cost[key];
      } else {
        state.craftingMaterials[key] -= recipe.cost[key];
      }
    });
    state.craftedItems[id] = (state.craftedItems[id] || 0) + 1;
    applyRecipeEffect(recipe);
    gainProfessionXp(recipe.profession,12 + recipe.level * 2,'Crafting ' + recipe.name);
    audioCall('sfx','unlock');
    showToast('CRAFTED · ' + recipe.name.toUpperCase(),recipe.effect,'#ffc857',3.4);
    saveGame(true);
    updateHUD(true);
    return {ok:true,crafted:state.craftedItems[id]};
  }

  function updateProductionRecipeUnlocks() {
    if (state.stageBosses.length >= 4) state.dreamEncore.unlocked = true;
    var unlocks = [
      ['heartwood-pickup',state.professions.crafting.level >= 3],
      ['spore-tonic',state.chapter >= 2],
      ['prism-coil',state.chapter >= 3],
      ['tideglass-brooch',state.chapter >= 4],
      ['echo-core-mod',state.professions.crafting.level >= 7],
      ['odin-trail-mix',state.odinRecruited && state.professions.cooking.level >= 5],
      ['festival-lantern',state.completedQuests.indexOf('luma-festival') >= 0],
      ['legendary-bridge',state.professions.crafting.level >= 12 && state.miniBossesDefeated.length >= 3],
      ['encore-crown',state.dreamEncore.bestWave >= 5]
    ];
    unlocks.forEach(function (entry) {
      if (entry[1] && state.knownRecipes.indexOf(entry[0]) < 0) state.knownRecipes.push(entry[0]);
    });
  }

  function finishDreamEncore(completed) {
    if (!state.dreamEncore.active && !dreamEncoreRuntime.wave) return;
    var clearedWaves = dreamEncoreRuntime.completedWaves;
    state.dreamEncore.active = false;
    state.dreamEncore.bestWave = Math.max(state.dreamEncore.bestWave,clearedWaves);
    if (!completed) {
      enemies.forEach(function (enemy) {
        if (!dreamEncoreRuntime.activeEnemyIds.has(enemy.id) || enemy.dead) return;
        releaseEnemyAttackSlot(enemy);
        enemy.dead = true;
        enemy.deathTimer = enemy.deathDuration || 1.3;
      });
    }
    dreamEncoreRuntime.activeEnemyIds.clear();
    dreamEncoreRuntime.wave = 0;
    dreamEncoreRuntime.waveCooldown = 0;
    if (completed) {
      var encoreReward = 20 + state.dreamEncore.rank * 5;
      state.beatcoins += encoreReward;
      state.statistics.beatcoinsEarned += encoreReward;
      state.dreamEncore.rank = clamp(state.dreamEncore.rank + 1,1,25);
      addCraftingMaterial('echoCore',2);
      gainProfessionXp('bossHunting',24,'Clearing a Dream Encore set');
      showToast('DREAM ENCORE CLEARED',
        '+' + encoreReward + ' Beatcoins · 2 Echo Cores · Encore rank ' + state.dreamEncore.rank,
        '#d77cff',4.2);
      audioCall('sfx','win');
    } else if (clearedWaves > 0) {
      showToast('ENCORE SET ENDED','Best cleared wave: ' + clearedWaves + '. Return when the band is ready.','#b7a0ff',3.2);
    }
    saveGame(true);
    updateHUD(true);
  }

  function startDreamEncore() {
    updateProductionRecipeUnlocks();
    if (!state.dreamEncore.unlocked) {
      showToast('DREAM ENCORE LOCKED','Defeat all four region bosses first.','#ff7892',2.8);
      return {ok:false,reason:'story_locked'};
    }
    if (!started || dialogue || paused || boss || state.dreamEncore.active) return {ok:false,reason:'unavailable'};
    if (state.stage === 1 && firstStageRuntime.safe) {
      showToast('ENCORE NEEDS A STAGE','Leave the protected tutorial area before starting the set.','#ff7892',2.8);
      return {ok:false,reason:'safe_zone'};
    }
    var nearbyHostiles = enemies.some(function (enemy) {
      return !enemy.dead && !enemy.progressionLocked && distanceSquared(enemy,player) < 122500;
    });
    if (nearbyHostiles) {
      showToast('FINISH THE CURRENT VERSE','Clear nearby enemies before beginning Dream Encore.','#ffc857',2.8);
      return {ok:false,reason:'encounter_active'};
    }
    state.dreamEncore.active = true;
    state.dreamEncore.runs++;
    dreamEncoreRuntime.wave = 0;
    dreamEncoreRuntime.completedWaves = 0;
    dreamEncoreRuntime.waveCooldown = 1.2;
    dreamEncoreRuntime.activeEnemyIds.clear();
    encounterDirector.activeEvent = null;
    encounterDirector.cooldown = 60;
    showToast('DREAM ENCORE','Five escalating waves. No procedural encounters can interrupt the set.','#d77cff',3.8);
    return {ok:true,rank:state.dreamEncore.rank};
  }

  function spawnDreamEncoreEnemy(index,wave) {
    var angle = index * 2.25 + wave * 0.61;
    var placement = findValidEnemySpawn(player,{
      radius:20,baseRadius:175 + index * 18,radiusStep:26,angle:angle,
      playerPosition:player,enforcePlayerDistance:true,minimumPlayerDistance:145,attempts:18
    });
    if (!placement.position) return null;
    var enemy = makeEnemy([
      'dream_' + Date.now() + '_' + wave + '_' + index,
      'thorn',placement.position.x,placement.position.y,'dream-encore'
    ],(wave + index + state.stage) % 10);
    if (wave === 5 && index === 0) {
      var eliteDef = ELITE_VARIANTS[(state.stage + state.dreamEncore.rank) % ELITE_VARIANTS.length];
      enemy.elite = true;
      enemy.eliteId = eliteDef.id;
      enemy.eliteName = eliteDef.name;
      enemy.eliteColor = eliteDef.color;
      enemy.hp = enemy.maxHp += 7 + Math.floor(state.dreamEncore.rank / 3);
      enemy.r += 4;
    }
    prepareEnemyForSpawn(enemy,{fixed:false,playerPosition:player});
    enemy.spawnWarmup = Math.max(enemy.spawnWarmup || 0,1.15);
    enemies.push(enemy);
    return enemy;
  }

  function updateDreamEncore(dt) {
    if (!state.dreamEncore.active) return;
    dreamEncoreRuntime.activeEnemyIds.forEach(function (enemyId) {
      var live = enemies.some(function (enemy) { return enemy.id === enemyId && !enemy.dead; });
      if (!live) dreamEncoreRuntime.activeEnemyIds.delete(enemyId);
    });
    if (dreamEncoreRuntime.activeEnemyIds.size) return;
    if (dreamEncoreRuntime.wave > dreamEncoreRuntime.completedWaves) {
      dreamEncoreRuntime.completedWaves = dreamEncoreRuntime.wave;
      dreamEncoreRuntime.waveCooldown = 2.4;
      if (dreamEncoreRuntime.completedWaves >= 5) {
        finishDreamEncore(true);
        return;
      }
    }
    dreamEncoreRuntime.waveCooldown -= dt;
    if (dreamEncoreRuntime.waveCooldown > 0) return;
    var nextWave = dreamEncoreRuntime.completedWaves + 1;
    var count = Math.min(5,1 + nextWave + Math.floor(state.dreamEncore.rank / 6));
    var spawned = 0;
    for (var index = 0; index < count; index++) {
      var enemy = spawnDreamEncoreEnemy(index,nextWave);
      if (!enemy) continue;
      dreamEncoreRuntime.activeEnemyIds.add(enemy.id);
      spawned++;
    }
    if (!spawned) {
      dreamEncoreRuntime.waveCooldown = 1.4;
      return;
    }
    dreamEncoreRuntime.wave = nextWave;
    showToast('ENCORE WAVE ' + nextWave + ' / 5',
      nextWave === 5 ? 'The headliner has entered the dream.' : spawned + ' echoes join the arrangement.',
      nextWave === 5 ? '#ffc857' : '#b7a0ff',2.8);
  }

  function applySettings() {
    document.body.classList.toggle('large-text', !!settings.largeText);
    document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
    var interfaceSizes = { compact: 0.88, standard: 1, large: 1.14 };
    var interfaceSize = interfaceSizes[settings.interfaceSize] ? settings.interfaceSize : 'standard';
    settings.interfaceSize = interfaceSize;
    document.documentElement.style.setProperty('--interface-scale', interfaceSizes[interfaceSize]);
    var difficulty = byId('difficultySelect');
    var music = byId('musicVolume');
    var sfx = byId('sfxVolume');
    var screenShake = byId('screenShake');
    var reducedMotion = byId('reducedMotion');
    var objectiveArrow = byId('objectiveArrow');
    var largeText = byId('largeText');
    var interfaceSize = byId('interfaceSize');
    if (difficulty) difficulty.value = settings.difficulty;
    if (music) music.value = settings.musicVolume;
    if (sfx) sfx.value = settings.sfxVolume;
    if (screenShake) screenShake.checked = !!settings.screenShake;
    if (reducedMotion) reducedMotion.checked = !!settings.reducedMotion;
    if (objectiveArrow) objectiveArrow.checked = !!settings.objectiveArrow;
    if (largeText) largeText.checked = !!settings.largeText;
    if (interfaceSize) interfaceSize.value = settings.interfaceSize;
    audioCall('setMusicVolume', settings.musicVolume);
    audioCall('setSfxVolume', settings.sfxVolume);
  }

  function bindSetting(id, key, isNumber) {
    var el = byId(id);
    if (!el) return;
    el.addEventListener('input', function () {
      settings[key] = isNumber ? clamp(Number(el.value), 0, 1) : el.type === 'checkbox' ? el.checked : el.value;
      saveSettings();
      applySettings();
    });
    el.addEventListener('change', function () {
      settings[key] = isNumber ? clamp(Number(el.value), 0, 1) : el.type === 'checkbox' ? el.checked : el.value;
      saveSettings();
      applySettings();
    });
  }

  function resetPlayer(useSavedPosition) {
    state.encoreUsed = false;
    var spawn = currentLevel ? currentLevel.spawn : {x:HUB.x,y:HUB.y+115};
    player.x = useSavedPosition ? state.x : spawn.x;
    player.y = useSavedPosition ? state.y : spawn.y;
    if (state.stage === 1 && distance(player, BOSS_CENTER) < 370) {
      player.x = 1900;
      player.y = 1320;
    }
    if (circleHitsObstacle(player.x, player.y, player.r)) {
      player.x = spawn.x;
      player.y = spawn.y;
      state.x = player.x;
      state.y = player.y;
    }
    player.maxHealth = (state.extraHeart ? 6 : 5) + (state.skills.indexOf('grove-vitality') >= 0 ? 1 : 0);
    player.health = player.maxHealth;
    player.facing = -Math.PI / 2;
    player.invuln = 1;
    player.attackCooldown = 0;
    player.dashCooldown = 0;
    player.pulseCooldown = 0;
    player.attackHeld = false;
    player.attackHold = 0;
    player.chargedThisHold = false;
    player.hurtTimer = 0;
    resetEquipmentVisualRuntime(false);
    camera.x = player.x;
    camera.y = player.y;
    if (state.odinRecruited) {
      odin.x = player.x - 40;
      odin.y = player.y + 30;
      odin.target = null;
      resetOdinVisuals();
    }
  }

  function clearTransient() {
    attacks = [];
    pulses = [];
    projectiles = [];
    hazards = [];
    healthPickups = [];
    particles = [];
    floatingTextCount = 0;
    boss = null;
    bossPadLatch = null;
    dialogue = null;
    pendingComposer = false;
    if (melodyPreviewTimer) {
      clearInterval(melodyPreviewTimer);
      melodyPreviewTimer = null;
    }
    hudSignature = '';
    mapOpen = false;
    inventoryOpen = false;
    shopOpen = false;
    skillsOpen = false;
    statisticsOpen = false;
    instrumentsOpen = false;
    homeOpen = false;
    instrumentsReturnsToPause = false;
    homeReturnsToPause = false;
    shopReturnsToPause = false;
    skillsReturnsToPause = false;
    statisticsReturnsToPause = false;
    inventoryReturnsToPause = false;
    composerOpen = false;
    instrumentUltimateCharge = 0;
    instrumentHitStreak = 0;
    encounterDirector = {tension:0,cooldown:24,activeEvent:null,weatherTimer:0,recentDamage:0};
    inputBuffer.attack = inputBuffer.dodge = inputBuffer.block = inputBuffer.interact = 0;
    firstStageRuntime.attackSlots.clear();
    mapAnimationTime = 0;
    paused = false;
    keys.clear();
    setHidden(byId('pauseScreen'), true);
    setHidden(byId('dialogueBox'), true);
    setHidden(byId('composerScreen'), true);
    setHidden(byId('mapScreen'), true);
    setHidden(byId('inventoryScreen'), true);
    setHidden(byId('shopScreen'), true); setHidden(byId('skillsScreen'), true); setHidden(byId('statisticsScreen'), true);
    setHidden(byId('instrumentsScreen'), true); setHidden(byId('homeScreen'), true);
    setHidden(byId('endingScreen'), true);
  }

  function beginAudio() {
    audioCall('setProgress', state.notes.length, state.melody, state.notes.slice());
    audioCall('start');
    settlePromise(audioCall('unlock'));
  }

  function newGame() {
    removeStoredSaves();
    state = freshState();
    campaignFinaleShown = false;
    clearTransient();
    activateLevel(1);
    resetEnemies();
    resetPlayer(false);
    resetFirstStageRuntime('new');
    spawnStageHeartblooms(1);
    started = true;
    setHidden(byId('titleScreen'), true);
    beginAudio();
    if (orientationBlocked) togglePause(true);
    saveGame(true);
    showToast('A SILENT STAGE', 'Find EEMS at the glowing mix-stone.', '#d77cff', 4.2);
    updateHUD();
  }

  function continueGame() {
    var loaded = null;
    loaded = safeJson(readStorage(SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(LEGACY_SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(OLDER_SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(OLDEST_SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(ANCIENT_SAVE_KEY), null);
    state = sanitizeState(loaded);
    campaignFinaleShown = false;
    clearTransient();
    activateLevel(state.stage);
    resetEnemies();
    resetPlayer(true);
    resetFirstStageRuntime('load');
    spawnStageHeartblooms(state.stage);
    started = true;
    setHidden(byId('titleScreen'), true);
    beginAudio();
    if (orientationBlocked) togglePause(true);
    showToast('WELCOME BACK', getObjective().text, '#56f0c4', 3.4);
    updateHUD();
    if (state.stage === 4 && bossDefeatedForStage(4) && !state.campaignFinaleSeen) {
      window.setTimeout(showCampaignFinale, 700);
    }
  }

  function showToast(title, text, color, duration) {
    var el = byId('toast');
    if (!el) return;
    if (toastTimer > 0.2) {
      toastQueue.push([title, text, color, duration]);
      return;
    }
    el.innerHTML = '<strong></strong><span></span>';
    el.querySelector('strong').textContent = title;
    el.querySelector('span').textContent = text || '';
    el.style.setProperty('--toast-color', color || '#56f0c4');
    setHidden(el, false);
    el.classList.add('show');
    toastTimer = duration || 2.6;
  }

  function updateToast(dt) {
    if (toastTimer <= 0) return;
    toastTimer -= dt;
    if (toastTimer <= 0) {
      var el = byId('toast');
      if (el) el.classList.remove('show');
      if (toastQueue.length) {
        var next = toastQueue.shift();
        setTimeout(function () { showToast(next[0], next[1], next[2], next[3]); }, 180);
      }
    }
  }

  function openDialogue(speaker, lines, onClose) {
    dialogue = { speaker: speaker, lines: lines, index: 0, onClose: onClose || null };
    var box = byId('dialogueBox');
    setHidden(box, false);
    setOverlayIsolation('dialogue', 'dialogueBox', true);
    renderDialogue();
    audioCall('sfx', 'dialogue');
    if (touchCapable) focusSoon('dialogueContinueButton');
  }
  function renderDialogue() {
    if (!dialogue) return;
    var name = byId('speakerName');
    var text = byId('dialogueText');
    var hint = byId('dialogueHint');
    var nextButton = byId('dialogueContinueButton');
    var portrait = byId('dialoguePortrait');
    if (name) name.textContent = dialogue.speaker;
    if (text) text.textContent = dialogue.lines[dialogue.index];
    if (portrait) {
      var portraitId = dialogue.speaker.toLowerCase();
      var portraitNpc = allLevelItems('npcs').find(function (npc) {
        return npc.id === portraitId || npc.name.toLowerCase() === portraitId;
      });
      if (portraitNpc) portraitId = portraitNpc.spriteId || portraitNpc.id;
      var hasPortrait = !!portraitNpc || ['blu','jimbo','eems','brad','mara','pip','zephra','nix','tavi','luma'].indexOf(portraitId) >= 0;
      portrait.hidden = !hasPortrait;
      if (hasPortrait) {
        var expressions = ['neutral','talking','happy','surprised','sad','angry'];
        portrait.src = window.MossSprites ?
          window.MossSprites.portraitPath(portraitId, expressions[dialogue.index % expressions.length]) :
          SPRITE_PATH + portraitId + '-sheet.png';
        portrait.style.width = '100%';
        portrait.style.height = '100%';
        portrait.style.objectFit = 'contain';
        portrait.style.transform = 'none';
      }
    }
    var hasNext = dialogue.index < dialogue.lines.length - 1;
    if (hint) hint.textContent = hasNext ? 'E / ENTER — NEXT' : 'E / ENTER — CLOSE';
    if (nextButton) {
      nextButton.textContent = hasNext ? 'Next' : 'Close';
      nextButton.setAttribute('aria-label', (hasNext ? 'Next' : 'Close') + ' dialogue with ' + dialogue.speaker);
    }
  }
  function advanceDialogue() {
    if (!dialogue) return;
    if (dialogue.index < dialogue.lines.length - 1) {
      dialogue.index++;
      renderDialogue();
      audioCall('sfx', 'dialogue');
      return;
    }
    var onClose = dialogue.onClose;
    dialogue = null;
    setOverlayIsolation('dialogue', 'dialogueBox', false);
    setHidden(byId('dialogueBox'), true);
    focusSoon('gameCanvas');
    if (typeof onClose === 'function') onClose();
    saveGame(true);
  }

  function hasAllNotes() {
    return NOTE_ORDER.every(function (n) { return state.notes.indexOf(n) >= 0; });
  }

  function getObjective() {
    if (state.stage === 1) {
      if (!state.metEems) return { text: 'Meet EEMS at the mix-stone', x: 1435, y: 880 };
      if (state.weeds.length < 6) return { text: 'Gather Glowweed for Jimbo · ' + state.weeds.length + '/6', x: 1175, y: 930 };
      if (!state.pruner) return { text: 'Take 6 Glowweed to Jimbo', x: 1175, y: 930 };
      if (!state.pulse) return { text: 'Help Blu east of the grove', x: 1760, y: 740 };
      if (!hasAllNotes()) {
        var shrineTarget = shrines.find(function (s) { return state.notes.indexOf(s.note) < 0; });
        return { text: 'Recover the lost notes · ' + state.notes.length + '/4', x: shrineTarget.x, y: shrineTarget.y };
      }
      if (!state.composed) return { text: 'Compose your song with EEMS', x: 1435, y: 880 };
      if (!bossDefeatedForStage(1)) return { text: 'Enter the Feedback Amphitheatre', x: BOSS_CENTER.x, y: BOSS_CENTER.y };
      return {text:'Enter the Rootsong Gate',x:1660,y:1080};
    }
    if (state.stage === 2) {
      var rootDrum = drums.find(function (d) { return state.drums.indexOf(d.id) < 0; });
      if (rootDrum) return {text:'Wake the Rootsong drums · ' + countCollected(drums,state.drums) + '/3',x:rootDrum.x,y:rootDrum.y};
      var pip = npcById('pip') || {x:1800,y:1190};
      if (state.chapterRelics.indexOf('rootsong') < 0) return {text:'Bring the Rootsong rhythm to Pip',x:pip.x,y:pip.y};
      if (!bossDefeatedForStage(2)) return {text:'Defeat the Rootbound Colossus',x:BOSS_CENTER.x,y:BOSS_CENTER.y};
      return {text:'Enter the Skyglass Gate',x:2070,y:750};
    }
    if (state.stage === 3) {
      var glassChime = speakers.find(function (s) { return state.speakers.indexOf(s.id) < 0; });
      if (glassChime) return {text:'Retune the Skyglass chimes · ' + countCollected(speakers,state.speakers) + '/3',x:glassChime.x,y:glassChime.y};
      var zephra = npcById('zephra') || {x:1810,y:1190};
      if (state.chapterRelics.indexOf('skyglass') < 0) return {text:'Bring the clear chord to Zephra',x:zephra.x,y:zephra.y};
      if (!bossDefeatedForStage(3)) return {text:'Defeat the Prism Choir',x:BOSS_CENTER.x,y:BOSS_CENTER.y};
      return {text:'Enter the Moonwake Gate',x:2070,y:750};
    }
    var moonShell = stageTokens.find(function (token) { return state.stageTokens.indexOf(token.id) < 0; });
    if (moonShell) return {text:'Gather the Moonwake shells · ' + countCollected(stageTokens,state.stageTokens) + '/3',x:moonShell.x,y:moonShell.y};
    var tavi = npcById('tavi') || {x:1840,y:1220};
    if (state.chapterRelics.indexOf('moonwake') < 0) return {text:'Carry the tide-song to Tavi',x:tavi.x,y:tavi.y};
    if (!bossDefeatedForStage(4)) return {text:'Defeat the Tidebreaker',x:BOSS_CENTER.x,y:BOSS_CENTER.y};
    var outstanding=typeof EXPANSION_QUESTS!=='undefined'&&EXPANSION_QUESTS.find(function(quest){
      return quest.category==='main'&&quest.unlock()&&state.completedQuests.indexOf(quest.id)<0;
    });
    if(outstanding)return{text:outstanding.stage===state.stage?outstanding.objective:'World Map · travel to '+STAGE_NAMES[outstanding.stage],x:outstanding.stage===state.stage?HUB.x:currentLevel.hub.x,y:outstanding.stage===state.stage?HUB.y:currentLevel.hub.y};
    return { text: 'The four stages are singing · prepare the Final Concert', x: HUB.x, y: HUB.y };
  }

  var EXPANSION_QUESTS = [
    {id:'forest-amplifiers',category:'main',name:'Repair the Forest Amplifiers',stage:1,unlock:function(){return state.bossDefeated;},progress:function(){return Math.min(3,state.speakers.filter(function(id){return id.indexOf('s')===0;}).length);},goal:3,objective:'Retune three moss-covered amplifiers in the Static Wilds.',reward:'6 Beatcoins · Workshop schematic'},
    {id:'ancient-speakers',category:'main',name:'Restore the Ancient Speakers',stage:2,unlock:function(){return state.chapter>=2;},progress:function(){return countCollected(LEVELS[2].drums,state.drums);},goal:3,objective:'Wake every Rootsong drum-speaker and carry their bass to Pip.',reward:'1 Skill Point · Root Lantern'},
    {id:'lost-vinyl',category:'main',name:'Recover the Lost Vinyl',stage:1,unlock:function(){return state.metNix;},progress:function(){return collectedSetCount('mossvale');},goal:4,objective:'Recover Mossvale’s four lost recordings for Nix’s archive.',reward:'Vinyl Wall · 8 Beatcoins'},
    {id:'travelling-band',category:'main',name:'Help the Travelling Band',stage:3,unlock:function(){return state.chapter>=2;},progress:function(){return [state.metPip,state.metZephra,state.metTavi,state.metLuma].filter(Boolean).length;},goal:4,objective:'Find Pip, Zephra, Tavi and Luma across the four roads.',reward:'Moon-silver Microphone'},
    {id:'missing-musicians',category:'main',name:'Rescue the Missing Musicians',stage:4,unlock:function(){return state.chapter>=3;},progress:function(){return [state.metMara,state.metPip,state.metZephra,state.metNix,state.metTavi,state.metLuma].filter(Boolean).length;},goal:6,objective:'Reconnect every named musician with the growing ensemble.',reward:'12 Beatcoins · Festival Lights'},
    {id:'corrupted-resonance',category:'main',name:'Investigate Corrupted Resonance',stage:3,unlock:function(){return state.eliteDefeated.length>0||state.chapter>=3;},progress:function(){return state.eliteDefeated.length;},goal:3,objective:'Defeat three different elite echoes and study their rare drops.',reward:'Dream Gate coordinates · 2 Skill Points'},
    {id:'dream-realm',category:'main',name:'Unlock the Dream Realm',stage:1,unlock:function(){return state.completedQuests.indexOf('corrupted-resonance')>=0;},progress:function(){return state.discoveredSecrets.length;},goal:4,objective:'Trace four secret paths until the Dream Gate stabilises.',reward:'Dreamwave cosmetic · 15 Beatcoins'},
    {id:'final-concert',category:'main',name:'The Final Concert',stage:4,unlock:function(){return state.completedQuests.indexOf('dream-realm')>=0||bossDefeatedForStage(4);},progress:function(){return Object.keys(BOSS_DEFS).filter(function(stage){return bossDefeatedForStage(Number(stage));}).length;},goal:4,objective:'Unite every region’s restored song for the final Mossvale concert.',reward:'Final Headliner achievement'},
    {id:'mara-pantry',category:'side',name:'Mara’s Singing Pantry',stage:1,unlock:function(){return state.metMara;},progress:function(){return Math.min(12,state.weeds.length);},goal:12,objective:'Bring Mara twelve Glowweed for a travelling feast.',reward:'Heartbloom crop'},
    {id:'jimbo-garden',category:'side',name:'Jimbo’s Perfect Harvest',stage:1,unlock:function(){return state.metJimbo;},progress:function(){return state.weeds.length;},goal:30,objective:'Harvest all thirty Glowweed without disturbing the grove.',reward:'Golden Bloom decoration'},
    {id:'eems-remix',category:'side',name:'EEMS Remix Protocol',stage:1,unlock:function(){return state.metEems&&state.composed;},progress:function(){return state.unlockedInstruments.length;},goal:6,objective:'Play the recovered composition through all six instrument circuits.',reward:'Final Concert record'},
    {id:'blu-silence',category:'side',name:'Blu’s Rest Between Beats',stage:1,unlock:function(){return state.metBlu;},progress:function(){return Math.min(5,state.statistics.perfectBlocks||0);},goal:5,objective:'Perform five perfect blocks and learn to value the rest between attacks.',reward:'Resonance cooldown charm'},
    {id:'pip-practice',category:'side',name:'Pip’s Impossible Backbeat',stage:2,unlock:function(){return state.metPip;},progress:function(){return Math.min(25,state.statistics.highestCombo||0);},goal:25,objective:'Hold a 25-hit Rhythm Combo for Pip.',reward:'Drumstick alternate combo'},
    {id:'zephra-parts',category:'side',name:'Wind-Tossed Components',stage:3,unlock:function(){return state.metZephra;},progress:function(){return collectedSetCount('skyglass');},goal:4,objective:'Collect four Prism Fragments for Zephra’s bridge tuner.',reward:'Skyglass Mobile'},
    {id:'nix-relics',category:'side',name:'Archive After Midnight',stage:1,unlock:function(){return state.metNix;},progress:function(){return Math.min(8,state.collectibles.length);},goal:8,objective:'Recover eight relic recordings for Nix.',reward:'Collector Compass effect'},
    {id:'tavi-tides',category:'side',name:'Three Tides, One Bow',stage:4,unlock:function(){return state.metTavi;},progress:function(){return countCollected(LEVELS[4].tokens,state.stageTokens);},goal:3,objective:'Collect all three Moonwake shells.',reward:'Tidewood Violin'},
    {id:'luma-festival',category:'side',name:'Lantern Festival Set',stage:4,unlock:function(){return state.metLuma;},progress:function(){return Math.min(3,state.completedQuests.length);},goal:3,objective:'Complete three other quest chains before Luma’s festival.',reward:'Festival Lights · 1 Skill Point'},
    {id:'brad-contract',category:'side',name:'Brad’s Preferred Customer',stage:1,unlock:function(){return true;},progress:function(){return Math.min(5,state.statistics.shopPurchases||0);},goal:5,objective:'Purchase five field goods from Brad.',reward:'10 Beatcoins cashback'}
  ];
  var questSyncTimer = 0;
  var questLogFilter = 'main';

  function expansionQuestById(id) {
    return EXPANSION_QUESTS.find(function(quest){return quest.id===id;});
  }

  function completeExpansionQuest(quest) {
    if(!quest||state.completedQuests.indexOf(quest.id)>=0)return;
    state.completedQuests.push(quest.id);
    state.questStates[quest.id]=quest.goal;
    state.statistics.questsCompleted++;
    gainProfessionXp('questing',quest.category === 'main' ? 20 : 12,'Completing ' + quest.name);
    var questRegion = regionIdForStage(quest.stage);
    state.regionalReputation[questRegion] = clamp(state.regionalReputation[questRegion] +
      (quest.category === 'main' ? 5 : 3),0,100);
    var coins=quest.category==='main'?8:4;
    var skillReward=['ancient-speakers','corrupted-resonance','luma-festival'].indexOf(quest.id)>=0?1:0;
    if(quest.id==='corrupted-resonance')skillReward=2;
    state.beatcoins+=coins;
    state.statistics.beatcoinsEarned+=coins;
    state.skillPoints+=skillReward;
    if(quest.id==='travelling-band')unlockInstrument('microphone','The travelling band restores its moon-silver lead microphone.');
    if(quest.id==='tavi-tides')unlockInstrument('violin','Tavi completes the tidewood bow.');
    if(quest.id==='pip-practice'&&state.masteryNodes.indexOf('drums-combo')<0)state.masteryNodes.push('drums-combo');
    if(quest.id==='corrupted-resonance'){
      if(state.discoveredLocations.indexOf('dream-gate')<0)state.discoveredLocations.push('dream-gate');
      if(state.discoveredSecrets.indexOf('dream-gate')<0)state.discoveredSecrets.push('dream-gate');
    }
    if(quest.id==='zephra-parts'&&state.home.decorations.indexOf('skyglass-mobile')<0)state.home.decorations.push('skyglass-mobile');
    if(quest.id==='lost-vinyl'&&state.home.decorations.indexOf('vinyl-wall')<0)state.home.decorations.push('vinyl-wall');
    if(quest.id==='luma-festival'&&state.home.decorations.indexOf('festival-lights')<0)state.home.decorations.push('festival-lights');
    if(quest.id==='nix-relics'&&state.purchases.indexOf('collector-compass')<0)state.purchases.push('collector-compass');
    if(quest.id==='jimbo-garden'&&state.home.decorations.indexOf('golden-bloom')<0)state.home.decorations.push('golden-bloom');
    if(quest.id==='eems-remix')state.home.jukeboxTrack='Final Concert';
    if(quest.id==='blu-silence'&&state.purchases.indexOf('tempo-ring')<0)state.purchases.push('tempo-ring');
    if(quest.id==='final-concert'&&state.achievements.indexOf('final-headliner')<0)state.achievements.push('final-headliner');
    showToast('QUEST COMPLETE · '+quest.name,quest.reward+' · +'+coins+' Beatcoins',quest.category==='main'?'#ffc857':'#7ce4d1',4.2);
    audioCall('sfx','unlock');
    saveGame(true);
  }

  function syncExpansionQuests(dt) {
    questSyncTimer-=dt;
    if(questSyncTimer>0)return;
    questSyncTimer=1;
    EXPANSION_QUESTS.forEach(function(quest){
      if(!quest.unlock()||state.completedQuests.indexOf(quest.id)>=0)return;
      var progress=clamp(Math.floor(quest.progress()),0,quest.goal);
      state.questStates[quest.id]=progress;
      if(progress>=quest.goal)completeExpansionQuest(quest);
    });
    syncAchievements();
  }

  function unlockAchievement(id,name,description) {
    if(state.achievements.indexOf(id)>=0)return;
    state.achievements.push(id);
    showToast('ACHIEVEMENT · '+name,description,'#f6e36d',4);
    audioCall('sfx','unlock');
    saveGame(true);
  }

  function syncAchievements() {
    if(state.encoreUsed)unlockAchievement('first-encore','First Encore','Survive a fatal beat and keep playing.');
    if(state.unlockedInstruments.length>=3)unlockAchievement('instrumentalist','Instrumentalist','Unlock three distinct instruments.');
    if(INSTRUMENTS.every(function(instrument){return instrumentMasteryRecord(instrument.id).level>=10;}))unlockAchievement('master-of-six','Master of Six','Reach mastery 10 with every instrument.');
    if(state.eliteDefeated.length>=ELITE_VARIANTS.length)unlockAchievement('elite-hunter','Elite Hunter','Archive every elite variant.');
    if(state.home.unlocked)unlockAchievement('home-sweet-home','Home Sweet Home','Restore the Afterglow House.');
    if(state.home.greenhouseHarvests>=5)unlockAchievement('green-thumb','Green Thumb','Complete five greenhouse harvests.');
    if(state.home.odinFriendship>=100)unlockAchievement('best-friend','Best Friend','Reach maximum friendship with Odin.');
    if(Object.keys(BOSS_DEFS).every(function(stage){return bossDefeatedForStage(Number(stage));}))unlockAchievement('world-tour','World Tour','Clear all four regional bosses.');
    if(state.discoveredSecrets.length>=5)unlockAchievement('secret-listener','Secret Listener','Find every hidden location.');
    if(state.completedQuests.indexOf('final-concert')>=0)unlockAchievement('final-headliner','Final Headliner','Complete the definitive concert quest.');
  }


  function comboTier() {
    if (rhythmCombo.count >= 100) return 4;
    if (rhythmCombo.count >= 50) return 3;
    if (rhythmCombo.count >= 25) return 2;
    if (rhythmCombo.count >= 10) return 1;
    return 0;
  }

  function resetCombo(reason) {
    if (rhythmCombo.count <= 0) return;
    rhythmCombo.count = activeResonance('nature') && reason === 'damage' ? Math.floor(rhythmCombo.count * 0.5) : 0;
    rhythmCombo.multiplier = rhythmCombo.count >= 50 ? 2 : rhythmCombo.count >= 25 ? 1.5 : rhythmCombo.count >= 10 ? 1.25 : 1;
    rhythmCombo.timer = rhythmCombo.count ? 2.2 : 0;
    rhythmCombo.lastQuality = reason === 'damage' && activeResonance('nature') ? 'ROOTED' : 'BROKEN';
    rhythmCombo.flash = 0.5;
    updateHUD(true);
  }

  function registerRhythmAttack() {
    var beat = rhythmCombo.beatLength;
    var phase = (nowTime % beat) / beat;
    var distanceToBeat = Math.min(phase, 1 - phase);
    var perfectWindow = activeResonance('conductor') ? 0.18 : 0.12;
    var goodWindow = activeResonance('conductor') ? 0.32 : 0.24;
    var gain = 0;
    if (distanceToBeat <= perfectWindow) {
      gain = activeResonance('conductor') ? 3 : 2;
      rhythmCombo.lastQuality = 'PERFECT';
      state.statistics.perfectBeats = (state.statistics.perfectBeats || 0) + 1;
    } else if (distanceToBeat <= goodWindow) {
      gain = 1;
      rhythmCombo.lastQuality = 'GOOD';
    } else {
      resetCombo('miss');
      return;
    }
    var oldTier = comboTier();
    rhythmCombo.count += gain;
    rhythmCombo.timer = 2.4;
    rhythmCombo.flash = 0.28;
    rhythmCombo.multiplier = rhythmCombo.count >= 100 ? 2.5 : rhythmCombo.count >= 50 ? 2 : rhythmCombo.count >= 25 ? 1.5 : rhythmCombo.count >= 10 ? 1.25 : 1;
    state.statistics.highestCombo = Math.max(state.statistics.highestCombo || 0, rhythmCombo.count);
    var newTier = comboTier();
    if (newTier > oldTier) {
      var labels = ['', 'GROOVE', 'FLOW', 'FEVER', 'TRANSCENDENT'];
      showToast(labels[newTier] + ' COMBO', rhythmCombo.count + ' hits · ×' + rhythmCombo.multiplier + ' rhythm power', '#f6e36d', 2.2);
      if (activeResonance('psychedelic') && newTier >= 2) {
        pulses.push({x:player.x,y:player.y,life:0.38,maxLife:0.38,r:0});
        enemies.forEach(function(e){ if(!e.dead && distance(player,e)<110) hitEnemy(e,1,player.x,player.y); });
        if (boss && !boss.dead && distance(player,boss)<110+boss.r) hitBoss(1);
      }
    }
  }

  function comboDamageBonus() {
    var tier = comboTier();
    var bonus = tier >= 4 ? 2 : tier >= 2 ? 1 : 0;
    if (activeResonance('heavy') && tier >= 1) bonus += 1;
    return bonus;
  }

  function updateRhythmCombo(dt) {
    rhythmCombo.flash = Math.max(0, rhythmCombo.flash - dt);
    if (rhythmCombo.count > 0) {
      rhythmCombo.timer -= dt;
      if (rhythmCombo.timer <= 0) resetCombo('timeout');
    }
  }

  function updateHUD(force) {
    var hearts = byId('hearts');
    var healthChip = byId('healthChip');
    var heartbloomCount = byId('heartbloomCount');
    var touchHeartbloomCount = byId('touchHeartbloomCount');
    var touchHealButton = byId('touchHealButton');
    var weedCount = byId('weedCount');
    var backpackHudButton = byId('backpackHudButton');
    var objective = byId('objective');
    var stageName = byId('stageName');
    var abilityBar = byId('abilityBar');
    var abilityKey = document.querySelector('.ability-key');
    var notePills = byId('notePills');
    var pauseLocation = byId('pauseLocation');
    var objectiveInfo = getObjective();
    var nextSignature = [
      player.health, player.maxHealth, state.heartblooms, state.weeds.length, state.notes.join(','), state.collectibles.join(','), state.melody.join(','),
      state.pulse ? 1 : 0, state.charged ? 1 : 0, state.pruner ? 1 : 0, state.activeResonance, state.equippedInstrument,
      Math.floor(instrumentUltimateCharge/5), state.weather, state.stage, rhythmCombo.count, rhythmCombo.lastQuality,
      Math.ceil(rhythmCombo.timer*10), rhythmCombo.flash>0?1:0, Math.round(player.blockStamina), player.blocking?1:0,
      player.guardBroken>0?1:0, player.counterWindow>0?1:0, objectiveInfo.text
    ].join('|');
    if (!force && nextSignature === hudSignature) return;
    hudSignature = nextSignature;
    if (hearts) {
      var heartText = '';
      for (var i = 0; i < player.maxHealth; i++) heartText += i < player.health ? '♥' : '♡';
      hearts.textContent = heartText;
      hearts.setAttribute('aria-label', player.health + ' of ' + player.maxHealth + ' hearts');
    }
    if (healthChip) healthChip.setAttribute('aria-label', player.health + ' of ' + player.maxHealth + ' hearts, ' + state.heartblooms + ' stored Heartblooms');
    if (heartbloomCount) heartbloomCount.textContent = state.heartblooms;
    if (touchHeartbloomCount) touchHeartbloomCount.textContent = state.heartblooms;
    if (touchHealButton) {
      touchHealButton.disabled = state.heartblooms <= 0 || player.health >= player.maxHealth;
      touchHealButton.setAttribute('aria-label', state.heartblooms <= 0 ? 'Heal, medicine pouch empty' :
        player.health >= player.maxHealth ? 'Heal, health already full, ' + state.heartblooms + ' stored' :
          'Use one stored Heartbloom, ' + state.heartblooms + ' available');
    }
    if (weedCount) weedCount.textContent = state.weeds.length + '/30';
    if (backpackHudButton) backpackHudButton.setAttribute('aria-label', 'Open backpack, ' + state.weeds.length + ' of 30 Glowweed collected');
    if (objective) objective.textContent = objectiveInfo.text;
    if (stageName) stageName.textContent = STAGE_KICKERS[state.stage] || STAGE_KICKERS[1];
    if (pauseLocation) pauseLocation.textContent = STAGE_NAMES[state.stage] + ' is holding your place · ' + equippedInstrument().name + ' · ' + state.weather.replace('-',' ');
    var comboCount = byId('comboCount'), comboMultiplier = byId('comboMultiplier'), comboFill = byId('comboFill'), comboQuality = byId('comboQuality'), comboHud = byId('comboHud');
    if (comboCount) comboCount.textContent = rhythmCombo.count;
    if (comboMultiplier) comboMultiplier.textContent = '×' + rhythmCombo.multiplier;
    if (comboQuality) comboQuality.textContent = rhythmCombo.lastQuality || 'FIND THE BEAT';
    if (comboFill) comboFill.style.width = Math.min(100, (rhythmCombo.timer / 2.4) * 100) + '%';
    if (comboHud) {
      var comboVisible = rhythmCombo.count > 0 || rhythmCombo.flash > 0;
      comboHud.hidden = !comboVisible;
      comboHud.classList.toggle('combo-visible', comboVisible);
      comboHud.classList.toggle('combo-active', rhythmCombo.count > 0);
    }
    var blockHud = byId('blockHud'), blockFill = byId('blockFill'), blockValue = byId('blockValue'), blockStatus = byId('blockStatus');
    if (blockFill) blockFill.style.width = Math.max(0, player.blockStamina) + '%';
    if (blockValue) blockValue.textContent = Math.ceil(player.blockStamina);
    if (blockStatus) blockStatus.textContent = player.guardBroken > 0 ? 'BROKEN' : (player.counterWindow > 0 ? 'COUNTER READY' : (player.blocking ? 'GUARDING' : 'STAMINA'));
    if (blockHud) {
      var blockVisible = player.blocking || player.blockStamina < player.blockMaxStamina || player.guardBroken > 0 || player.counterWindow > 0;
      blockHud.hidden = !blockVisible;
      blockHud.classList.toggle('block-active', player.blocking);
      blockHud.classList.toggle('block-broken', player.guardBroken > 0);
      blockHud.classList.toggle('counter-ready', player.counterWindow > 0);
    }
    if (abilityBar) {
      var instrument=equippedInstrument();
      var abilities = touchCapable ? [instrument.name.toUpperCase(), 'BLOCK', 'DODGE'] : ['SPACE  '+instrument.attack.toUpperCase(), 'F  BLOCK', 'SHIFT  DASH'];
      if (!touchCapable) abilities.push('H  HEAL ×' + state.heartblooms);
      if (state.pulse) abilities.push((touchCapable ? 'PULSE · ' : 'Q  ') + (instrumentUltimateCharge>=100?instrument.ultimate.toUpperCase():instrument.special.toUpperCase()));
      abilities.push(touchCapable ? 'HOLD STRIKE  CHARGE' : 'HOLD SPACE  CHARGE');
      if (state.activeResonance) abilities.push(state.activeResonance.toUpperCase() + ' RESONANCE');
      abilityBar.textContent = abilities.join('   ·   ');
    }
    if (abilityKey) abilityKey.textContent = touchCapable ? 'TOUCH' : 'QUICK KEYS';
    if (notePills) {
      notePills.innerHTML = '';
      NOTE_ORDER.forEach(function (note) {
        var pill = document.createElement('span');
        pill.textContent = note;
        pill.className = state.notes.indexOf(note) >= 0 ? 'note-pill found' : 'note-pill is-locked';
        pill.style.setProperty('--note-color', NOTE_COLORS[note]);
        pill.setAttribute('aria-label', 'Note ' + note + (state.notes.indexOf(note) >= 0 ? ' found' : ' missing'));
        notePills.appendChild(pill);
      });
    }
    audioCall('setProgress', state.notes.length, state.melody, state.notes.slice());
    audioCall('setAdaptiveState',{
      stage:state.stage,
      scene:boss&&!boss.dead?'boss':rhythmCombo.count>0?'combat':'exploration',
      intensity:boss&&!boss.dead?1:Math.min(1,rhythmCombo.count/50),
      instrument:state.equippedInstrument,
      resonance:state.activeResonance,
      weather:state.weather,
      track:homeOpen?state.home.jukeboxTrack:''
    });
    if (inventoryOpen) renderInventory();
  }

  var NAMED_NPC_ATLAS = {mara:0,pip:1,zephra:2,nix:3,tavi:4,luma:5};
  function npcSchedule(npc) {
    var hour=Math.floor((state.playSeconds/60*3+8)%24);
    var seed=npc.id.split('').reduce(function(total,letter){return total+letter.charCodeAt(0);},0);
    if(hour>=6&&hour<12)return{activity:'working',dx:Math.sin(seed)*24,dy:18};
    if(hour>=12&&hour<18)return{activity:'travelling',dx:Math.sin(nowTime*.18+seed)*44,dy:Math.cos(nowTime*.14+seed)*30};
    if(hour>=18&&hour<23)return{activity:'playing music',dx:Math.cos(seed)*28,dy:-24};
    return{activity:'resting',dx:Math.sin(seed)*16,dy:38};
  }
  function npcWorldPosition(npc) {
    if(npc.id==='brad'||npc.id==='eems'||npc.id==='jimbo'||npc.id==='blu')return{x:npc.x,y:npc.y,activity:'keeping their usual post'};
    var schedule=npcSchedule(npc);
    return{x:clamp(npc.x+schedule.dx,35,WORLD.w-35),y:clamp(npc.y+schedule.dy,35,WORLD.h-35),activity:schedule.activity};
  }
  function npcById(id) { return npcs.find(function (n) { return n.id === id; }); }
  function aliveGroup(group) {
    return enemies.filter(function (e) { return e.group === group && !e.dead; });
  }
  function countCollected(items, collectedIds) {
    return items.filter(function (item) { return collectedIds.indexOf(item.id) >= 0; }).length;
  }
  function awardStageRelic(id, title) {
    var alreadyEarned = state.chapterRelics.indexOf(id) >= 0;
    if (!alreadyEarned) {
      state.chapterRelics.push(id);
      state.skillPoints++;
      state.beatcoins += 5;
      state.statistics.beatcoinsEarned += 5;
      audioCall('sfx', 'unlock');
      showToast(title, '+1 skill point · +5 Beatcoins', '#f6e36d', 4);
    }
  }
  function showCampaignFinale() {
    if (!bossDefeatedForStage(4)) return;
    campaignFinaleShown = true;
    state.campaignFinaleSeen = true;
    saveGame(true);
    paused = true;
    if (byId('endingTitle')) byId('endingTitle').textContent = 'THE FOUR-STAGE ENCORE';
    if (byId('endingText')) byId('endingText').textContent = 'The Nullspeaker is quiet, the Rootbound drum is free, the Prism Choir rings clear, and the Tidebreaker lowers its moon-shell. Rootsong carries the bass, Skyglass holds the harmony, and Moonwake sends your melody across the water while Blu, Jimbo, EEMS, Brad, Odin, and every traveller join the final beat.';
    if (byId('replayButton')) byId('replayButton').textContent = 'Keep Exploring';
    setHidden(byId('endingScreen'), false);
    setOverlayIsolation('ending', 'endingScreen', true);
    audioCall('pause', false);
    focusSoon('replayButton');
  }

  function talkToNpc(npc) {
    gainRelationship(npc.id,npc.ambient ? 1 : 2);
    if (npc.id === 'brad') {
      var bradLines=['Brad. Dealer in premium field goods, rare vinyl, and absolutely legitimate moss accessories.',
        'Preferred customer contract: '+Math.min(5,state.statistics.shopPurchases||0)+'/5 purchases. Beatcoins spend anywhere my rug is open.'];
      if(state.weather!=='clear')bradLines.push('Weather surcharge waived during '+state.weather.replace('-',' ')+'. I am generous and this rug is waterproof.');
      if(state.completedQuests.indexOf('brad-contract')>=0)bradLines.push('Preferred customer! The cashback was real. I am as surprised as you are.');
      openDialogue('BRAD',bradLines,openShop);
      return;
    }
    var expansionDialogue = {
      mara: ['Odin found you before I did. That means the old roads are waking.', 'Take him with you. His nose can find songs buried deeper than stone.'],
      pip: ['The Rootsong Hollows keep a bass line under the marsh.', 'Wake the three drums. Their rhythm will draw the Rootbound Colossus out of the old arena.'],
      zephra: ['Skyglass only holds a bridge while its chimes agree.', 'Retune them and the Prism Choir will descend. Break its orbiting shards before it breaks the road.'],
      nix: ['Courier rule one: never trust a silent mailbox.', 'Bring me a Rootsong, a Skyglass tone, and a Moonwake shell.'],
      tavi: ['Moonwake paths move with the tide, but rhythm remembers where they were.', 'Find the three singing shells. Their tide-song will open the Tidebreaker shoal.'],
      luma: ['Melody is a path. Rhythm is a footprint. Harmony is everyone arriving together.', 'Your final song will need all three.']
    };
    if (expansionDialogue[npc.id]) {
      var scheduled=npcWorldPosition(npc);
      var reactiveLines=expansionDialogue[npc.id].slice();
      reactiveLines.push('Right now I am ' + scheduled.activity + '. The road changes its rhythm with the hour.');
      if(state.weather!=='clear')reactiveLines.push('This ' + state.weather.replace('-',' ') + ' is changing the local Resonance. Travel with your ears open.');
      if(state.home.unlocked&&state.home.activeDecoration!=='woven-rug')reactiveLines.push('I saw the ' + (HOME_DECORATIONS[state.home.activeDecoration]||state.home.activeDecoration) + ' at your house. It changes the whole room’s harmony.');
      var relatedQuest=EXPANSION_QUESTS.find(function(quest){return quest.category==='side'&&quest.id.indexOf(npc.id)===0;});
      if(relatedQuest){
        if(state.completedQuests.indexOf(relatedQuest.id)>=0)reactiveLines.push('You finished ' + relatedQuest.name + '. The house and the road both sound better for it.');
        else if(relatedQuest.unlock())reactiveLines.push(relatedQuest.objective + ' Reward: ' + relatedQuest.reward + '.');
      }
      openDialogue(npc.name, reactiveLines, function () {
        var flag = 'met' + npc.id.charAt(0).toUpperCase() + npc.id.slice(1);
        state[flag] = true;
        if (npc.id === 'mara' && !state.odinRecruited) {
          state.odinRecruited = true;
          state.home.unlocked = true;
          if(state.discoveredLocations.indexOf('player-home')<0)state.discoveredLocations.push('player-home');
          odin.x = player.x - 38; odin.y = player.y + 30;
          resetOdinVisuals();
          showToast('ODIN JOINS THE BAND', 'The Afterglow House and Odin’s home area are now open.', '#62c7ff', 4);
        }
        if(npc.id==='pip')unlockInstrument('drums','Pip teaches you to turn the Rootsong into shockwaves.');
        if(npc.id==='zephra')unlockInstrument('synth','Zephra assembles a portable Skyglass synth.');
        if(npc.id==='tavi')unlockInstrument('violin','Tavi lends you a precision tidewood violin.');
        if(npc.id==='luma')unlockInstrument('microphone','Luma shares a supportive moon-silver microphone.');
        if (npc.id === 'pip' && state.stage === 2 && countCollected(drums,state.drums) === drums.length) awardStageRelic('rootsong','ROOTSONG RESTORED');
        if (npc.id === 'zephra' && state.stage === 3 && countCollected(speakers,state.speakers) === speakers.length) awardStageRelic('skyglass','SKYGLASS IN TUNE');
        if (npc.id === 'tavi' && state.stage === 4 && countCollected(stageTokens,state.stageTokens) === stageTokens.length) awardStageRelic('moonwake','MOONWAKE SINGS');
        state.chapter = Math.max(state.chapter, Math.min(4, 1 + state.chapterRelics.length));
        applyInstrumentUnlocks();
        syncExpansionQuests(99);
        updateHUD(true);
      });
      return;
    }
    if (npc.ambient) {
      var ambientPosition = npcWorldPosition(npc);
      var ambientLines = [
        'I am ' + npc.name + '. You caught me ' + (npc.occupation || ambientPosition.activity) + '.',
        currentLevel.name + ' changes its part whenever the weather and Resonance shift.'
      ];
      if (state.weather !== 'clear') {
        ambientLines.push('The ' + state.weather.replace('-', ' ') + ' is adding a strange harmony today.');
      }
      if (state.stageBosses.length) {
        ambientLines.push('Word of your last victory reached us before you did. The road carries good news quickly.');
      }
      openDialogue(npc.name, ambientLines);
      return;
    }
    if (npc.id === 'eems') {
      if (!state.metEems) {
        openDialogue('EEMS', [
          '[SIGNAL FOUND. GROOVE MISSING.]',
          'Four notes were scattered when the Nullspeaker swallowed Mossvale’s song.',
          'Gather Glowweed. Find C, E, G, and B. Then bring the pieces back to my pads.'
        ], function () {
          state.metEems = true;
          audioCall('sfx', 'quest');
          showToast('QUEST STARTED', 'Four Notes, One Groove', '#d77cff', 3.2);
          updateHUD();
        });
      } else if (hasAllNotes()) {
        openDialogue('EEMS', [
          state.composed ? '[COMPOSITION STABLE. ABSOLUTELY WIGGLY.]' : '[ALL FREQUENCIES FOUND.]',
          state.composed ? 'Your gate-tone is saved. The amphitheatre can hear you coming.' : 'Eight beats. Use every recovered note. Leave rests where the groove needs air.'
        ], function () { openComposer(); });
      } else {
        openDialogue('EEMS', [
          '[SEARCH MODE.] Notes recovered: ' + state.notes.length + '/4.',
          getShrineHint()
        ]);
      }
      return;
    }
    if (npc.id === 'jimbo') {
      if (!state.metJimbo) state.metJimbo = true;
      if (state.weeds.length >= 6 && !state.pruner) {
        openDialogue('JIMBO', [
          'Would you look at that satchel! Glowweed hums when it finds good company.',
          'I tuned your rhythm staff with a pruning edge. Pull what chokes the grove; leave what feeds it.',
          'Fourteen sprigs will strengthen your heart. Twenty-four will wake a proper charged cleave.'
        ], function () {
          state.pruner = true;
          audioCall('sfx', 'unlock');
          showToast('PRUNER EDGE', 'Your rhythm staff now cuts with extra bite.', '#ffc857', 3.5);
          updateHUD();
        });
      } else if (state.weeds.length < 6) {
        openDialogue('JIMBO', [
          'Soil says hello. Soil also says you need ' + (6 - state.weeds.length) + ' more Glowweed.',
          'The bright ones lean toward music. Walk close and they’ll hop right into your satchel.'
        ]);
      } else if (state.weeds.length === 30) {
        openDialogue('JIMBO', [
          'Every last sprig, and not a root bruised. That is championship gardening.',
          'When the band starts, watch the grove answer back. You earned the gold bloom.'
        ]);
      } else {
        openDialogue('JIMBO', [
          'Current harvest: ' + state.weeds.length + '/30. Fine work.',
          state.charged ? 'Hold your swing and let the rhythm build. Then—WHUM.' : 'Keep gathering. The grove has another trick in it.'
        ]);
      }
      return;
    }
    if (npc.id === 'blu') {
      if (aliveGroup('blu').length) {
        openDialogue('BLU', [
          'I am trying to enjoy this rest, but the local percussion keeps biting me.',
          'Clear the two feedback pests nearby. A good path has rests in it.'
        ]);
      } else if (!state.pulse) {
        openDialogue('BLU', [
          'That silence? Perfect. You left room for the next sound.',
          'Take this Resonance Pulse. It wakes old drums, retunes broken speakers, and rattles spectral shields.',
          'Press Q. Listen with your eyes too—the valley always shows what it sings.'
        ], function () {
          state.metBlu = true;
          state.pulse = true;
          audioCall('sfx', 'unlock');
          showToast('RESONANCE PULSE', 'Press Q near drums, speakers, and wisps.', '#62c7ff', 4);
          updateHUD();
        });
      } else {
        openDialogue('BLU', [
          !hasAllNotes() ? getShrineHint() : 'Every note is home. Now make something only you would make.',
          'A good path has rests in it.'
        ]);
      }
    }
  }

  function getShrineHint() {
    if (state.notes.indexOf('C') < 0) return 'C is ringing in the moon garden, straight north.';
    if (state.notes.indexOf('E') < 0) return 'E waits west. The Bramble Bell wants its guardians quiet.';
    if (state.notes.indexOf('G') < 0) return 'G sleeps in the southern marsh. Pulse all three drum-stones.';
    if (state.notes.indexOf('B') < 0) return 'B hides in the eastern static. Retune three broken speakers.';
    return 'All four frequencies are humming.';
  }

  function canCollectShrine(shrine) {
    if (shrine.note === 'C') return { ok: true };
    if (shrine.note === 'E') {
      var left = aliveGroup('bramble').length;
      return left ? { ok: false, why: 'The Bramble Bell is guarded · ' + left + ' remain' } : { ok: true };
    }
    if (shrine.note === 'G') {
      return countCollected(drums,state.drums) === drums.length ? { ok: true } :
        { ok: false, why: 'Pulse the marsh drums · ' + countCollected(drums,state.drums) + '/3' };
    }
    return countCollected(speakers,state.speakers) === speakers.length ? { ok: true } :
      { ok: false, why: 'Retune the static speakers · ' + countCollected(speakers,state.speakers) + '/3' };
  }

  function collectNote(shrine) {
    if (state.notes.indexOf(shrine.note) >= 0) {
      showToast(shrine.title.toUpperCase(), 'Note ' + shrine.note + ' already recovered.', NOTE_COLORS[shrine.note], 2);
      audioCall('previewNote', shrine.note);
      return;
    }
    var check = canCollectShrine(shrine);
    if (!check.ok) {
      audioCall('sfx', 'error');
      showToast('SHRINE LOCKED', check.why, '#ff7892', 2.8);
      return;
    }
    state.notes.push(shrine.note);
    state.notes.sort(function (a, b) { return NOTE_ORDER.indexOf(a) - NOTE_ORDER.indexOf(b); });
    for (var i = 0; i < 28; i++) spawnParticle(shrine.x, shrine.y - 15, NOTE_COLORS[shrine.note], 100, 4);
    audioCall('sfx', 'note');
    audioCall('previewNote', shrine.note);
    shake = 6;
    showToast('NOTE ' + shrine.note + ' RECOVERED', shrine.title + ' joins the song · ' + state.notes.length + '/4', NOTE_COLORS[shrine.note], 4);
    updateHUD();
    saveGame(true);
    if (hasAllNotes()) {
      setTimeout(function () {
        showToast('THE SET IS COMPLETE', 'Return to EEMS and compose your eight-beat gate-tone.', '#d77cff', 4.2);
      }, 1300);
    }
  }

  function collectWeed(weed) {
    if (state.weeds.indexOf(weed.id) >= 0) return;
    state.weeds.push(weed.id);
    audioCall('sfx', 'pickup');
    for (var i = 0; i < 8; i++) spawnParticle(weed.x, weed.y, '#7df7a1', 55, 3);
    showFloat(weed.x, weed.y - 15, '+ GLOWWEED', '#a4ff8b');
    var count = state.weeds.length;
    if (count === 6 && !state.pruner) {
      showToast('SATCHEL HUMMING', 'Jimbo can tune your rhythm staff now.', '#ffc857', 3.4);
    }
    if (count === 14 && !state.extraHeart) {
      state.extraHeart = true;
      player.maxHealth = 6;
      player.health = player.maxHealth;
      audioCall('sfx', 'unlock');
      showToast('GROVE HEART', 'Maximum health increased.', '#ff7892', 3.2);
    }
    if (count === 24 && !state.charged) {
      state.charged = true;
      audioCall('sfx', 'unlock');
      showToast('CHARGED CLEAVE', 'Hold attack to unleash a circular strike.', '#ffc857', 3.6);
    }
    if (count === 30 && !state.perfectHarvest) {
      state.perfectHarvest = true;
      audioCall('sfx', 'quest');
      showToast('PERFECT HARVEST', 'The golden bloom will join your finale.', '#f6e36d', 4);
    }
    updateHUD();
    saveGame(false);
  }

  function collectStageToken(token) {
    if (state.stageTokens.indexOf(token.id) >= 0) return;
    state.stageTokens.push(token.id);
    audioCall('sfx', 'note');
    for (var i = 0; i < 18; i++) spawnParticle(token.x, token.y, '#86e8ff', 80, 4);
    showFloat(token.x, token.y - 18, '+ ' + token.label.toUpperCase(), '#bdefff');
    showToast('MOONWAKE SHELL FOUND', countCollected(stageTokens,state.stageTokens) + '/3 shells are singing.', '#61d8c8', 3);
    updateHUD(true);
    saveGame(true);
  }


  function collectWorldCollectible(item) {
    if (state.collectibles.indexOf(item.id) >= 0) return;
    state.collectibles.push(item.id);
    var set = COLLECTIBLE_SETS[item.set];
    var count = collectedSetCount(item.set);
    var total = collectibleSetCount(item.set);
    var rewardCoins = 3 + (state.skills.indexOf('relic-hunter') >= 0 ? 2 : 0) + (state.purchases.indexOf('fortune-charm') >= 0 ? 2 : 0);
    state.beatcoins += rewardCoins;
    state.statistics.beatcoinsEarned += rewardCoins;
    gainProfessionXp('exploration',10,'Recovering ' + item.label);
    if (item.set === 'rootsong') addCraftingMaterial('heartwood',1);
    else if (item.set === 'skyglass') addCraftingMaterial('prismDust',1);
    else if (item.set === 'moonwake') addCraftingMaterial('tidePearl',1);
    else addCraftingMaterial('sporeSilk',1);
    audioCall('sfx','note');
    for (var i=0;i<16;i++) spawnParticle(item.x,item.y,set.color,85,4);
    showFloat(item.x,item.y-20,'+ '+item.label.toUpperCase(),set.color);
    showToast(set.name.toUpperCase(),count+'/'+total+' found · +'+rewardCoins+' Beatcoins',set.color,3);
    if (count === total && state.collectibleRewards.indexOf(item.set) < 0) {
      state.collectibleRewards.push(item.set);
      state.skillPoints += 1;
      player.health = Math.min(player.maxHealth, player.health + 1);
      showToast(set.reward.toUpperCase(),'Set complete · +1 skill point and a healing spark!',set.color,4);
    }
    updateHUD(true); saveGame(true);
  }

  function spawnParticle(x, y, color, speed, size) {
    if (settings.reducedMotion && particles.length > 35) return;
    if (particles.length >= 480) return;
    var angle = Math.random() * Math.PI * 2;
    var force = (0.25 + Math.random() * 0.75) * speed;
    var particle = particlePool.pop() || {};
    particle.x = x;
    particle.y = y;
    particle.vx = Math.cos(angle) * force;
    particle.vy = Math.sin(angle) * force;
    particle.life = 0.45 + Math.random() * 0.55;
    particle.maxLife = 1;
    particle.color = color;
    particle.size = size * (0.5 + Math.random());
    particle.text = '';
    particles.push(particle);
  }
  function showFloat(x, y, text, color) {
    if (particles.length >= 480 || floatingTextCount >= MAX_FLOATING_TEXT) return;
    var particle = particlePool.pop() || {};
    particle.x = x; particle.y = y; particle.vx = 0; particle.vy = -22;
    particle.life = 1.1; particle.maxLife = 1.1; particle.color = color;
    particle.size = 11; particle.text = text;
    floatingTextCount++;
    particles.push(particle);
  }

  function circleHitsObstacle(x, y, r, entity) {
    if (x - r < 22 || y - r < 22 || x + r > WORLD.w - 22 || y + r > WORLD.h - 22) return true;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      var dx = x - o.x;
      var dy = y - o.y;
      if (dx * dx + dy * dy < (r + o.r) * (r + o.r)) return true;
    }
    for (var j = 0; j < waterPools.length; j++) {
      var p = waterPools[j];
      var nx = (x - p.x) / (p.rx + r);
      var ny = (y - p.y) / (p.ry + r);
      if (nx * nx + ny * ny < 1) return true;
    }
    if (entity === player) {
      for (var k = 0; k < npcs.length; k++) {
        var npcPosition = npcWorldPosition(npcs[k]);
        var npcDx = x - npcPosition.x;
        var npcDy = y - npcPosition.y;
        var combinedRadius = r + (npcs[k].collisionRadius || 14);
        if (npcDx * npcDx + npcDy * npcDy < combinedRadius * combinedRadius) return true;
      }
    }
    return false;
  }

  function moveWithCollision(entity, dx, dy) {
    var nextX = entity.x + dx;
    if (!circleHitsObstacle(nextX, entity.y, entity.r, entity)) entity.x = nextX;
    var nextY = entity.y + dy;
    if (!circleHitsObstacle(entity.x, nextY, entity.r, entity)) entity.y = nextY;
  }

  function firstStageSpawnPoint() {
    return LEVELS[1] && LEVELS[1].spawn ? LEVELS[1].spawn : {x:1400,y:1045};
  }

  function distanceSquared(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function firstStageZoneAt(position) {
    if (state.stage !== 1) return 'final';
    var d2 = distanceSquared(position, firstStageSpawnPoint());
    if (d2 <= FIRST_STAGE_BALANCE.safeZoneRadius * FIRST_STAGE_BALANCE.safeZoneRadius) return 'safe';
    if (d2 <= FIRST_STAGE_BALANCE.introductoryZoneRadius * FIRST_STAGE_BALANCE.introductoryZoneRadius) return 'intro';
    if (d2 <= FIRST_STAGE_BALANCE.standardZoneRadius * FIRST_STAGE_BALANCE.standardZoneRadius) return 'standard';
    return 'final';
  }

  function isFirstStageProtected(position, extraRadius) {
    if (state.stage !== 1) return false;
    var radius = FIRST_STAGE_BALANCE.safeZoneRadius + (extraRadius || 0);
    return distanceSquared(position, firstStageSpawnPoint()) <= radius * radius;
  }

  function nearStageObject(position, radius) {
    var radiusSq;
    var index;
    for (index = 0; index < npcs.length; index++) {
      var npcPosition = npcWorldPosition(npcs[index]);
      radiusSq = radius + (npcs[index].collisionRadius || 14);
      if (distanceSquared(position, npcPosition) < radiusSq * radiusSq) return true;
    }
    var protectedCollections = [shrines, stagePortals, stageTokens, collectibles];
    for (var collectionIndex = 0; collectionIndex < protectedCollections.length; collectionIndex++) {
      var collection = protectedCollections[collectionIndex] || [];
      for (index = 0; index < collection.length; index++) {
        radiusSq = radius + (collection[index].r || 18);
        if (distanceSquared(position, collection[index]) < radiusSq * radiusSq) return true;
      }
    }
    return false;
  }

  // Authoritative validation used by fixed, procedural, quest, split, and event
  // spawns. A structured reason makes failed placement debuggable without
  // forcing an invalid enemy into the map.
  function canSpawnEnemy(options) {
    options = options || {};
    var position = options.position;
    var enemyRadius = options.radius || 18;
    if (!position || !isFinite(position.x) || !isFinite(position.y)) return {valid:false,reason:'invalid_position'};
    if (circleHitsObstacle(position.x, position.y, enemyRadius)) return {valid:false,reason:'collision_geometry'};
    if (state.stage === 1 && isFirstStageProtected(position, enemyRadius + 18)) {
      return {valid:false,reason:'inside_safe_zone'};
    }
    if (nearStageObject(position, enemyRadius + 36)) return {valid:false,reason:'blocks_interactable'};
    var playerPosition = options.playerPosition || (started ? player : null);
    if (playerPosition && options.enforcePlayerDistance !== false) {
      var minimumDistance = options.minimumPlayerDistance || FIRST_STAGE_BALANCE.minimumEnemyDistance;
      if (distanceSquared(position, playerPosition) < minimumDistance * minimumDistance) {
        return {valid:false,reason:'too_close_to_player'};
      }
    }
    for (var enemyIndex = 0; enemyIndex < enemies.length; enemyIndex++) {
      var other = enemies[enemyIndex];
      if (!other || other.dead || other === options.ignoreEnemy) continue;
      var separation = enemyRadius + (other.r || 16) + 18;
      if (distanceSquared(position, other) < separation * separation) return {valid:false,reason:'overlaps_enemy'};
    }
    return {valid:true,reason:'ok'};
  }

  function findValidEnemySpawn(origin, options) {
    options = options || {};
    var attempts = options.attempts || FIRST_STAGE_BALANCE.spawnValidationRetries;
    var baseRadius = options.baseRadius || 70;
    for (var attempt = 0; attempt < attempts; attempt++) {
      var angle = (options.angle || 0) + attempt * 2.399963 + Math.random() * 0.18;
      var radius = baseRadius + attempt * (options.radiusStep || 34);
      var position = {
        x:clamp(origin.x + Math.cos(angle) * radius, 40, WORLD.w - 40),
        y:clamp(origin.y + Math.sin(angle) * radius, 40, WORLD.h - 40)
      };
      var validation = canSpawnEnemy({
        position:position,
        radius:options.radius,
        playerPosition:options.playerPosition,
        enforcePlayerDistance:options.enforcePlayerDistance,
        minimumPlayerDistance:options.minimumPlayerDistance,
        ignoreEnemy:options.ignoreEnemy
      });
      if (validation.valid) return {position:position,validation:validation};
    }
    return {position:null,validation:{valid:false,reason:'no_valid_position'}};
  }

  function firstStageProgressMilestone() {
    return !!(state.metBlu || state.notes.length >= 1 || state.totalKills >= 4);
  }

  function prepareEnemyForSpawn(enemy, options) {
    options = options || {};
    enemy.spawnWarmup = options.fixed ? 0 : (state.stage === 1 ?
      FIRST_STAGE_BALANCE.enemySpawnWarmupSeconds : 0.85);
    enemy.introduced = !options.fixed;
    enemy.contactCooldown = 0;
    enemy.attackSlotUntil = 0;
    enemy.disengageTimer = 0;
    enemy.encounterZone = firstStageZoneAt(enemy);
    if (state.stage !== 1) return enemy;
    if (enemy.encounterZone === 'safe') {
      var spawn = firstStageSpawnPoint();
      var dx = enemy.x - spawn.x;
      var dy = enemy.y - spawn.y;
      var direction = normalize(dx || 1, dy || 0);
      var relocationOrigin = {
        x:spawn.x + direction.x * (FIRST_STAGE_BALANCE.safeZoneRadius + 72),
        y:spawn.y + direction.y * (FIRST_STAGE_BALANCE.safeZoneRadius + 72)
      };
      var relocated = findValidEnemySpawn(relocationOrigin, {
        radius:enemy.r,
        baseRadius:0,
        radiusStep:28,
        enforcePlayerDistance:false
      });
      if (relocated.position) {
        enemy.x = enemy.homeX = relocated.position.x;
        enemy.y = enemy.homeY = relocated.position.y;
        enemy.encounterZone = firstStageZoneAt(enemy);
      } else {
        enemy.dead = true;
        enemy.spawnRejected = 'inside_safe_zone';
      }
    }
    if (!enemy.dead) {
      var fixedValidation = canSpawnEnemy({
        position:enemy,
        radius:enemy.r,
        playerPosition:options.playerPosition,
        enforcePlayerDistance:false,
        ignoreEnemy:enemy
      });
      if (!fixedValidation.valid) {
        var corrected = findValidEnemySpawn({x:enemy.x,y:enemy.y},{
          radius:enemy.r,
          baseRadius:52,
          radiusStep:30,
          enforcePlayerDistance:false,
          ignoreEnemy:enemy
        });
        if (corrected.position) {
          enemy.x = enemy.homeX = corrected.position.x;
          enemy.y = enemy.homeY = corrected.position.y;
          enemy.encounterZone = firstStageZoneAt(enemy);
        } else {
          enemy.dead = true;
          enemy.spawnRejected = fixedValidation.reason;
        }
      }
    }
    if (!enemy.isMiniBoss && enemy.encounterZone === 'intro') {
      var adjustedHp = Math.max(1, Math.floor(enemy.maxHp * FIRST_STAGE_BALANCE.enemyHealthMultiplier));
      enemy.hp = enemy.maxHp = adjustedHp;
      enemy.elite = false;
      enemy.eliteId = null;
    }
    if ((enemy.isMiniBoss || enemy.elite) && !firstStageProgressMilestone()) enemy.progressionLocked = true;
    return enemy;
  }

  function resetFirstStageRuntime(reason) {
    firstStageRuntime.attackSlots.clear();
    firstStageRuntime.respawnGrace = reason === 'respawn' && state.stage === 1 ? 6 : 0;
    firstStageRuntime.healingDropCooldown = 0;
    firstStageRuntime.tutorialPromptCooldown = 2.5;
    firstStageRuntime.lowHealthLatch = false;
    firstStageRuntime.movementStartX = player.x;
    firstStageRuntime.movementStartY = player.y;
    firstStageRuntime.safe = state.stage === 1 && isFirstStageProtected(player);
    firstStageRuntime.zone = firstStageZoneAt(player);
    firstStageRuntime.graceRemaining = state.stage === 1 && !state.firstStageOnboarding.graceConsumed ?
      clamp(state.firstStageOnboarding.graceRemaining, 0, FIRST_STAGE_BALANCE.openingGracePeriodSeconds) : 0;
    if (state.stage === 1) encounterDirector.cooldown = Math.max(
      encounterDirector.cooldown, FIRST_STAGE_BALANCE.encounterCooldownSeconds
    );
    inputBuffer.attack = inputBuffer.dodge = inputBuffer.block = inputBuffer.interact = 0;
  }

  function recordFirstStageTutorial(flag) {
    if (state.stage !== 1 || !state.firstStageOnboarding || state.firstStageOnboarding.tutorialFlags.indexOf(flag) >= 0) return;
    state.firstStageOnboarding.tutorialFlags.push(flag);
  }

  function adaptiveFirstStageStrength() {
    if (state.stage !== 1 || settings.adaptiveFirstStage === false) return 0;
    var fullAssistThreshold = FIRST_STAGE_BALANCE.adaptiveDeathThreshold * 2 +
      FIRST_STAGE_BALANCE.adaptiveLowHealthThreshold * 0.67;
    return clamp((state.firstStageOnboarding.struggle || 0) / fullAssistThreshold, 0, 1);
  }

  function firstStageHostilesSuspended() {
    return state.stage === 1 && (firstStageRuntime.safe || firstStageRuntime.graceRemaining > 0 ||
      firstStageRuntime.respawnGrace > 0);
  }

  function releaseEnemyAttackSlot(enemy) {
    if (!enemy) return;
    firstStageRuntime.attackSlots.delete(enemy.id);
    enemy.attackSlotUntil = 0;
  }

  function firstStageAttackerLimit() {
    return firstStageRuntime.zone === 'intro' ? FIRST_STAGE_BALANCE.maximumIntroAttackers :
      FIRST_STAGE_BALANCE.maximumLaterAttackers;
  }

  function claimEnemyAttackSlot(enemy) {
    if (state.stage !== 1 || enemy.isMiniBoss || boss) return true;
    if (firstStageHostilesSuspended() || enemy.progressionLocked || enemy.spawnWarmup > 0) return false;
    if (firstStageRuntime.attackSlots.has(enemy.id)) {
      enemy.attackSlotUntil = 1.6;
      return true;
    }
    if (firstStageRuntime.attackSlots.size >= firstStageAttackerLimit()) return false;
    firstStageRuntime.attackSlots.add(enemy.id);
    enemy.attackSlotUntil = 1.6;
    return true;
  }

  function returnEnemyHome(enemy, dt) {
    releaseEnemyAttackSlot(enemy);
    enemy.mode = 'idle';
    enemy.vx = enemy.vy = 0;
    var dx = enemy.homeX - enemy.x;
    var dy = enemy.homeY - enemy.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 3) {
      var speed = Math.min(110, 34 + d * 0.7);
      moveWithCollision(enemy, dx / d * speed * dt, dy / d * speed * dt);
      setAnimationState(enemy, 'walk');
    } else {
      setAnimationState(enemy, 'idle');
    }
  }

  function tutorialControlLabel(action) {
    if (touchCapable) {
      return action === 'move' ? 'drag the left movement area' :
        action === 'interact' ? 'tap TALK' :
        action === 'attack' ? 'tap STRIKE' :
        action === 'dodge' ? 'tap DODGE' :
        action === 'block' ? 'hold BLOCK' :
        action === 'heal' ? 'tap HEAL' : 'tap ODIN';
    }
    return action === 'move' ? 'use WASD or the arrow keys' :
      action === 'interact' ? 'press E' :
      action === 'attack' ? 'press Space or J' :
      action === 'dodge' ? 'press Shift or K' :
      action === 'block' ? 'hold F' :
      action === 'heal' ? 'press H' : 'press R';
  }

  function updateFirstStageBalance(dt) {
    if (state.stage !== 1) {
      firstStageRuntime.safe = false;
      firstStageRuntime.zone = 'final';
      firstStageRuntime.attackSlots.clear();
      return;
    }
    firstStageRuntime.safe = isFirstStageProtected(player);
    firstStageRuntime.zone = firstStageZoneAt(player);
    firstStageRuntime.respawnGrace = Math.max(0, firstStageRuntime.respawnGrace - dt);
    firstStageRuntime.healingDropCooldown = Math.max(0, firstStageRuntime.healingDropCooldown - dt);
    if (firstStageRuntime.graceRemaining > 0) {
      firstStageRuntime.graceRemaining = Math.max(0, firstStageRuntime.graceRemaining - dt);
      state.firstStageOnboarding.graceRemaining = firstStageRuntime.graceRemaining;
      if (!firstStageRuntime.safe || firstStageRuntime.graceRemaining <= 0) {
        firstStageRuntime.graceRemaining = 0;
        state.firstStageOnboarding.graceRemaining = 0;
        state.firstStageOnboarding.graceConsumed = true;
        if (!firstStageRuntime.safe) showToast('FIRST COMBAT AREA', 'One attacker at a time while you find the beat.', '#7df7a1', 2.7);
      }
    }
    var tutorialMoveX = player.x - firstStageRuntime.movementStartX;
    var tutorialMoveY = player.y - firstStageRuntime.movementStartY;
    if (tutorialMoveX * tutorialMoveX + tutorialMoveY * tutorialMoveY > 2500) {
      recordFirstStageTutorial('move');
    }
    if (player.health <= Math.max(1, Math.floor(player.maxHealth * 0.35))) {
      if (!firstStageRuntime.lowHealthLatch) {
        firstStageRuntime.lowHealthLatch = true;
        state.firstStageOnboarding.struggle = clamp(state.firstStageOnboarding.struggle + 0.45, 0, 10);
      }
    } else if (player.health >= Math.ceil(player.maxHealth * 0.7)) {
      firstStageRuntime.lowHealthLatch = false;
    }
    firstStageRuntime.attackSlots.forEach(function (id) {
      var enemy = null;
      for (var i = 0; i < enemies.length; i++) if (enemies[i].id === id) { enemy = enemies[i]; break; }
      if (!enemy || enemy.dead || enemy.stun > 0 || enemy.attackSlotUntil <= 0 ||
          distanceSquared(enemy, player) > 230400 || firstStageHostilesSuspended()) {
        firstStageRuntime.attackSlots.delete(id);
        if (enemy) enemy.attackSlotUntil = 0;
      } else {
        enemy.attackSlotUntil -= dt;
      }
    });
    firstStageRuntime.tutorialPromptCooldown -= dt;
    if (firstStageRuntime.safe && firstStageRuntime.tutorialPromptCooldown <= 0 && toastTimer <= 0.2) {
      var sequence = ['move','interact','attack','dodge','block','heal'];
      if (state.odinRecruited) sequence.push('odin');
      var next = null;
      for (var sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex++) {
        if (state.firstStageOnboarding.tutorialFlags.indexOf(sequence[sequenceIndex]) < 0) {
          next = sequence[sequenceIndex];
          break;
        }
      }
      if (next) {
        var titles = {move:'MOVEMENT',interact:'INTERACTION',attack:'BASIC ATTACK',dodge:'DODGE',block:'BLOCK',heal:'HEALING',odin:'ODIN COMMAND'};
        showToast(titles[next], tutorialControlLabel(next) + '.', '#7df7a1', 2.8);
      }
      firstStageRuntime.tutorialPromptCooldown = 7;
    }
    var debugSignature = [firstStageRuntime.zone,Math.ceil(firstStageRuntime.graceRemaining),
      Math.ceil(firstStageRuntime.respawnGrace),firstStageRuntime.attackSlots.size].join('|');
    if (debugSignature !== firstStageRuntime.debugSignature) {
      firstStageRuntime.debugSignature = debugSignature;
      var protectedHostiles = 0;
      var closestEnemyDistance = Infinity;
      for (var debugEnemyIndex = 0; debugEnemyIndex < enemies.length; debugEnemyIndex++) {
        var debugEnemy = enemies[debugEnemyIndex];
        if (debugEnemy.dead || debugEnemy.progressionLocked) continue;
        if (isFirstStageProtected(debugEnemy,debugEnemy.r || 0)) protectedHostiles++;
        closestEnemyDistance = Math.min(closestEnemyDistance,Math.sqrt(distanceSquared(debugEnemy,player)));
      }
      canvas.dataset.firstStageZone = firstStageRuntime.zone;
      canvas.dataset.firstStageGrace = String(Math.ceil(firstStageRuntime.graceRemaining));
      canvas.dataset.firstStageAttackers = String(firstStageRuntime.attackSlots.size);
      canvas.dataset.firstStageSafe = String(firstStageRuntime.safe);
      canvas.dataset.firstStageProtectedHostiles = String(protectedHostiles);
      canvas.dataset.closestEnemyDistance = isFinite(closestEnemyDistance) ? String(Math.round(closestEnemyDistance)) : 'none';
    }
  }

  function gateBossArena() {
    var dx = player.x - BOSS_CENTER.x;
    var dy = player.y - BOSS_CENTER.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (!bossDefeatedForStage(state.stage) && !bossPrerequisiteMet(state.stage) && d < 355) {
      var n = d > 0.001 ? normalize(dx, dy) : {x:-1,y:0};
      player.x = BOSS_CENTER.x + n.x * 357;
      player.y = BOSS_CENTER.y + n.y * 357;
      var barrierText = state.stage === 1 ? 'Compose all four notes with EEMS to open the gate.' :
        state.stage === 2 ? 'Wake the drums and bring their rhythm to Pip.' :
        state.stage === 3 ? 'Retune the chimes and bring their chord to Zephra.' :
        'Gather all three shells and bring their tide-song to Tavi.';
      if (toastTimer <= 0) showToast('BOSS ROAD SEALED', barrierText, bossDefForStage(state.stage).shieldColor, 2.7);
    }
    if (boss && !boss.dead && d > 310) {
      var inside = normalize(dx, dy);
      player.x = BOSS_CENTER.x + inside.x * 308;
      player.y = BOSS_CENTER.y + inside.y * 308;
    }
  }

  function hasClearAttackLine(target) {
    var steps = 7;
    for (var step = 1; step < steps; step++) {
      var t = step / steps;
      if (circleHitsObstacle(lerp(player.x,target.x,t),lerp(player.y,target.y,t),4)) return false;
    }
    return true;
  }

  function applyMobileAimAssist() {
    if (!touchCapable && !contactUsesAction('attack')) return;
    var best = null;
    var bestScore = Infinity;
    for (var enemyIndex = 0; enemyIndex < enemies.length; enemyIndex++) {
      var enemy = enemies[enemyIndex];
      if (enemy.dead || enemy.progressionLocked) continue;
      var dx = enemy.x - player.x;
      var dy = enemy.y - player.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 25600 || !hasClearAttackLine(enemy)) continue;
      var angle = Math.atan2(dy,dx);
      var delta = Math.abs(angleDelta(angle,player.facing));
      var score = d2 * (1 + delta * 0.8);
      if (delta < 0.9 && score < bestScore) { best = enemy; bestScore = score; }
    }
    if (best) player.facing = Math.atan2(best.y-player.y,best.x-player.x);
  }

  function performAttack(charged, fromBuffer) {
    if (player.blocking || player.guardBroken > 0 || equipmentVisualRuntime.switching) return;
    if (!started || paused || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || dialogue) return;
    if (player.attackCooldown > 0) {
      if (!charged && !fromBuffer) inputBuffer.attack = FIRST_STAGE_BALANCE.inputBufferSeconds;
      return;
    }
    applyMobileAimAssist();
    inputBuffer.attack = 0;
    recordFirstStageTutorial('attack');
    state.statistics.attacksSwung++;
    registerRhythmAttack();
    var instrument = equippedInstrument();
    var profile = instrumentProfile(instrument.id);
    var duration = charged ? Math.max(0.3,instrument.charge) : (instrument.id === 'bass' ? 0.25 : 0.18);
    var countering = player.counterWindow > 0;
    if (countering) {
      player.counterWindow = 0;
      state.statistics.counterAttacks = (state.statistics.counterAttacks || 0) + 1;
      showFloat(player.x, player.y - 34, 'COUNTER!', '#f6e36d');
    }
    var attackOrigin = equipmentWorldOrigin(instrument.id,charged ? 'charged' : 'attack',player.facing,0,'hitbox',0);
    attacks.push({
      x: attackOrigin.x, y: attackOrigin.y, angle: player.facing, charged: charged, counter: countering,
      life: duration, maxLife: duration, hit: new Set(), instrument: instrument.id, profile: profile, chainTriggered:false
    });
    player.attackCooldown = charged ? Math.max(0.44,profile.cooldown * 1.75) : profile.cooldown;
    if (state.skills.indexOf('rhythm-master') >= 0) player.attackCooldown *= 0.75;
    if (activeResonance('conductor')) player.attackCooldown *= 0.8;
    if (state.purchases.indexOf('tempo-ring') >= 0) player.attackCooldown *= 0.85;
    audioCall('sfx', charged || instrument.id === 'bass' || instrument.id === 'drums' ? 'pulse' : 'attack');
    if (charged) {
      shake = instrument.id === 'bass' ? 8 : 5;
      for (var i = 0; i < 18; i++) spawnParticle(player.x, player.y, instrument.color, 90, 3);
    }
  }

  function doDash(fromBuffer) {
    if (!started || paused || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || dialogue) return;
    if (player.dashCooldown > 0 || player.guardBroken > 0) {
      if (!fromBuffer) inputBuffer.dodge = FIRST_STAGE_BALANCE.inputBufferSeconds;
      return;
    }
    inputBuffer.dodge = 0;
    recordFirstStageTutorial('dodge');
    state.statistics.dashes++;
    if (state.statistics.dashes % 4 === 0) gainProfessionXp('dodging',1,'Field movement');
    var dx = player.moveX;
    var dy = player.moveY;
    if (!dx && !dy) {
      dx = Math.cos(player.facing);
      dy = Math.sin(player.facing);
    }
    var n = normalize(dx, dy);
    player.dashX = n.x;
    player.dashY = n.y;
    player.dashTimer = 0.19;
    player.dashCooldown = state.skills.indexOf('fleet-foot') >= 0 ? 0.56 : 0.72;
    if (activeResonance('conductor')) player.dashCooldown *= 0.8;
    player.invuln = Math.max(player.invuln, 0.27 + (touchCapable ? FIRST_STAGE_BALANCE.mobileDodgeForgivenessSeconds : 0));
    if (state.skills.indexOf('shield-harmony') >= 0) {
      player.invuln = Math.max(player.invuln, 0.55);
    }
    audioCall('sfx', 'dodge');
    if (state.skills.indexOf('echo-step') >= 0) {
      pulses.push({x:player.x,y:player.y,life:0.32,maxLife:0.32,r:0});
      enemies.forEach(function(e){if(!e.dead && distance(player,e)<72) hitEnemy(e,1,player.x,player.y);});
      if (boss && !boss.dead && distance(player,boss)<72+boss.r) hitBoss(1);
    }
    for (var i = 0; i < 7; i++) spawnParticle(player.x, player.y, '#7ce4d1', 50, 3);
  }

  function applyInstrumentSpecial() {
    var instrument = equippedInstrument();
    var profile = instrumentProfile(instrument.id);
    var nearby = enemies.filter(function (enemy) {
      return !enemy.dead && distance(player,enemy) < (instrument.id === 'synth' ? 225 : 170);
    }).sort(function (a,b) { return distance(player,a) - distance(player,b); });
    if (instrument.id === 'guitar') {
      nearby.slice(0,activeResonance('conductor') ? 4 : 2).forEach(function (enemy,index) {
        enemy.shielded = false;
        hitEnemy(enemy,1 + (index === 0 ? profile.pulseDamage : 0),player.x,player.y);
      });
    } else if (instrument.id === 'bass') {
      nearby.forEach(function (enemy) {
        enemy.armorBroken = Math.max(enemy.armorBroken || 0,activeResonance('heavy') ? 8 : 4);
        enemy.stun = Math.max(enemy.stun,activeResonance('heavy') ? 2.8 : 1.8);
        var push = normalize(enemy.x-player.x,enemy.y-player.y);
        enemy.x += push.x * profile.knockback;
        enemy.y += push.y * profile.knockback;
      });
    } else if (instrument.id === 'synth') {
      nearby.slice(0,activeResonance('psychedelic') ? 6 : 3).forEach(function (enemy,index) {
        enemy.shielded = false;
        hitEnemy(enemy,1 + profile.pulseDamage,player.x + Math.cos(index)*20,player.y + Math.sin(index)*20);
      });
    } else if (instrument.id === 'drums') {
      nearby.forEach(function (enemy) {
        enemy.stun = Math.max(enemy.stun,2.4);
        if (distance(player,enemy) < 110) hitEnemy(enemy,1,player.x,player.y);
      });
    } else if (instrument.id === 'microphone') {
      healPlayer(activeResonance('nature') ? 2 : 1);
      activeBuffs.odinHowlTimer = Math.max(activeBuffs.odinHowlTimer,5);
    } else if (instrument.id === 'violin') {
      nearby.slice(0,3).forEach(function (enemy) {
        enemy.bleedTimer = Math.max(enemy.bleedTimer || 0,activeResonance('nature') ? 7 : 4);
        enemy.bleedTick = 0.75;
      });
      if (activeResonance('nature')) healPlayer(1);
      odin.spiritTimer = Math.max(odin.spiritTimer,4);
    }
    showFloat(player.x,player.y-35,instrument.special.toUpperCase(),instrument.color);
  }

  function doPulse() {
    if (!started || paused || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || dialogue || player.pulseCooldown > 0 || equipmentVisualRuntime.switching) return;
    if (instrumentUltimateCharge >= 100) {
      state.statistics.pulses++;
      player.pulseCooldown = 1.2;
      performInstrumentUltimate();
      updateHUD(true);
      return;
    }
    if (!state.pulse) {
      audioCall('sfx', 'error');
      showToast('NO RESONANCE YET', 'Help Blu east of the grove.', '#62c7ff', 2.5);
      player.pulseCooldown = 0.5;
      return;
    }
    state.statistics.pulses++;
    player.pulseCooldown = state.purchases.indexOf('tempo-ring') >= 0 ? 0.98 : 1.15;
    if (activeResonance('conductor')) player.pulseCooldown *= 0.8;
    equipmentVisualRuntime.specialTimer = 0.58;
    var pulseOrigin = equipmentWorldOrigin(state.equippedInstrument,'special',player.facing,0.18,'effect',0.34);
    pulses.push({ x: pulseOrigin.x, y: pulseOrigin.y, life: 0.55, maxLife: 0.55, r: 0 });
    audioCall('sfx', 'pulse');
    applyInstrumentSpecial();
    enemies.forEach(function (e) {
      if (!e.dead && distance(player, e) < (state.skills.indexOf('wide-pulse') >= 0 ? 155 : 125)) {
        e.stun = Math.max(e.stun, e.type === 'wisp' ? 3.2 : 1.4);
        e.shielded = false;
        e.mode = 'idle';
      }
    });
    pulseBossChallenge();
    var puzzlePulseRadius = state.skills.indexOf('wide-pulse') >= 0 ? 135 : 105;
    drums.forEach(function (d) {
      if (state.drums.indexOf(d.id) < 0 && distance(player, d) < puzzlePulseRadius) {
        state.drums.push(d.id);
        audioCall('previewNote', d.note);
        var drumName = state.stage === 2 ? 'Rootsong drums are singing.' : 'marsh drums are singing.';
        showToast('DRUM AWAKENED', countCollected(drums,state.drums) + '/3 ' + drumName, NOTE_COLORS[d.note], 2.4);
        for (var i = 0; i < 14; i++) spawnParticle(d.x, d.y, NOTE_COLORS[d.note], 75, 3);
        saveGame(true);
      }
    });
    speakers.forEach(function (s, index) {
      if (state.speakers.indexOf(s.id) < 0 && distance(player, s) < puzzlePulseRadius) {
        state.speakers.push(s.id);
        audioCall('previewNote', NOTE_ORDER[index + 1] || 'B');
        var speakerName = state.stage === 3 ? 'Skyglass chimes are clear.' : 'static speakers online.';
        showToast(state.stage === 3 ? 'CHIME RETUNED' : 'SPEAKER RETUNED', countCollected(speakers,state.speakers) + '/3 ' + speakerName, '#d77cff', 2.4);
        for (var i = 0; i < 14; i++) spawnParticle(s.x, s.y, '#d77cff', 75, 3);
        saveGame(true);
      }
    });
    if (state.skills.indexOf('echo-chamber') >= 0 || activeBuffs.massivePulse) {
      var pulseDmgRadius = activeBuffs.massivePulse ? 290 : (state.skills.indexOf('wide-pulse') >= 0 ? 155 : 125);
      var pulseDamage = activeBuffs.massivePulse ? 4 : 1;
      enemies.forEach(function (e) {
        if (e.dead || distance(player, e) > pulseDmgRadius) return;
        hitEnemy(e, pulseDamage, player.x, player.y);
        if (state.skills.indexOf('resonance-cascade') >= 0) {
          enemies.forEach(function (e2) {
            if (e2 !== e && !e2.dead && distance(e, e2) < 90) {
              hitEnemy(e2, 1, e.x, e.y);
            }
          });
        }
      });
      if (boss && !boss.dead && distance(player, boss) < pulseDmgRadius + boss.r) {
        hitBoss(pulseDamage);
      }
      if (state.skills.indexOf('pulse-mender') >= 0) {
        state.damagingPulses++;
        if (state.damagingPulses % 5 === 0 && player.health < player.maxHealth) { healPlayer(1); showFloat(player.x,player.y-30,'PULSE MEND +1','#7df7a1'); }
      }
      if (activeBuffs.massivePulse) {
        activeBuffs.massivePulse = false;
        shake = 10;
        showFloat(player.x, player.y - 30, 'ECHO BLAST!', '#d77cff');
      }
    }
    updateHUD();
  }

  function nearestInteractable() {
    var best = null;
    function consider(type, item, range) {
      var d = distance(player, item);
      if (d <= range && (!best || d < best.d)) best = { type: type, item: item, d: d };
    }
    npcs.forEach(function (n) {
      var position=npcWorldPosition(n);
      consider('npc',{x:position.x,y:position.y,npc:n,activity:position.activity},62);
    });
    shrines.forEach(function (s) { consider('shrine', s, 70); });
    stagePortals.forEach(function (p) { consider('portal', p, 76); });
    if(encounterDirector.activeEvent)consider('world-event',encounterDirector.activeEvent,72);
    return best;
  }

  function interact(fromBuffer) {
    if (dialogue) { advanceDialogue(); return; }
    if (!started || paused || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen) return;
    var near = nearestInteractable();
    if (!near) {
      if (!fromBuffer) inputBuffer.interact = FIRST_STAGE_BALANCE.inputBufferSeconds;
      if (fromBuffer) return;
      showToast('LISTEN…', 'Nothing nearby wants to talk.', '#7ce4d1', 1.5);
      return;
    }
    inputBuffer.interact = 0;
    recordFirstStageTutorial('interact');
    if (near.type === 'npc') talkToNpc(near.item.npc||near.item);
    else if (near.type === 'portal') enterStage(near.item);
    else if (near.type === 'world-event') resolveWorldEvent(near.item);
    else collectNote(near.item);
  }

  function enterStage(portal) {
    if (!portalUnlocked(portal)) {
      audioCall('sfx', 'error');
      showToast('STAGE GATE LOCKED', portalLockReason(portal), '#8e9ba0', 3);
      return;
    }
    state.stagePositions[String(state.stage)] = {x:Math.round(player.x),y:Math.round(player.y)};
    state.stage = portal.target;
    state.chapter = Math.max(state.chapter,portal.target);
    activateLevel(state.stage);
    resetEnemies();
    var remembered = state.stagePositions[String(state.stage)];
    var spawn = remembered || currentLevel.spawn;
    player.x=clamp(Number(spawn.x)||currentLevel.spawn.x,40,WORLD.w-40);
    player.y=clamp(Number(spawn.y)||currentLevel.spawn.y,40,WORLD.h-40);
    if (circleHitsObstacle(player.x,player.y,player.r)) { player.x=currentLevel.spawn.x;player.y=currentLevel.spawn.y; }
    camera.x=player.x;camera.y=player.y;
    state.x=player.x;state.y=player.y;
    if(state.odinRecruited){
      odin.x=player.x-40;odin.y=player.y+30;odin.biteCooldown=0;odin.pounceCooldown=0;
      odin.howlCooldown=0;odin.guardianCooldown=0;odin.spiritTimer=0;odin.target=null;
      resetOdinVisuals();
    }
    attacks=[];pulses=[];particles=[];projectiles=[];hazards=[];boss=null;bossPadLatch=null;
    resetFirstStageRuntime('travel');
    spawnStageHeartblooms(state.stage);
    audioCall('sfx','unlock');
    showToast('ENTERING '+portal.name.toUpperCase(),'New terrain, enemies, and local quests await.','#62c7ff',4);
    saveGame(true);updateHUD(true);
  }

  function beginBlock(fromBuffer) {
    if (equipmentVisualRuntime.switching) return;
    if (!started || paused || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || dialogue) return;
    if (player.guardBroken > 0 || player.dashTimer > 0 || player.blockStamina <= 0) {
      if (!fromBuffer) inputBuffer.block = FIRST_STAGE_BALANCE.inputBufferSeconds;
      return;
    }
    if (!player.blocking) {
      inputBuffer.block = 0;
      recordFirstStageTutorial('block');
      player.blocking = true;
      player.blockStartedAt = nowTime;
      player.attackHeld = false;
      player.attackHold = 0;
      player.chargedThisHold = false;
      updateHUD(true);
    }
  }

  function endBlock() {
    if (!player.blocking) return;
    player.blocking = false;
    updateHUD(true);
  }

  function breakGuard() {
    player.blocking = false;
    player.blockStamina = 0;
    player.guardBroken = 1.35;
    player.invuln = 0;
    player.counterWindow = 0;
    player.blockFlash = 0.45;
    audioCall('sfx', 'hit');
    shake = 7;
    showFloat(player.x, player.y - 34, 'GUARD BREAK!', '#ff6680');
    for (var i = 0; i < 14; i++) spawnParticle(player.x, player.y, '#ff6680', 85, 3);
    updateHUD(true);
  }

  function tryBlockDamage(amount, fromX, fromY) {
    if (!player.blocking || player.guardBroken > 0 || player.blockStamina <= 0) return false;
    var elapsed = nowTime - player.blockStartedAt;
    var perfectWindow = (activeResonance('conductor') ? 0.28 : 0.20) +
      (touchCapable ? FIRST_STAGE_BALANCE.mobileBlockForgivenessSeconds : 0);
    var perfect = elapsed <= perfectWindow;
    var blockedDamage = perfect ? amount : Math.max(1, Math.ceil(amount * 0.75));
    var staminaCost = perfect ? 8 + amount * 3 : 15 + amount * 8;
    player.blockStamina = Math.max(0, player.blockStamina - staminaCost);
    state.statistics.blocksPerformed = (state.statistics.blocksPerformed || 0) + 1;
    state.statistics.damageBlocked = (state.statistics.damageBlocked || 0) + blockedDamage;
    gainProfessionXp('blocking',perfect ? 4 : 2,perfect ? 'Perfect block' : 'Guarding damage');
    player.blockFlash = perfect ? 0.38 : 0.22;
    player.invuln = perfect ? 0.32 : 0.16;
    var n = normalize(player.x - fromX, player.y - fromY);
    moveWithCollision(player, n.x * (perfect ? 5 : 12), n.y * (perfect ? 5 : 12));
    if (perfect) {
      state.statistics.perfectBlocks = (state.statistics.perfectBlocks || 0) + 1;
      player.counterWindow = 1.15;
      rhythmCombo.count += activeResonance('conductor') ? 3 : 2;
      rhythmCombo.timer = 2.4;
      rhythmCombo.lastQuality = 'PERFECT BLOCK';
      rhythmCombo.multiplier = rhythmCombo.count >= 100 ? 2.5 : rhythmCombo.count >= 50 ? 2 : rhythmCombo.count >= 25 ? 1.5 : rhythmCombo.count >= 10 ? 1.25 : 1;
      showFloat(player.x, player.y - 38, 'PERFECT BLOCK!', '#62c7ff');
      audioCall('sfx', 'pulse');
      for (var i = 0; i < 16; i++) spawnParticle(player.x, player.y, '#62c7ff', 95, 3);
    } else {
      showFloat(player.x, player.y - 32, 'BLOCK', '#7ce4d1');
      audioCall('sfx', 'dodge');
      for (var j = 0; j < 8; j++) spawnParticle(player.x, player.y, '#7ce4d1', 55, 2);
    }
    if (player.blockStamina <= 0) breakGuard();
    updateHUD(true);
    return true;
  }

  function damagePlayer(amount, fromX, fromY) {
    if (firstStageHostilesSuspended()) return;
    if (player.invuln > 0 || player.dashTimer > 0) return;
    if (tryBlockDamage(amount, fromX, fromY)) return;
    if (state.odinRecruited && state.skills.indexOf('odin-guardian') >= 0 &&
        player.health <= 2 && odin.guardianCooldown <= 0 && distance(player, odin) < 230) {
      odin.guardianCooldown = 18;
      odin.x = player.x - normalize(player.x - fromX, player.y - fromY).x * 28;
      odin.y = player.y - normalize(player.x - fromX, player.y - fromY).y * 28;
      triggerOdinAttack(0.45);
      player.invuln = 1.2;
      audioCall('sfx', 'pulse');
      showFloat(player.x, player.y - 34, 'ODIN GUARD!', '#62c7ff');
      for (var guardFx = 0; guardFx < 14; guardFx++) spawnParticle(player.x, player.y, '#62c7ff', 90, 3);
      return;
    }
    if (activeBuffs.defenseTimer > 0) amount = Math.max(1, Math.floor(amount * 0.5));
    if (state.stage === 1) amount = Math.max(1, Math.ceil(amount * FIRST_STAGE_BALANCE.enemyDamageMultiplier));
    if (state.purchases.indexOf('ironbark-plate') >= 0 && amount > 1) amount = Math.max(1, amount - 1);
    if (settings.difficulty === 'story') {
      player.invuln = 1.45;
    } else {
      player.invuln = settings.difficulty === 'hard' ? 0.72 : 1.0;
    }
    if (state.stage === 1) player.invuln += adaptiveFirstStageStrength() * 0.18;
    if (activeResonance('heavy') && amount > 1) amount = Math.max(1, amount - 1);
    var actualDamage = Math.min(player.health, amount);
    player.health -= amount;
    player.hurtTimer = 0.32;
    equipmentVisualRuntime.animationState = player.health <= 0 ? 'death' : 'hurt';
    equipmentVisualRuntime.animationElapsed = 0;
    state.statistics.damageTaken += actualDamage;
    if (state.stage === 1) {
      encounterDirector.recentDamage = (encounterDirector.recentDamage || 0) + actualDamage;
      state.firstStageOnboarding.struggle = clamp(
        state.firstStageOnboarding.struggle + actualDamage * 0.18, 0, 10
      );
    }
    resetCombo('damage');
    var n = normalize(player.x - fromX, player.y - fromY);
    moveWithCollision(player, n.x * 26, n.y * 26);
    audioCall('sfx', 'hit');
    shake = settings.difficulty === 'hard' ? 8 : 6;
    for (var i = 0; i < 12; i++) spawnParticle(player.x, player.y, '#ff6680', 75, 3);
    updateHUD();
    if (player.health <= 0) defeatPlayer();
  }

  function defeatPlayer() {
    if (state.skills.indexOf('encore') >= 0 && !state.encoreUsed) {
      state.encoreUsed = true;
      player.health = Math.min(3, player.maxHealth);
      player.invuln = 2;
      audioCall('sfx', 'unlock');
      showToast('ENCORE!', 'Your rhythm refused to fade.', '#ffc857', 3.5);
      updateHUD();
      return;
    }
    if (activeBuffs.revivalReady) {
      activeBuffs.revivalReady = false;
      player.health = player.maxHealth;
      player.invuln = 2;
      audioCall('sfx', 'unlock');
      showToast('REVIVAL SEED', 'The grove gives you another chance.', '#7df7a1', 3.5);
      updateHUD();
      return;
    }
    player.health = 0;
    equipmentVisualRuntime.animationState = 'death';
    equipmentVisualRuntime.animationElapsed = 0;
    equipmentVisualRuntime.switching = false;
    if (state.dreamEncore.active) finishDreamEncore(false);
    state.statistics.deaths++;
    if (state.stage === 1) {
      state.firstStageOnboarding.struggle = clamp(state.firstStageOnboarding.struggle + 2,0,10);
      state.firstStageOnboarding.checkpointReloads++;
    }
    saveGame(true);
    updateHUD();
    paused = true;
    setTimeout(function () {
      boss = null;
      projectiles = [];
      hazards = [];
      attacks = [];
      player.x = currentLevel.spawn.x;
      player.y = currentLevel.spawn.y;
      player.health = player.maxHealth;
      player.invuln = 2;
      resetEquipmentVisualRuntime(true);
      resetFirstStageRuntime('respawn');
      enemies.forEach(function (enemy) {
        if (enemy.dead) return;
        releaseEnemyAttackSlot(enemy);
        enemy.mode = 'idle';
        enemy.vx = enemy.vy = 0;
        enemy.spawnWarmup = state.stage === 1 ? FIRST_STAGE_BALANCE.enemySpawnWarmupSeconds : 0;
      });
      paused = orientationBlocked || panelIsOpen('pauseScreen');
      if (orientationBlocked) {
        setHidden(byId('pauseScreen'), false);
        setOverlayIsolation('pause', 'pauseScreen', true);
        audioCall('pause', true);
      } else {
        audioCall('pause', false);
        focusSoon('gameCanvas');
      }
      audioCall('sfx', 'quest');
      showToast('BACK ON THE BEAT', 'No collectibles lost. Take a breath and try again.', '#56f0c4', 3.5);
      updateHUD();
    }, 650);
  }

  function hitEnemy(enemy, damage, sourceX, sourceY, lightweightEffects) {
    if (enemy.dead || enemy.progressionLocked || enemy.flash > 0 || (enemy.type === 'wisp' && enemy.shielded)) {
      if (enemy.type === 'wisp' && enemy.shielded) {
        audioCall('sfx', 'error');
        showFloat(enemy.x, enemy.y - 20, 'PULSE FIRST', '#db80ff');
      }
      return false;
    }
    if (enemy.weakness === state.equippedInstrument) {
      damage = Math.max(damage + 1,Math.ceil(damage * 1.25));
      if (!enemy.weaknessFlash || enemy.weaknessFlash <= 0) {
        showFloat(enemy.x,enemy.y-33,'WEAKNESS',equippedInstrument().color);
        enemy.weaknessFlash = 0.8;
      }
    }
    state.statistics.damageDealt += Math.min(enemy.hp, damage);
    enemy.hp -= damage;
    enemy.flash = 0.14;
    enemy.stun = Math.max(enemy.stun, 0.22);
    setAnimationState(enemy, 'hurt', 0.18);
    var n = normalize(enemy.x - sourceX, enemy.y - sourceY);
    enemy.x += n.x * 14;
    enemy.y += n.y * 14;
    audioCall('sfx', 'enemyHit');
    var hitParticleCount = lightweightEffects ? 4 : 8;
    for (var i = 0; i < hitParticleCount; i++) spawnParticle(enemy.x, enemy.y, enemyColor(enemy), 60, 3);
    if (enemy.hp <= 0) killEnemy(enemy, lightweightEffects);
    return true;
  }

  function killEnemy(enemy, lightweightEffects) {
    if (!enemy || enemy.dead) return;
    enemy.dead = true;
    releaseEnemyAttackSlot(enemy);
    enemy.deathTimer = 0;
    enemy.deathDuration = enemy.deathDuration || 1.3;
    setAnimationState(enemy, 'death');
    state.totalKills++;
    if (state.stage === 1) {
      state.firstStageOnboarding.struggle = Math.max(0,state.firstStageOnboarding.struggle - 0.35);
    }
    var coinReward = state.skills.indexOf('lucky-leaf') >= 0 ? 3 : 2;
    if (state.skills.indexOf('coin-magnet') >= 0) coinReward += 1;
    if (state.purchases.indexOf('fortune-charm') >= 0) coinReward += 1;
    if (activeResonance('conductor')) coinReward += 1;
    if (enemy.elite) coinReward += 8;
    if (enemy.isMiniBoss) coinReward += 15;
    if (state.weather==='blood-moon') coinReward += 2;
    state.beatcoins += coinReward;
    state.statistics.beatcoinsEarned += coinReward;
    var stageMaterial = ['heartwood','sporeSilk','prismDust','tidePearl'][clamp(state.stage,1,4)-1];
    var materialChance = enemy.elite || enemy.isMiniBoss ? 1 : 0.2;
    if (Math.random() < materialChance) addCraftingMaterial(stageMaterial,enemy.isMiniBoss ? 3 : enemy.elite ? 2 : 1);
    if (enemy.elite || enemy.isMiniBoss) {
      addCraftingMaterial('echoCore',enemy.isMiniBoss ? 2 : 1);
      gainProfessionXp('bossHunting',enemy.isMiniBoss ? 18 : 8,
        enemy.isMiniBoss ? 'Defeating a mini boss' : 'Defeating an elite');
    }
    if (state.totalKills % 5 === 0) state.skillPoints++;
    gainInstrumentMastery(enemy.elite ? 12 : 4);
    if (enemy.isMiniBoss && enemy.miniBossId) {
      if (state.miniBossesDefeated.indexOf(enemy.miniBossId) < 0) state.miniBossesDefeated.push(enemy.miniBossId);
      state.statistics.miniBossesDefeated++;
      state.skillPoints++;
      gainInstrumentMastery(20);
      showToast(enemy.name + ' DEFEATED','Unique loot: ' + enemy.loot + ' · +1 Skill Point · +' + coinReward + ' Beatcoins',enemy.miniColor || '#ffc857',4.5);
    }
    if (enemy.elite && enemy.eliteId) {
      if (state.eliteDefeated.indexOf(enemy.eliteId) < 0) state.eliteDefeated.push(enemy.eliteId);
      state.statistics.eliteEnemiesDefeated++;
      showToast((enemy.eliteName || 'ELITE') + ' DEFEATED',
        'Rare drop: ' + enemy.loot + ' · +' + coinReward + ' Beatcoins',enemy.eliteColor || '#f6e36d',3.6);
    }
    var criticalHealth = player.health <= Math.max(1, Math.floor(player.maxHealth / 2));
    var firstStageDropChance = 0.32 * FIRST_STAGE_BALANCE.healingDropModifier +
      adaptiveFirstStageStrength() * 0.22;
    var healingDropAllowed = state.stage !== 1 || firstStageRuntime.healingDropCooldown <= 0;
    if (healingDropAllowed && (criticalHealth || state.weather==='forest-bloom' ||
        Math.random() < (state.stage === 1 ? firstStageDropChance : 0.32) ||
        state.skills.indexOf('lucky-leaf') >= 0)) {
      var dropPlacement = findValidEnemySpawn(enemy,{
        radius:8,baseRadius:0,radiusStep:16,enforcePlayerDistance:false,ignoreEnemy:enemy,attempts:8
      });
      if (dropPlacement.position) {
        healthPickups.push({ x:dropPlacement.position.x, y:dropPlacement.position.y, life:18, bob:Math.random()*6.28 });
        if (state.stage === 1) firstStageRuntime.healingDropCooldown = FIRST_STAGE_BALANCE.healingDropCooldownSeconds;
      }
    }
    if (state.stage === 1 && !enemy.isMiniBoss &&
        state.firstStageOnboarding.tutorialFlags.indexOf('first-victory') < 0) {
      recordFirstStageTutorial('first-victory');
      healPlayer(2);
      player.invuln = Math.max(player.invuln,1.2);
      showToast('FIRST ENCORE', 'The grove restores you after your first practice fight.', '#ff9cab', 3);
    }
    if (enemy.id.indexOf('summon_') !== 0 && state.defeated.indexOf(enemy.id) < 0) state.defeated.push(enemy.id);
    audioCall('sfx', 'quest');
    showFloat(enemy.x, enemy.y - 22, 'QUIET!', '#ffc857');
    var deathParticleCount = lightweightEffects ? 8 : 14;
    for (var i = 0; i < deathParticleCount; i++) spawnParticle(enemy.x, enemy.y, enemyColor(enemy), 95, 4);
    if (enemy.group === 'bramble' && aliveGroup('bramble').length === 0 && state.notes.indexOf('E') < 0) {
      showToast('BRAMBLE BELL CLEARED', 'The western shrine is ready.', NOTE_COLORS.E, 3);
    }
    if (enemy.group === 'blu' && aliveGroup('blu').length === 0 && !state.pulse) {
      showToast('BLU CAN BREATHE', 'Talk to Blu to learn Resonance Pulse.', '#62c7ff', 3);
    }
    saveGame(true);
  }

  function spawnStageHeartblooms(stage) {
    var placements = STAGE_HEARTBLOOMS[stage] || STAGE_HEARTBLOOMS[1];
    healthPickups = placements.map(function (h, index) {
      return { id:'stage-' + stage + '-heart-' + index, x:h.x, y:h.y, life:Infinity, fixed:true, bob:index * 1.7, fullNotice:0 };
    }).filter(function (heartbloom) {
      return state.collectedHeartblooms.indexOf(heartbloom.id) < 0;
    });
  }

  function healPlayer(amount) {
    if (player.health >= player.maxHealth) return 0;
    var before = player.health;
    player.health = Math.min(player.maxHealth, player.health + amount);
    state.statistics.heartsRecovered += player.health - before;
    updateHUD(true);
    return player.health - before;
  }

  function storeHeartbloom(heartbloom) {
    if (state.heartblooms >= HEARTBLOOM_CAPACITY) {
      if (!heartbloom.fullNotice || heartbloom.fullNotice <= 0) {
        heartbloom.fullNotice = 1.4;
        audioCall('sfx', 'error');
        showFloat(heartbloom.x, heartbloom.y - 18, 'MEDICINE POUCH FULL', '#ffe0a3');
      }
      return false;
    }
    state.heartblooms++;
    state.statistics.healingItemsCollected++;
    if (heartbloom.fixed && heartbloom.id && state.collectedHeartblooms.indexOf(heartbloom.id) < 0) {
      state.collectedHeartblooms.push(heartbloom.id);
    }
    heartbloom.life = 0;
    audioCall('sfx', 'unlock');
    showFloat(heartbloom.x, heartbloom.y - 18, 'STORED  ♥  ' + state.heartblooms + '/' + HEARTBLOOM_CAPACITY, '#ff9cab');
    if (state.statistics.healingItemsCollected === 1) {
      showToast('HEARTBLOOM STORED', touchCapable ? 'Tap HEAL when hurt, or use it from Supplies.' : 'Press H when hurt, or use it from Supplies.', '#ff7892', 4);
    }
    saveGame(true);
    updateHUD(true);
    return true;
  }

  function useStoredHeartbloom() {
    if (!started || dialogue || composerOpen || mapOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen) return false;
    if (state.heartblooms <= 0) {
      audioCall('sfx', 'error');
      showToast('MEDICINE POUCH EMPTY', 'Collect glowing Heartblooms from the field or defeated enemies.', '#a3aeb0', 2.4);
      return false;
    }
    if (player.health >= player.maxHealth) {
      audioCall('sfx', 'error');
      showToast('HEALTH ALREADY FULL', 'Your Heartblooms will stay fresh for later.', '#ffb2ba', 2.2);
      return false;
    }
    var critical = player.health <= Math.max(1, Math.floor(player.maxHealth / 2));
    var amount = critical && state.skills.indexOf('grove-vitality') >= 0 ? 2 : 1;
        if (state.purchases.indexOf('heartbloom-pouch') >= 0) amount += 1;
    if (activeResonance('nature')) amount += 1;
    state.heartblooms--;
    recordFirstStageTutorial('heal');
    state.statistics.healingItemsUsed++;
    var restored = healPlayer(amount);
    player.invuln = Math.max(player.invuln, 0.45);
    audioCall('sfx', 'unlock');
    showFloat(player.x, player.y - 28, '+' + restored + (restored === 1 ? ' HEART' : ' HEARTS'), '#ff9cab');
    for (var i = 0; i < 12; i++) spawnParticle(player.x, player.y, '#ff7892', 62, 3);
    saveGame(true);
    updateHUD(true);
    return true;
  }

  function updateHealthPickups(dt) {
    healthPickups.forEach(function (h) {
      if (!h.fixed) h.life -= dt;
      h.fullNotice = Math.max(0, (h.fullNotice || 0) - dt);
      if (distance(player, h) < 30) storeHeartbloom(h);
    });
    healthPickups = healthPickups.filter(function(h){return h.life>0;});
  }

  function enemyColor(enemy) {
    if (enemy.elite && enemy.eliteColor) return enemy.eliteColor;
    if (enemy.type === 'thorn') return '#ef6f72';
    if (enemy.type === 'buzz') return '#ffc857';
    if (enemy.type === 'slime') return '#d864d8';
    return '#8eb8ff';
  }

  function inventoryItem(id) {
    return INVENTORY_ITEMS.find(function (item) { return item.id === id; });
  }

  function unlockedInventoryCount() {
    return INVENTORY_ITEMS.filter(function (item) { return item.unlocked(); }).length;
  }

  function openInventory() {
    if (!started || dialogue || composerOpen || mapOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen) return;
    releaseHeldInputs();
    inventoryReturnsToPause = paused;
    if (paused) setOverlayIsolation('pause', 'pauseScreen', false);
    inventoryOpen = true;
    setHidden(byId('inventoryScreen'), false);
    setOverlayIsolation('inventory', 'inventoryScreen', true);
    renderInventory();
    audioCall('pause', true);
    audioCall('sfx', 'dialogue');
    focusSoon('closeInventoryButton');
  }

  function closeInventory() {
    if (!inventoryOpen) return;
    inventoryOpen = false;
    setOverlayIsolation('inventory', 'inventoryScreen', false);
    setHidden(byId('inventoryScreen'), true);
    if (!paused) audioCall('pause', false);
    if (inventoryReturnsToPause && paused) setOverlayIsolation('pause', 'pauseScreen', true);
    var returnToPause = inventoryReturnsToPause && paused;
    inventoryReturnsToPause = false;
    focusSoon(returnToPause ? 'pauseBackpackButton' : 'gameCanvas');
  }

  function selectInventoryItem(id, focusSlot) {
    inventorySelection = id;
    renderInventoryDetail();
    document.querySelectorAll('.inventory-slot').forEach(function (slot) {
      slot.classList.toggle('selected', slot.getAttribute('data-item-id') === id);
      slot.setAttribute('aria-pressed', slot.getAttribute('data-item-id') === id ? 'true' : 'false');
    });
    if (focusSlot) focusSlot.focus();
  }

  function renderInventory() {
    var tabs = byId('inventoryTabs');
    var grid = byId('inventoryGrid');
    var progress = byId('inventoryProgress');
    if (!tabs || !grid) return;
    if (progress) progress.textContent = unlockedInventoryCount() + ' / ' + INVENTORY_ITEMS.length;
    tabs.innerHTML = '';
    INVENTORY_CATEGORIES.forEach(function (category) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-tab';
      button.id = 'inventory-tab-' + category.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', category.id === inventoryCategory ? 'true' : 'false');
      button.textContent = category.label;
      button.addEventListener('click', function () {
        inventoryCategory = category.id;
        var first = INVENTORY_ITEMS.find(function (item) { return item.category === category.id; });
        if (first) inventorySelection = first.id;
        renderInventory();
        focusSoon(button.id);
      });
      tabs.appendChild(button);
    });
    grid.setAttribute('aria-labelledby', 'inventory-tab-' + inventoryCategory);
    grid.innerHTML = '';
    var entries = INVENTORY_ITEMS.filter(function (item) { return item.category === inventoryCategory; });
    if (!entries.some(function (item) { return item.id === inventorySelection; })) inventorySelection = entries[0].id;
    entries.forEach(function (item) {
      var unlocked = item.unlocked();
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-slot' + (unlocked ? '' : ' locked') + (item.id === inventorySelection ? ' selected' : '');
      button.setAttribute('data-item-id', item.id);
      button.setAttribute('aria-pressed', item.id === inventorySelection ? 'true' : 'false');
      button.setAttribute('aria-label', unlocked ? item.name : 'Undiscovered ' + inventoryCategory + ' item');
      button.style.setProperty('--slot-color', item.color);
      var icon = document.createElement('span');
      icon.className = 'inventory-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('style', itemCellStyle(item.row, item.col));
      button.appendChild(icon);
      var label = document.createElement('span');
      label.className = 'inventory-slot-name';
      label.textContent = unlocked ? item.name : '???';
      button.appendChild(label);
      if (unlocked && item.quantity) {
        var quantity = document.createElement('span');
        quantity.className = 'inventory-quantity';
        quantity.textContent = item.quantity();
        button.appendChild(quantity);
      }
      button.addEventListener('click', function () { selectInventoryItem(item.id); });
      grid.appendChild(button);
    });
    renderInventoryDetail();
  }

  function renderInventoryDetail() {
    var item = inventoryItem(inventorySelection);
    if (!item) return;
    var unlocked = item.unlocked();
    var category = INVENTORY_CATEGORIES.find(function (entry) { return entry.id === item.category; });
    var icon = byId('inventoryDetailIcon');
    if (icon) {
      icon.setAttribute('style', itemCellStyle(item.row, item.col));
      icon.style.filter = unlocked ? 'none' : 'grayscale(1) brightness(.35)';
    }
    if (byId('inventoryDetailCategory')) byId('inventoryDetailCategory').textContent = category.label;
    if (byId('inventoryDetailName')) byId('inventoryDetailName').textContent = unlocked ? item.name : 'Undiscovered';
    if (byId('inventoryDetailDescription')) byId('inventoryDetailDescription').textContent = unlocked ? item.description : 'Keep exploring the stage roads to reveal this item.';
    if (byId('inventoryDetailMeta')) byId('inventoryDetailMeta').textContent = unlocked ? (item.meta ? item.meta() : (item.quantity ? item.quantity() : 'Collected')) : 'Not yet discovered';
    var action = byId('inventoryActionButton');
    if (action) {
      var hasAction = unlocked && typeof item.action === 'function';
      var usable = hasAction && !(item.id === 'eems-mossbox' && !hasAllNotes()) &&
        (typeof item.canUse !== 'function' || item.canUse());
      setHidden(action, !hasAction);
      action.disabled = !usable;
      action.textContent = usable ? (typeof item.actionLabel === 'function' ? item.actionLabel() : item.actionLabel || 'Use item') :
        (typeof item.unavailableLabel === 'function' ? item.unavailableLabel() : item.unavailableLabel || 'Unavailable');
      action.onclick = usable ? function () { item.action(); renderInventory(); } : null;
    }
  }


  var RESONANCE_BUILDS = [
    {id:'nature',name:'Nature Resonance',tone:'Guardian groove',desc:'Passive recovery, stronger Odin attacks, and improved Heartblooms.',requirements:['Recruit Odin','Learn Second Wind','Complete Lost Mixtapes'],unlocked:function(){return state.odinRecruited && state.skills.indexOf('grove-vitality')>=0 && state.collectibleRewards.indexOf('mossvale')>=0;}},
    {id:'psychedelic',name:'Psychedelic Resonance',tone:'Prismatic pulse',desc:'Echo Pulse deals +1 damage and reaches farther through enemies.',requirements:['Learn Echo Chamber','Learn Relic Hunter','Complete Prism Fragments'],unlocked:function(){return state.skills.indexOf('echo-chamber')>=0 && state.skills.indexOf('relic-hunter')>=0 && state.collectibleRewards.indexOf('skyglass')>=0;}},
    {id:'heavy',name:'Heavy Resonance',tone:'Stagger build',desc:'Melee attacks deal +1 damage, charged cleaves stagger longer, and incoming damage is softened.',requirements:['Learn Wide Arc','Own Ironbark Plate','Complete Root Runes'],unlocked:function(){return state.skills.indexOf('strong-strike')>=0 && state.purchases.indexOf('ironbark-plate')>=0 && state.collectibleRewards.indexOf('rootsong')>=0;}},
    {id:'conductor',name:'Conductor Resonance',tone:'Master tempo',desc:'Attack, dash, and pulse cooldowns recover 20% faster. Enemies also drop a bonus Beatcoin.',requirements:['Learn Rhythm Master','Own Tempo Ring','Complete all four sets'],unlocked:function(){return state.skills.indexOf('rhythm-master')>=0 && state.purchases.indexOf('tempo-ring')>=0 && state.collectibleRewards.length>=4;}}
  ];
  function activeResonance(id){return state.activeResonance===id;}
  function renderResonances(){
    var grid=byId('resonanceGrid'), status=byId('resonanceStatus'); if(!grid)return;
    grid.innerHTML='';
    RESONANCE_BUILDS.forEach(function(build){
      var unlocked=build.unlocked(), active=activeResonance(build.id), card=document.createElement('article');
      card.className='resonance-card'+(active?' active':'')+(!unlocked?' locked':'');
      card.innerHTML='<div class="resonance-card-heading"><div><p class="panel-kicker">'+build.tone+'</p><h3>'+build.name+'</h3></div><span class="resonance-state">'+(active?'EQUIPPED':unlocked?'READY':'LOCKED')+'</span></div><p>'+build.desc+'</p><p class="resonance-requirements">'+build.requirements.join(' · ')+'</p><button class="game-button button-primary" '+(!unlocked||active?'disabled':'')+'>'+(active?'Equipped':unlocked?'Equip resonance':'Requirements unmet')+'</button>';
      card.querySelector('button').onclick=function(){if(!unlocked)return;state.activeResonance=build.id;audioCall('sfx','unlock');showToast(build.name.toUpperCase(),build.desc,'#d77cff',3.5);saveGame(true);renderResonances();updateHUD(true);};
      grid.appendChild(card);
    });
    if(status){var found=RESONANCE_BUILDS.find(function(b){return activeResonance(b.id);});status.textContent=found?'Active: '+found.name:'No resonance equipped';}
  }

  var INSTRUMENTS = [
    {id:'guitar',name:'Electric Guitar',index:0,color:'#62c7ff',role:'Fast melee · lightning · criticals',attack:'Voltage Riff',special:'Chain Spark',ultimate:'Stormcaller Solo',baseDamage:1,cooldown:0.21,range:68,arc:1.02,charge:0.46},
    {id:'bass',name:'Bass',index:1,color:'#ff9d57',role:'Heavy · knockback · armour break',attack:'Low-End Slam',special:'Faultline',ultimate:'Earthshaker Drop',baseDamage:2,cooldown:0.42,range:76,arc:1.24,charge:0.72},
    {id:'synth',name:'Synth',index:2,color:'#d77cff',role:'Projectiles · area denial · echoes',attack:'Prism Bolt',special:'Echo Mine',ultimate:'Dreamwave Cascade',baseDamage:1,cooldown:0.31,range:178,arc:0.36,charge:0.58},
    {id:'drums',name:'Drumsticks',index:3,color:'#ffc857',role:'Shockwaves · control · area damage',attack:'Backbeat',special:'Rolling Thunder',ultimate:'Colossus Break',baseDamage:1,cooldown:0.34,range:88,arc:1.55,charge:0.54},
    {id:'microphone',name:'Microphone',index:4,color:'#7ce4d1',role:'Healing · buffs · support',attack:'Bright Chorus',special:'Second Verse',ultimate:'Moonchoir Anthem',baseDamage:1,cooldown:0.29,range:112,arc:1.36,charge:0.55},
    {id:'violin',name:'Violin',index:5,color:'#a9f58b',role:'Precision · bleed · spirit summons',attack:'Silver Cut',special:'Spirit String',ultimate:'Wildwood Concerto',baseDamage:1,cooldown:0.25,range:122,arc:0.5,charge:0.48}
  ];
  var instrumentUltimateCharge = 0;
  var instrumentHitStreak = 0;

  function instrumentById(id) {
    return INSTRUMENTS.find(function (instrument) { return instrument.id === id; }) || INSTRUMENTS[0];
  }

  function equippedInstrument() {
    return instrumentById(state.equippedInstrument);
  }

  function equipmentRigAvailable() {
    return !!(window.MossEquipmentRig && typeof window.MossEquipmentRig.resolvePose === 'function');
  }

  function resetEquipmentVisualRuntime(respawning) {
    equipmentVisualRuntime.animationState = respawning ? 'respawn' : 'idle';
    equipmentVisualRuntime.animationElapsed = 0;
    equipmentVisualRuntime.switching = false;
    equipmentVisualRuntime.from = state.equippedInstrument;
    equipmentVisualRuntime.to = state.equippedInstrument;
    equipmentVisualRuntime.switchElapsed = 0;
    equipmentVisualRuntime.specialTimer = 0;
    equipmentVisualRuntime.respawnTimer = respawning ? 0.34 : 0;
    equipmentVisualRuntime.lastPose = null;
    equipmentVisualRuntime.diagnosticSignature = '';
  }

  function visualEquipmentId() {
    if (!equipmentVisualRuntime.switching) return state.equippedInstrument;
    return equipmentVisualRuntime.switchElapsed < equipmentVisualRuntime.switchDuration * 0.5 ?
      equipmentVisualRuntime.from : equipmentVisualRuntime.to;
  }

  function requestInstrumentSwitch(id) {
    var next = instrumentById(id);
    if (!next || next.id !== id || state.unlockedInstruments.indexOf(id) < 0) return false;
    if (!started || dialogue || player.health <= 0 || player.guardBroken > 0) {
      audioCall('sfx','error');
      return false;
    }
    if (!equipmentRigAvailable()) {
      // The save remains usable even if the optional rig script failed to load.
      state.equippedInstrument = id;
      saveGame(true);
      return true;
    }
    if (!equipmentVisualRuntime.switching && state.equippedInstrument === id) return true;
    if (nowTime - equipmentVisualRuntime.lastRequestedAt < 0.12) return false;
    equipmentVisualRuntime.lastRequestedAt = nowTime;
    equipmentVisualRuntime.from = visualEquipmentId();
    equipmentVisualRuntime.to = id;
    equipmentVisualRuntime.switchElapsed = 0;
    equipmentVisualRuntime.switchDuration = settings.reducedMotion ? 0.34 : 0.58;
    equipmentVisualRuntime.switching = true;
    equipmentVisualRuntime.animationState = 'switch';
    equipmentVisualRuntime.animationElapsed = 0;
    state.equippedInstrument = id;
    if (state.equipmentVisual.preferredLoadout.indexOf(id) < 0) {
      state.equipmentVisual.preferredLoadout.unshift(id);
      state.equipmentVisual.preferredLoadout = state.equipmentVisual.preferredLoadout.slice(0,3);
    }
    // Opening the loadout screen is an explicit safe cancel: no old attack
    // hitbox survives into the item transition and no held input can duplicate it.
    attacks = [];
    player.attackHeld = false;
    player.attackHold = 0;
    player.chargedThisHold = false;
    player.blocking = false;
    inputBuffer.attack = 0;
    player.attackCooldown = Math.max(player.attackCooldown,equipmentVisualRuntime.switchDuration);
    audioCall('sfx','unlock');
    saveGame(true);
    canvasDirty = true;
    return true;
  }

  function deriveEquipmentAnimationState() {
    if (equipmentVisualRuntime.switching) return 'switch';
    if (player.health <= 0) return 'death';
    if (equipmentVisualRuntime.respawnTimer > 0) return 'respawn';
    if (player.hurtTimer > 0) return 'hurt';
    if (player.guardBroken > 0) return 'stun';
    if (player.blocking || player.blockFlash > 0 || player.counterWindow > 0) return 'block';
    if (player.dashTimer > 0) return 'dash';
    if (equipmentVisualRuntime.specialTimer > 0) return 'special';
    if (player.attackHeld && player.chargedThisHold) return 'charged';
    if (attacks.length) return attacks[attacks.length - 1].charged ? 'charged' : 'attack';
    if (player.moveX || player.moveY) return 'walk';
    return 'idle';
  }

  function updateEquipmentVisual(dt) {
    player.hurtTimer = Math.max(0,(player.hurtTimer || 0) - dt);
    equipmentVisualRuntime.specialTimer = Math.max(0,(equipmentVisualRuntime.specialTimer || 0) - dt);
    equipmentVisualRuntime.respawnTimer = Math.max(0,(equipmentVisualRuntime.respawnTimer || 0) - dt);
    if (equipmentVisualRuntime.switching) {
      equipmentVisualRuntime.switchElapsed += dt;
      if (equipmentVisualRuntime.switchElapsed >= equipmentVisualRuntime.switchDuration) {
        equipmentVisualRuntime.switching = false;
        equipmentVisualRuntime.switchElapsed = equipmentVisualRuntime.switchDuration;
        equipmentVisualRuntime.from = equipmentVisualRuntime.to;
      }
    }
    var nextState = deriveEquipmentAnimationState();
    if (nextState !== equipmentVisualRuntime.animationState) {
      equipmentVisualRuntime.animationState = nextState;
      equipmentVisualRuntime.animationElapsed = 0;
    } else {
      equipmentVisualRuntime.animationElapsed += dt;
    }
  }

  function resolveEquipmentPose(instrumentId, animationState, facing, elapsed, progress, legendary, direction) {
    if (!equipmentRigAvailable()) return null;
    return window.MossEquipmentRig.resolvePose({
      characterId:'player-default',
      equipmentId:instrumentById(instrumentId).id,
      animationId:animationState,
      facing:facing,
      direction:direction,
      elapsed:elapsed,
      progress:progress,
      legendary:legendary == null ? state.masteryNodes.indexOf(instrumentId + '-legendary') >= 0 : legendary
    });
  }

  function currentEquipmentPose() {
    var switchProgress = equipmentVisualRuntime.switchDuration > 0 ?
      clamp(equipmentVisualRuntime.switchElapsed / equipmentVisualRuntime.switchDuration,0,1) : 1;
    var currentId = visualEquipmentId();
    return resolveEquipmentPose(
      currentId,
      equipmentVisualRuntime.animationState,
      player.facing,
      equipmentVisualRuntime.animationElapsed,
      equipmentVisualRuntime.switching ? switchProgress : undefined
    );
  }

  function equipmentWorldOrigin(instrumentId, animationState, facing, elapsed, originName, progress) {
    var pose = resolveEquipmentPose(instrumentId,animationState,facing,elapsed,progress);
    return pose ? window.MossEquipmentRig.worldOrigin(player,pose,originName) : {x:player.x,y:player.y};
  }

  function drawEquipmentLayer(pose, layer, alpha) {
    if (!pose || !equipmentRigAvailable() || !spriteAvailable('instrument-mastery')) return false;
    return window.MossEquipmentRig.draw(
      ctx,spriteImages['instrument-mastery'],pose,layer,
      {
        alpha:alpha == null ? 1 : alpha,
        glow:pose.item.atlasRow ? instrumentById(pose.equipmentId).color : '',
        glowBlur:pose.item.atlasRow ? 8 : 0
      }
    );
  }

  function equipmentNetworkSnapshot(pose) {
    if (!pose || !equipmentRigAvailable()) return {
      equipmentId:state.equippedInstrument,animationState:'idle',animationFrame:0,
      animationElapsed:0,animationTimestamp:Date.now(),facingDirection:'south',networkStateId:0,
      cosmeticVariant:'standard',schemaVersion:0,legendary:false,switching:false,
      switchFrom:state.equippedInstrument,switchTo:state.equippedInstrument,
      switchProgress:1,switchDuration:equipmentVisualRuntime.switchDuration
    };
    var snapshot = window.MossEquipmentRig.networkSnapshot(pose,state.equipmentVisual.cosmeticVariant);
    // Elapsed time lets remote clients continue the authored pose smoothly
    // between the 10 Hz world snapshots without trusting their wall clock.
    snapshot.animationElapsed = clamp(Number(equipmentVisualRuntime.animationElapsed) || 0,0,86400);
    snapshot.legendary = state.masteryNodes.indexOf(pose.equipmentId + '-legendary') >= 0;
    snapshot.switching = equipmentVisualRuntime.switching;
    snapshot.switchFrom = equipmentVisualRuntime.from;
    snapshot.switchTo = equipmentVisualRuntime.to;
    snapshot.switchProgress = equipmentVisualRuntime.switchDuration > 0 ?
      clamp(equipmentVisualRuntime.switchElapsed / equipmentVisualRuntime.switchDuration,0,1) : 1;
    snapshot.switchDuration = clamp(Number(equipmentVisualRuntime.switchDuration) || 0.58,0.2,2);
    return snapshot;
  }

  function updateEquipmentDiagnostics(pose) {
    if (!pose) return;
    var signature = [pose.equipmentId,pose.animationId,pose.direction,pose.frameIndex,
      pose.item.layer,equipmentVisualRuntime.switching ? 1 : 0].join('|');
    if (signature === equipmentVisualRuntime.diagnosticSignature) return;
    equipmentVisualRuntime.diagnosticSignature = signature;
    equipmentVisualRuntime.lastPose = pose;
    canvas.dataset.equipmentSchema = String(pose.schemaVersion);
    canvas.dataset.equipmentId = pose.equipmentId;
    canvas.dataset.equipmentState = pose.animationId;
    canvas.dataset.equipmentDirection = pose.direction;
    canvas.dataset.equipmentFrame = String(pose.frameIndex);
    canvas.dataset.equipmentLayer = pose.item.layer;
    canvas.dataset.equipmentSwitching = String(equipmentVisualRuntime.switching);
    canvas.dataset.equipmentHitboxOrigin = Math.round(pose.origins.hitbox.x) + ',' + Math.round(pose.origins.hitbox.y);
  }

  function instrumentMasteryRecord(id) {
    if (!state.instrumentMastery[id]) state.instrumentMastery[id] = {xp:0,level:1};
    return state.instrumentMastery[id];
  }

  function masteryThreshold(level) {
    return 26 + level * 20;
  }

  function instrumentCellStyle(index, legendary) {
    return 'background-position:' + (index * 20) + '% ' + (legendary ? '100%' : '0%');
  }

  function unlockInstrument(id, reason) {
    var instrument = instrumentById(id);
    if (state.unlockedInstruments.indexOf(id) >= 0) return false;
    state.unlockedInstruments.push(id);
    showToast(instrument.name.toUpperCase() + ' UNLOCKED', reason || instrument.role, instrument.color, 4);
    audioCall('sfx','unlock');
    saveGame(true);
    return true;
  }

  function applyInstrumentUnlocks() {
    if (state.bossDefeated) unlockInstrument('bass','The Nullspeaker left a low frequency behind.');
    if (state.chapterRelics.indexOf('rootsong') >= 0 || state.metPip) unlockInstrument('drums','Pip shares the Rootsong backbeat.');
    if (state.chapterRelics.indexOf('skyglass') >= 0 || state.metZephra) unlockInstrument('synth','Zephra tunes a portable Skyglass circuit.');
    if (state.home.unlocked) unlockInstrument('microphone','The Music Room restores Mara’s moon-silver microphone.');
    if (state.chapterRelics.indexOf('moonwake') >= 0 || state.metTavi) unlockInstrument('violin','Tavi entrusts you with a tidewood violin.');
  }

  function gainInstrumentMastery(amount) {
    var instrument = equippedInstrument();
    var record = instrumentMasteryRecord(instrument.id);
    record.xp += Math.max(1, Math.floor(amount || 1));
    instrumentUltimateCharge = clamp(instrumentUltimateCharge + amount * 3.2, 0, 100);
    var levelled = false;
    while (record.level < 10 && record.xp >= masteryThreshold(record.level)) {
      record.xp -= masteryThreshold(record.level);
      record.level++;
      levelled = true;
      showToast(instrument.name.toUpperCase() + ' MASTERY ' + record.level,
        record.level >= 10 ? instrument.ultimate + ' is ready to learn.' : 'A new mastery node is available.',
        instrument.color, 3.4);
    }
    if (levelled) {
      state.statistics.instrumentsMastered = INSTRUMENTS.filter(function (entry) {
        return instrumentMasteryRecord(entry.id).level >= 10;
      }).length;
      saveGame(true);
    }
  }

  function instrumentProfile(id) {
    var instrument = instrumentById(id || state.equippedInstrument);
    var record = instrumentMasteryRecord(instrument.id);
    var profile = {
      damage:instrument.baseDamage,
      cooldown:instrument.cooldown,
      range:instrument.range,
      arc:instrument.arc,
      knockback:14,
      crit:0,
      pulseDamage:0,
      specialText:instrument.special
    };
    if (record.level >= 3 || state.masteryNodes.indexOf(instrument.id + '-passive') >= 0) profile.damage += 1;
    if (record.level >= 5 || state.masteryNodes.indexOf(instrument.id + '-combo') >= 0) profile.cooldown *= 0.88;
    if (instrument.id === 'guitar') profile.crit += 0.12;
    if (instrument.id === 'bass') profile.knockback = 34;
    if (instrument.id === 'synth') profile.pulseDamage = 1;
    if (instrument.id === 'drums') profile.knockback = 25;
    if (instrument.id === 'violin') profile.crit += 0.18;
    if (activeResonance('nature')) {
      if (instrument.id === 'violin') profile.specialText = 'Forest spirits heal and regenerate';
      if (instrument.id === 'microphone') profile.pulseDamage += 1;
    }
    if (activeResonance('heavy') && instrument.id === 'bass') {
      profile.damage += 1;
      profile.knockback += 20;
      profile.specialText = 'Larger shockwaves and armour break';
    }
    if (activeResonance('psychedelic') && instrument.id === 'synth') {
      profile.pulseDamage += 2;
      profile.specialText = 'Colour explosions chain between targets';
    }
    if (activeResonance('conductor') && instrument.id === 'guitar') {
      profile.cooldown *= 0.78;
      profile.crit += 0.15;
      profile.specialText = 'Extended combo window and faster critical riffs';
    }
    return profile;
  }

  function instrumentSynergyText(instrument) {
    var profile = instrumentProfile(instrument.id);
    var resonance = RESONANCE_BUILDS.find(function (entry) { return entry.id === state.activeResonance; });
    return (resonance ? resonance.name + ': ' : 'No resonance: ') + profile.specialText;
  }

  function performInstrumentUltimate() {
    if (instrumentUltimateCharge < 100) return false;
    var instrument = equippedInstrument();
    equipmentVisualRuntime.specialTimer = 0.82;
    instrumentUltimateCharge = 0;
    var radius = instrument.id === 'synth' ? 340 : instrument.id === 'violin' ? 300 : 260;
    var damage = instrument.id === 'bass' ? 7 : instrument.id === 'microphone' ? 3 : 5;
    enemies.forEach(function (enemy) {
      if (enemy.dead || distance(player,enemy) > radius) return;
      enemy.shielded = false;
      enemy.stun = Math.max(enemy.stun, 3.5);
      hitEnemy(enemy,damage,player.x,player.y);
    });
    if (boss && !boss.dead && distance(player,boss) < radius + boss.r) hitBoss(Math.max(3,damage));
    if (instrument.id === 'microphone' || (instrument.id === 'violin' && activeResonance('nature'))) healPlayer(3);
    activeBuffs.odinHowlTimer = Math.max(activeBuffs.odinHowlTimer, 8);
    shake = 12;
    for (var i=0;i<48;i++) spawnParticle(player.x,player.y,instrument.color,170,5);
    showToast(instrument.ultimate.toUpperCase(),'Ultimate released at full mastery charge.',instrument.color,3.2);
    audioCall('sfx','boss');
    return true;
  }

  var SHOP_ITEMS = [
    {id:'heart-tonic',name:'Field Tonic',price:4,desc:'Restore two hearts immediately.',repeat:true,consumable:true},
    {id:'coin-charm',name:'Lucky Leaf',price:12,desc:'Enemies drop an extra Beatcoin and more Heartblooms.'},
    {id:'pulse-coil',name:'Pulse Coil',price:10,desc:'Increase combat and puzzle pulse range.'},
    {id:'stamina-salve',name:'Stamina Salve',price:3,desc:'Move 30% faster for 20 seconds.',repeat:true,consumable:true},
    {id:'thorn-ward',name:'Thorn Ward',price:5,desc:'Reduce all damage by half for 15 seconds.',repeat:true,consumable:true},
    {id:'melody-map',name:'Melody Map',price:4,desc:'Reveal enemies and objectives on the map for 30 seconds.',repeat:true,consumable:true},
    {id:'grove-blessing',name:'Grove Blessing',price:8,desc:'Fully restore all hearts.',repeat:true,consumable:true},
    {id:'echo-amplifier',name:'Echo Amplifier',price:6,desc:'Next Echo Pulse is enormous and deals heavy damage.',repeat:true,consumable:true},
    {id:'weed-whisperer',name:'Weed Whisperer',price:3,desc:'Automatically collect nearby Glowweed for 15 seconds.',repeat:true,consumable:true},
    {id:'revival-seed',name:'Revival Seed',price:15,desc:'Automatically revive once with full health.',repeat:false,consumable:true},
    {id:'pruner-polish',name:'Pruner Polish',price:25,desc:'Permanently sharpen your strikes. +1 base damage.'},
    {id:'moss-boots',name:'Moss Boots',price:20,desc:'Permanently increase movement speed by 12%.'},
    {id:'crystal-lens',name:'Crystal Lens',price:14,desc:'Permanently reveal enemy health bars in combat.'},
    {id:'tempo-ring',name:'Tempo Ring',price:22,desc:'Permanently reduce attack and pulse cooldowns by 15%.'},
    {id:'collector-compass',name:'Collector Compass',price:18,desc:'Permanently reveal unclaimed collectibles on the map.'},
    {id:'ironbark-plate',name:'Ironbark Plate',price:28,desc:'Permanently soften every third point of incoming damage.'},
    {id:'fortune-charm',name:'Fortune Charm',price:24,desc:'Collectibles and defeated enemies award bonus Beatcoins.'},
    {id:'heartbloom-pouch',name:'Heartbloom Pouch',price:16,desc:'Heartblooms restore one additional heart.'}
  ];
  var SKILL_ITEMS = [
    {id:'strong-strike',name:'Wide Arc',desc:'Strikes hit a wider area and deal extra damage.'},
    {id:'fleet-foot',name:'Quickstep',desc:'Shorter dodge cooldown.'},
    {id:'wide-pulse',name:'Resonant Reach',desc:'Pulse reaches farther in combat and puzzles.'},
    {id:'grove-vitality',name:'Second Wind',desc:'Gain one max heart; critical Heartblooms restore two.'},
    {id:'odin-bond',name:'Odin Guard',desc:'Odin bites enemies, stuns farther, and recovers faster.'},
    {id:'odin-pounce',name:'Odin Pounce',desc:'Odin leaps at distant enemies for heavy damage and a long stun.'},
    {id:'odin-howl',name:'Howl of Courage',desc:'Odin periodically howls in crowded fights, boosting your speed and damage.'},
    {id:'odin-fetch',name:'Keen Nose',desc:'Fetch command lets Odin collect nearby Glowweed and Heartblooms.'},
    {id:'odin-guardian',name:'Guardian Leap',desc:'Odin can block a hit when your health is critical.'},
    {id:'odin-spirit',name:'Spirit Wolf',desc:'Odin enters a spectral frenzy after a pounce, moving faster and dealing more damage.'},
    {id:'lucky-leaf',name:'Lucky Leaf',desc:'Earn more Beatcoins and guarantee health drops.'},
    {id:'echo-chamber',name:'Echo Chamber',desc:'Echo Pulse now damages enemies and breaks shields.'},
    {id:'moss-treader',name:'Moss Treader',desc:'Move 12% faster at all times.'},
    {id:'bloom-sense',name:'Bloom Sense',desc:'Glowweed calls to you from much farther away.'},
    {id:'shield-harmony',name:'Shield Harmony',desc:'Gain brief invulnerability after every dodge.'},
    {id:'resonance-cascade',name:'Resonance Cascade',desc:'Echo Pulse chains damage to nearby enemies.'},
    {id:'verdant-vigor',name:'Verdant Vigor',desc:'Slowly recover health when standing still.'},
    {id:'rhythm-master',name:'Rhythm Master',desc:'Attack faster and charge cleave more quickly.'},
    {id:'spectral-sight',name:'Spectral Sight',desc:'Always see enemy health bars and weak points.'},
    {id:'encore',name:'Encore',desc:'Once per stage visit, survive a fatal blow with three hearts.'},
    {id:'critical-rhythm',name:'Critical Rhythm',desc:'Every strike has a 20% chance to deal double damage.'},
    {id:'battle-focus',name:'Battle Focus',desc:'Deal +1 damage while at full health.'},
    {id:'echo-step',name:'Echo Step',desc:'Dashing releases a small damaging pulse around you.'},
    {id:'coin-magnet',name:'Beatcoin Magnet',desc:'Defeated enemies award one additional Beatcoin.'},
    {id:'relic-hunter',name:'Relic Hunter',desc:'Collectibles are visible on the map and grant +2 Beatcoins.'},
    {id:'pulse-mender',name:'Pulse Mender',desc:'Every fifth damaging Echo Pulse restores one heart.'}
  ];
  var SKILL_CATEGORIES = [
    {id:'all',name:'All Paths',color:'#e7f7df'},
    {id:'combat',name:'Combat',color:'#ff7892'},
    {id:'exploration',name:'Exploration',color:'#7df7a1'},
    {id:'music',name:'Music',color:'#ffc857'},
    {id:'resonance',name:'Resonance',color:'#d77cff'},
    {id:'companion',name:'Companion',color:'#62c7ff'},
    {id:'utility',name:'Utility',color:'#9de8ff'},
    {id:'survival',name:'Survival',color:'#7ce4d1'}
  ];
  var SKILL_META = {
    'strong-strike':['combat',[],1],'critical-rhythm':['combat',['strong-strike'],2],'battle-focus':['combat',['critical-rhythm'],3],
    'moss-treader':['exploration',[],1],'bloom-sense':['exploration',['moss-treader'],2],'relic-hunter':['exploration',['bloom-sense'],3],
    'rhythm-master':['music',[],1],'echo-chamber':['music',['rhythm-master'],2],'resonance-cascade':['music',['echo-chamber'],3],
    'wide-pulse':['resonance',[],1],'spectral-sight':['resonance',['wide-pulse'],2],'pulse-mender':['resonance',['spectral-sight'],3],
    'odin-bond':['companion',[],1],'odin-pounce':['companion',['odin-bond'],2],'odin-howl':['companion',['odin-pounce'],3],
    'odin-fetch':['companion',['odin-bond'],2],'odin-guardian':['companion',['odin-fetch'],3],'odin-spirit':['companion',['odin-howl','odin-guardian'],4],
    'fleet-foot':['utility',[],1],'lucky-leaf':['utility',['fleet-foot'],2],'coin-magnet':['utility',['lucky-leaf'],3],'echo-step':['utility',['fleet-foot'],2],
    'grove-vitality':['survival',[],1],'shield-harmony':['survival',['grove-vitality'],2],'verdant-vigor':['survival',['grove-vitality'],2],'encore':['survival',['shield-harmony','verdant-vigor'],4]
  };
  SKILL_ITEMS.forEach(function (item) {
    var meta = SKILL_META[item.id] || ['utility',[],1];
    item.category = meta[0];
    item.requires = meta[1];
    item.tier = meta[2];
    item.rarity = item.tier >= 4 ? 'legendary' : item.tier >= 3 ? 'rare' : item.tier >= 2 ? 'uncommon' : 'common';
  });
  function openShop() {
    if (!started || shopOpen || skillsOpen || statisticsOpen || mapOpen || inventoryOpen || composerOpen || instrumentsOpen || homeOpen || dialogue) return;
    releaseHeldInputs();
    shopReturnsToPause = paused;
    if (paused) setOverlayIsolation('pause', 'pauseScreen', false);
    shopOpen = true;
    setHidden(byId('shopScreen'), false);
    setOverlayIsolation('shop', 'shopScreen', true);
    renderShop();
    audioCall('pause', true);
    focusSoon('closeShopButton');
  }
  function closeShop() {
    if (!shopOpen) return;
    shopOpen = false;
    setOverlayIsolation('shop', 'shopScreen', false);
    setHidden(byId('shopScreen'), true);
    if (!paused) audioCall('pause', false);
    if (shopReturnsToPause && paused) setOverlayIsolation('pause', 'pauseScreen', true);
    var returnToPause = shopReturnsToPause && paused;
    shopReturnsToPause = false;
    focusSoon(returnToPause ? 'resumeButton' : 'gameCanvas');
  }
  function shopItemOwned(item) {
    if (item.repeat) return false;
    if (state.purchases.indexOf(item.id) >= 0) return true;
    if (item.id === 'coin-charm') return state.skills.indexOf('lucky-leaf') >= 0;
    if (item.id === 'pulse-coil') return state.skills.indexOf('wide-pulse') >= 0;
    return false;
  }

  function canBuyItem(item) {
    if (state.beatcoins < item.price) return false;
    if (!item.repeat && shopItemOwned(item)) return false;
    if (item.id === 'heart-tonic' && player.health >= player.maxHealth) return false;
    if (item.id === 'grove-blessing' && player.health >= player.maxHealth) return false;
    if (item.id === 'revival-seed' && activeBuffs.revivalReady) return false;
    return true;
  }

  function applyShopItem(item) {
    switch (item.id) {
      case 'heart-tonic': healPlayer(2); break;
      case 'grove-blessing': healPlayer(999); break;
      case 'stamina-salve': activeBuffs.speedTimer = 20; showToast('STAMINA SALVE', 'Speed boosted for 20 seconds!', '#62c7ff', 2.5); break;
      case 'thorn-ward': activeBuffs.defenseTimer = 15; showToast('THORN WARD', 'Damage reduced for 15 seconds!', '#7df7a1', 2.5); break;
      case 'melody-map': activeBuffs.mapTimer = 30; showToast('MELODY MAP', 'Enemies and objectives revealed!', '#ffc857', 2.5); break;
      case 'echo-amplifier': activeBuffs.massivePulse = true; showToast('ECHO AMPLIFIER', 'Next pulse will be devastating!', '#d77cff', 2.5); break;
      case 'weed-whisperer': activeBuffs.autoCollectTimer = 15; showToast('WEED WHISPERER', 'Auto-collecting nearby Glowweed!', '#7df7a1', 2.5); break;
      case 'boss-bane': activeBuffs.bossBane = true; showToast('BOSS BANE', 'Next boss takes +50% damage!', '#ff7892', 2.5); break;
      case 'revival-seed': activeBuffs.revivalReady = true; state.purchases.push(item.id); showToast('REVIVAL SEED', 'You will auto-revive once!', '#ff7892', 2.5); break;
      case 'coin-charm':
        if (state.skills.indexOf('lucky-leaf') < 0) state.skills.push('lucky-leaf');
        state.purchases.push(item.id);
        break;
      case 'pulse-coil':
        if (state.skills.indexOf('wide-pulse') < 0) state.skills.push('wide-pulse');
        state.purchases.push(item.id);
        break;
      case 'pruner-polish':
        state.purchases.push(item.id);
        showToast('PRUNER POLISH', 'Permanent damage increased!', '#ffc857', 3);
        break;
      case 'moss-boots':
        state.purchases.push(item.id);
        showToast('MOSS BOOTS', 'Permanent speed increased!', '#62c7ff', 3);
        break;
      case 'crystal-lens':
        state.purchases.push(item.id);
        showToast('CRYSTAL LENS', 'Enemy health bars revealed!', '#9de8ff', 3);
        break;
      case 'tempo-ring': case 'collector-compass': case 'ironbark-plate': case 'fortune-charm': case 'heartbloom-pouch':
        state.purchases.push(item.id);
        showToast(item.name.toUpperCase(), 'Permanent upgrade equipped.', '#f6e36d', 3);
        break;
      default:
        if (!item.repeat) state.purchases.push(item.id);
    }
  }
  function renderShop() {
    var grid = byId('shopGrid');
    if (!grid) return;
    byId('shopWallet').textContent = state.beatcoins + ' Beatcoins';
    grid.innerHTML = '';
    SHOP_ITEMS.forEach(function (item, itemIndex) {
      var owned = shopItemOwned(item);
      var unavailable = !canBuyItem(item);
      var card = document.createElement('article');
      card.className = 'shop-item' + (owned ? ' owned' : '');
      var buttonLabel;
      if (owned) buttonLabel = 'Owned';
      else if (item.id === 'heart-tonic' && player.health >= player.maxHealth) buttonLabel = 'Health full';
      else if (item.id === 'grove-blessing' && player.health >= player.maxHealth) buttonLabel = 'Health full';
      else if (item.id === 'revival-seed' && activeBuffs.revivalReady) buttonLabel = 'Ready';
      else buttonLabel = item.price + ' coins';

      card.innerHTML = '<div class="shop-item-heading"><span class="shop-item-icon" aria-hidden="true" style="' +
        shopItemCellStyle(itemIndex) + '"></span><h3>' + item.name + '</h3></div><p>' + item.desc +
        '</p><button class="game-button button-primary" ' + (unavailable ? 'disabled' : '') + '>' +
        buttonLabel + '</button>';
      card.querySelector('button').onclick = function () {
        if (!canBuyItem(item)) {
          audioCall('sfx', 'error');
          renderShop();
          return;
        }
        state.beatcoins -= item.price;
        state.statistics.beatcoinsSpent += item.price;
        state.statistics.shopPurchases++;
        gainProfessionXp('trading',Math.max(2,Math.ceil(item.price / 3)),'Trading with Brad');
        applyShopItem(item);
        audioCall('sfx', 'unlock');
        saveGame(true);
        updateHUD(true);
        renderShop();
      };
      grid.appendChild(card);
    });
  }
  function openSkills() {
    if (!started || skillsOpen || statisticsOpen || shopOpen || mapOpen || inventoryOpen || composerOpen || instrumentsOpen || homeOpen || dialogue) return;
    releaseHeldInputs();
    skillsReturnsToPause = paused;
    if (paused) setOverlayIsolation('pause', 'pauseScreen', false);
    skillsOpen = true;
    setHidden(byId('skillsScreen'), false);
    setOverlayIsolation('skills', 'skillsScreen', true);
    renderSkills();
    audioCall('pause', true);
    focusSoon('closeSkillsButton');
  }
  function closeSkills() {
    if (!skillsOpen) return;
    skillsOpen = false;
    setOverlayIsolation('skills', 'skillsScreen', false);
    setHidden(byId('skillsScreen'), true);
    if (!paused) audioCall('pause', false);
    if (skillsReturnsToPause && paused) setOverlayIsolation('pause', 'pauseScreen', true);
    var returnToPause = skillsReturnsToPause && paused;
    skillsReturnsToPause = false;
    focusSoon(returnToPause ? 'pauseSkillsButton' : 'gameCanvas');
  }
  function renderSkills() {
    var grid = byId('skillsGrid');
    if (!grid) return;
    byId('skillPoints').textContent = state.skillPoints + (state.skillPoints === 1 ? ' skill point' : ' skill points');
    var filters = byId('skillFilters');
    if (filters) {
      filters.innerHTML = '';
      SKILL_CATEGORIES.forEach(function (category) {
        var filter = document.createElement('button');
        filter.type = 'button';
        filter.className = 'skill-filter';
        filter.setAttribute('role','tab');
        filter.setAttribute('aria-selected',category.id === skillFilter ? 'true' : 'false');
        filter.textContent = category.name;
        filter.onclick = function () { skillFilter = category.id; renderSkills(); };
        filters.appendChild(filter);
      });
    }
    var zoomValue = byId('skillZoomValue');
    if (zoomValue) zoomValue.textContent = Math.round(skillZoom*100) + '%';
    grid.style.setProperty('--skill-zoom',skillZoom);
    grid.style.setProperty('--pan-x',skillPan.x + 'px');
    grid.style.setProperty('--pan-y',skillPan.y + 'px');
    grid.innerHTML = '';
    renderResonances();
    SKILL_ITEMS.filter(function (item) { return skillFilter === 'all' || item.category === skillFilter; }).forEach(function (item) {
      var owned = state.skills.indexOf(item.id) >= 0;
      var prerequisitesMet = item.requires.every(function (id) { return state.skills.indexOf(id) >= 0; });
      var category = SKILL_CATEGORIES.find(function (entry) { return entry.id === item.category; }) || SKILL_CATEGORIES[0];
      var card = document.createElement('article');
      card.className = 'skill-node' + (owned ? ' owned' : prerequisitesMet && state.skillPoints > 0 ? ' available' : ' locked');
      card.style.setProperty('--node-color',category.color);
      var prerequisiteNames = item.requires.map(function (id) {
        var required = SKILL_ITEMS.find(function (skill) { return skill.id === id; });
        return required ? required.name : id;
      });
      card.innerHTML = '<div class="node-meta"><span>' + category.name + '</span><span>' + item.rarity + '</span></div><h3>' +
        item.name + '</h3><p>' + item.desc + '</p><small>' +
        (prerequisiteNames.length ? 'Requires: ' + prerequisiteNames.join(' + ') : 'Root node') +
        '</small><button class="game-button button-primary" ' + (owned || state.skillPoints < 1 || !prerequisitesMet ? 'disabled' : '') + '>' +
        (owned ? 'Learned' : !prerequisitesMet ? 'Path locked' : 'Learn - 1 point') + '</button>';
      card.onmouseenter = card.onfocusin = function () { renderSkillPreview(item,owned,prerequisitesMet,category); };
      card.onclick = function (event) {
        if (event.target && event.target.tagName === 'BUTTON') return;
        renderSkillPreview(item,owned,prerequisitesMet,category);
      };
      card.querySelector('button').onclick = function () {
        if (state.skills.indexOf(item.id) >= 0 || state.skillPoints < 1 || !prerequisitesMet) return;
        state.skillPoints--;
        state.skills.push(item.id);
        if (item.id === 'grove-vitality') {
          player.maxHealth++;
          player.health = player.maxHealth;
        }
        audioCall('sfx', 'unlock');
        for (var particleIndex=0;particleIndex<18;particleIndex++) {
          window.setTimeout(function () { canvasDirty = true; },particleIndex*18);
        }
        saveGame(true);
        renderSkills();
        updateHUD(true);
      };
      grid.appendChild(card);
    });
    var zoomOut = byId('skillZoomOut');
    var zoomIn = byId('skillZoomIn');
    if (zoomOut) zoomOut.onclick = function () { skillZoom = clamp(skillZoom-0.1,0.7,1.4); renderSkills(); };
    if (zoomIn) zoomIn.onclick = function () { skillZoom = clamp(skillZoom+0.1,0.7,1.4); renderSkills(); };
  }

  function renderSkillPreview(item,owned,prerequisitesMet,category) {
    var preview = byId('skillPreview');
    if (!preview) return;
    var prerequisites = item.requires.map(function (id) {
      var required = SKILL_ITEMS.find(function (skill) { return skill.id === id; });
      return (state.skills.indexOf(id) >= 0 ? '✓ ' : '◇ ') + (required ? required.name : id);
    });
    preview.style.setProperty('--preview-color',category.color);
    preview.innerHTML = '<p class="panel-kicker">NODE PREVIEW · TIER ' + item.tier + '</p><h3>' + item.name +
      '</h3><p class="preview-rarity">' + item.rarity + ' ' + category.name + '</p><p>' + item.desc + '</p><p>' +
      (prerequisites.length ? prerequisites.join('<br>') : 'No prerequisite — begin this branch.') +
      '</p><strong>' + (owned ? 'Learned' : prerequisitesMet ? 'Available to learn' : 'Complete the highlighted path first') + '</strong>';
  }

  var instrumentSelection = 'guitar';
  function openInstruments() {
    if (!started || instrumentsOpen || statisticsOpen || shopOpen || mapOpen || inventoryOpen || composerOpen || skillsOpen || homeOpen || dialogue) return;
    releaseHeldInputs();
    instrumentsReturnsToPause = paused;
    if (paused) setOverlayIsolation('pause','pauseScreen',false);
    instrumentsOpen = true;
    setHidden(byId('instrumentsScreen'),false);
    setOverlayIsolation('instruments','instrumentsScreen',true);
    renderInstruments();
    audioCall('pause',true);
    focusSoon('closeInstrumentsButton');
  }

  function closeInstruments() {
    if (!instrumentsOpen) return;
    instrumentsOpen = false;
    setOverlayIsolation('instruments','instrumentsScreen',false);
    setHidden(byId('instrumentsScreen'),true);
    if (!paused) audioCall('pause',false);
    if (instrumentsReturnsToPause && paused) setOverlayIsolation('pause','pauseScreen',true);
    var returnToPause = instrumentsReturnsToPause && paused;
    instrumentsReturnsToPause = false;
    focusSoon(returnToPause ? 'pauseInstrumentsButton' : 'gameCanvas');
  }

  function masteryNodeDefinitions(instrument) {
    return [
      {id:instrument.id+'-combo',level:2,name:'Alternate Combo',desc:'Adds a faster third phrase.'},
      {id:instrument.id+'-passive',level:4,name:'Stage Presence',desc:'Permanent damage and utility bonus.'},
      {id:instrument.id+'-special',level:7,name:instrument.special,desc:'Amplifies the Pulse-linked special.'},
      {id:instrument.id+'-legendary',level:10,name:instrument.ultimate,desc:'Legendary cosmetic and ultimate form.'}
    ];
  }

  function renderInstrumentDetail(instrument) {
    instrumentSelection = instrument.id;
    var detail = byId('instrumentDetail');
    if (!detail) return;
    var record = instrumentMasteryRecord(instrument.id);
    var nodes = masteryNodeDefinitions(instrument);
    detail.style.setProperty('--instrument-color',instrument.color);
    detail.innerHTML = '<div><p class="panel-kicker">MASTERY TREE · LEVEL ' + record.level + '</p><h3>' + instrument.name +
      '</h3><p>' + instrument.role + '</p><p><strong>Basic:</strong> ' + instrument.attack + '<br><strong>Special:</strong> ' +
      instrument.special + '<br><strong>Ultimate:</strong> ' + instrument.ultimate + '</p><p>' + instrumentSynergyText(instrument) +
      '</p></div><div class="mastery-nodes"></div>';
    var nodeGrid = detail.querySelector('.mastery-nodes');
    nodes.forEach(function (node) {
      var learned = state.masteryNodes.indexOf(node.id) >= 0;
      var ready = record.level >= node.level;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mastery-node' + (learned ? ' learned' : ready ? ' ready' : '');
      button.disabled = learned || !ready;
      button.innerHTML = '<strong>LV ' + node.level + ' · ' + node.name + '</strong><br>' + node.desc;
      button.onclick = function () {
        if (!ready || learned) return;
        state.masteryNodes.push(node.id);
        audioCall('sfx','unlock');
        showToast(node.name.toUpperCase(),'Mastery node learned for ' + instrument.name + '.',instrument.color,3);
        saveGame(true);
        renderInstruments();
      };
      nodeGrid.appendChild(button);
    });
  }

  function renderInstruments() {
    applyInstrumentUnlocks();
    var grid = byId('instrumentGrid');
    if (!grid) return;
    var equipped = equippedInstrument();
    if (byId('equippedInstrumentLabel')) byId('equippedInstrumentLabel').textContent = equipped.name + ' equipped · ' + instrumentSynergyText(equipped);
    if (byId('ultimateChargeLabel')) byId('ultimateChargeLabel').textContent = 'Ultimate ' + Math.floor(instrumentUltimateCharge) + '%';
    grid.innerHTML = '';
    INSTRUMENTS.forEach(function (instrument) {
      var unlocked = state.unlockedInstruments.indexOf(instrument.id) >= 0;
      var selected = state.equippedInstrument === instrument.id;
      var record = instrumentMasteryRecord(instrument.id);
      var threshold = record.level >= 10 ? 1 : masteryThreshold(record.level);
      var legendary = state.masteryNodes.indexOf(instrument.id+'-legendary') >= 0;
      var card = document.createElement('article');
      card.className = 'instrument-card' + (selected ? ' equipped' : '') + (!unlocked ? ' locked' : '');
      card.style.setProperty('--instrument-color',instrument.color);
      card.innerHTML = '<span class="instrument-art" aria-hidden="true" style="' + instrumentCellStyle(instrument.index,legendary) +
        '"></span><h3>' + (unlocked ? instrument.name : 'Undiscovered') + '</h3><p>' +
        (unlocked ? instrument.role : 'Follow the main story and musicians of each region.') +
        '</p><div class="mastery-track"><span style="width:' + (record.level >= 10 ? 100 : clamp(record.xp/threshold*100,0,100)) +
        '%"></span></div><small>MASTERY ' + record.level + ' / 10</small><button class="game-button ' +
        (selected ? 'button-primary' : 'button-secondary') + '" ' + (!unlocked ? 'disabled' : '') + '>' +
        (selected ? 'Equipped' : unlocked ? 'Equip' : 'Locked') + '</button>';
      card.onclick = function (event) {
        if (!unlocked) return;
        renderInstrumentDetail(instrument);
        if (event.target && event.target.tagName !== 'BUTTON') return;
        if (!requestInstrumentSwitch(instrument.id)) return;
        instrumentSelection = instrument.id;
        updateHUD(true);
        renderInstruments();
      };
      grid.appendChild(card);
    });
    renderInstrumentDetail(instrumentById(instrumentSelection));
  }

  var HOME_DECORATIONS = {
    'woven-rug':'Mosswoven Rug','nullspeaker-trophy':'Nullspeaker Cabinet','root-lantern':'Rootsong Lantern',
    'skyglass-mobile':'Skyglass Mobile','moonwake-aquarium':'Moonwake Aquarium','festival-lights':'Luma’s Festival Lights','vinyl-wall':'Lost Vinyl Wall','golden-bloom':'Jimbo’s Golden Bloom'
  };
  var JUKEBOX_TRACKS = ['Mossvale Overture','Rootsong Underfoot','Skyglass Weather','Moonwake Nocturne','Final Concert'];

  function refreshHomeProgress() {
    var bossesCleared = Object.keys(BOSS_DEFS).filter(function (stage) { return bossDefeatedForStage(Number(stage)); }).length;
    state.home.level = clamp(1 + bossesCleared,1,4);
    [
      ['nullspeaker-trophy',bossDefeatedForStage(1)],['root-lantern',bossDefeatedForStage(2)],
      ['skyglass-mobile',bossDefeatedForStage(3)],['moonwake-aquarium',bossDefeatedForStage(4)],
      ['vinyl-wall',state.collectibles.length >= 12],['festival-lights',state.completedQuests.indexOf('luma-festival') >= 0]
    ].forEach(function (entry) {
      if (entry[1] && state.home.decorations.indexOf(entry[0]) < 0) state.home.decorations.push(entry[0]);
    });
  }

  function homeVisitorText() {
    var hour = Math.floor((state.playSeconds / 60 * 3 + 8) % 24);
    if (hour < 11) return 'Mara is sharing breakfast while Odin patrols the garden.';
    if (hour < 17) return state.metPip ? 'Pip is rehearsing in the Music Room.' : 'The workshop windows are open to the grove.';
    if (hour < 21) return state.metLuma ? 'Luma has arrived with lanterns for an evening set.' : 'Fireflies gather around the porch.';
    return state.metNix ? 'Nix is cataloguing dream-records by moonlight.' : 'The house settles into a quiet nocturne.';
  }

  function openHome() {
    if (!started || homeOpen || instrumentsOpen || statisticsOpen || shopOpen || mapOpen || inventoryOpen || composerOpen || skillsOpen || dialogue) return;
    if (!state.home.unlocked) {
      showToast('HOME NOT YET RESTORED','Help Mara and silence the Nullspeaker to reclaim the Afterglow House.','#ffc857',3.2);
      return;
    }
    releaseHeldInputs();
    homeReturnsToPause = paused;
    if (paused) setOverlayIsolation('pause','pauseScreen',false);
    homeOpen = true;
    setHidden(byId('homeScreen'),false);
    setOverlayIsolation('home','homeScreen',true);
    refreshHomeProgress();
    renderHome();
    audioCall('pause',true);
    focusSoon('closeHomeButton');
  }

  function closeHome() {
    if (!homeOpen) return;
    homeOpen = false;
    setOverlayIsolation('home','homeScreen',false);
    setHidden(byId('homeScreen'),true);
    saveGame(true);
    if (!paused) audioCall('pause',false);
    if (homeReturnsToPause && paused) setOverlayIsolation('pause','pauseScreen',true);
    var returnToPause = homeReturnsToPause && paused;
    homeReturnsToPause = false;
    focusSoon(returnToPause ? 'pauseHomeButton' : 'gameCanvas');
  }

  function travelHome() {
    if (mapOpen) closeMap();
    window.requestAnimationFrame(openHome);
  }

  function homeAction(id) {
    if (id === 'trophies') {
      closeHome();
      window.requestAnimationFrame(openStatistics);
      return;
    }
    if (id === 'music') {
      var current = JUKEBOX_TRACKS.indexOf(state.home.jukeboxTrack);
      state.home.jukeboxTrack = JUKEBOX_TRACKS[(current+1)%JUKEBOX_TRACKS.length];
      audioCall('setAdaptiveState',{track:state.home.jukeboxTrack,scene:'home',intensity:0});
      showToast('NOW PLAYING',state.home.jukeboxTrack,'#d77cff',2.8);
    } else if (id === 'workshop') {
      var cost = state.home.workshopLevel * 10;
      if (state.home.workshopLevel >= 4) {
        gainInstrumentMastery(10);
        showToast('INSTRUMENT MODDED','The equipped instrument gained 10 mastery XP.','#ffc857',2.8);
      } else if (state.beatcoins >= cost) {
        state.beatcoins -= cost;
        state.home.workshopLevel++;
        showToast('WORKSHOP UPGRADED','New charm and instrument modification recipes unlocked.','#ffc857',3);
      } else {
        showToast('MATERIALS NEEDED',cost + ' Beatcoins are required for the next workbench.','#ff7892',2.6);
      }
    } else if (id === 'greenhouse') {
      var plantedAge = state.playSeconds - state.home.greenhousePlantedAt;
      if (!state.home.greenhouseCrop) {
        state.home.greenhouseCrop = state.chapter >= 4 ? 'moon-orchid' : state.weeds.length >= 14 ? 'heartbloom' : 'glowweed';
        state.home.greenhousePlantedAt = state.playSeconds;
        gainProfessionXp('gardening',2,'Planting the greenhouse');
        showToast('GREENHOUSE PLANTED',state.home.greenhouseCrop + ' will grow while you adventure.','#7df7a1',2.8);
      } else if (plantedAge >= 90) {
        if (state.home.greenhouseCrop === 'heartbloom') state.heartblooms = Math.min(HEARTBLOOM_CAPACITY,state.heartblooms+2);
        else state.beatcoins += state.home.greenhouseCrop === 'moon-orchid' ? 12 : 5;
        state.home.greenhouseHarvests++;
        gainProfessionXp('gardening',14,'Harvesting the greenhouse');
        addCraftingMaterial(state.chapter >= 3 ? 'sporeSilk' : 'heartwood',2);
        state.home.greenhouseCrop = '';
        state.home.greenhousePlantedAt = 0;
        showToast('GREENHOUSE HARVEST','The adventure kept growing at home.','#7df7a1',3);
      } else {
        showToast('STILL GROWING',Math.ceil(90-plantedAge) + ' adventure seconds until harvest.','#7df7a1',2.4);
      }
    } else if (id === 'odin') {
      var sinceCare = state.playSeconds - state.home.odinFedAt;
      if (sinceCare < 15) {
        odin.activity = 'petting_reaction';
        odin.activityTimer = 1.6;
        setAnimationState(odin, 'petting_reaction');
        showToast('ODIN IS CONTENT','Train or feed him again after the next outing.','#62c7ff',2.4);
      } else {
        var odinWasFed = state.heartblooms > 0;
        var friendshipGain = state.heartblooms > 0 ? 8 : 4;
        if (state.heartblooms > 0) state.heartblooms--;
        odin.activity = odinWasFed ? 'eat' : 'happy';
        odin.activityTimer = 1.8;
        setAnimationState(odin, odin.activity);
        state.home.odinFriendship = Math.min(100,state.home.odinFriendship+friendshipGain);
        state.home.odinFedAt = state.playSeconds;
        if (state.home.odinFriendship >= 25 && state.skills.indexOf('odin-bond') < 0) state.skills.push('odin-bond');
        showToast('ODIN FRIENDSHIP +' + friendshipGain,
          state.home.odinFriendship >= 75 ? 'Odin’s spectral bandana is unlocked.' : 'Petting, feeding and training strengthen his abilities.','#62c7ff',3);
      }
    } else if (id === 'decorate') {
      if (state.home.decorations.length > 1) {
        var active = state.home.decorations.indexOf(state.home.activeDecoration);
        state.home.activeDecoration = state.home.decorations[(active+1)%state.home.decorations.length];
      }
    }
    refreshHomeProgress();
    saveGame(true);
    updateHUD(true);
    renderHome();
  }

  function renderHome() {
    refreshHomeProgress();
    var homeCard=document.querySelector('#homeScreen .home-card');
    var homeAccents={'woven-rug':'#7df7a1','nullspeaker-trophy':'#ff7892','root-lantern':'#ff9d57','skyglass-mobile':'#9de8ff','moonwake-aquarium':'#86e8ff','festival-lights':'#ff91d5','vinyl-wall':'#d77cff','golden-bloom':'#f6e36d'};
    if(homeCard)homeCard.style.setProperty('--home-accent',homeAccents[state.home.activeDecoration]||'#ffc857');
    var summary = byId('homeSummary');
    if (summary) summary.innerHTML = '<strong>HOUSE LEVEL ' + state.home.level + ' / 4</strong><span>' + homeVisitorText() + '</span>';
    var rooms = [
      {id:'trophies',icon:'♛',name:'Trophy Room',color:'#ffc857',text:state.stageBosses.length + ' boss trophies · ' + state.eliteDefeated.length + ' elite records · ' + state.miniBossesDefeated.length + ' mini bosses',action:'View Records'},
      {id:'music',icon:'♫',name:'Music Room',color:'#d77cff',text:state.unlockedInstruments.length + '/6 instruments · Now playing: ' + state.home.jukeboxTrack,action:'Next Record'},
      {id:'workshop',icon:'⚒',name:'Workshop',color:'#ff9d57',text:'Workbench level ' + state.home.workshopLevel + '/4 · Craft charms, upgrades and instrument modifications.',action:state.home.workshopLevel >= 4 ? 'Tune Instrument' : 'Upgrade Workbench'},
      {id:'greenhouse',icon:'✿',name:'Greenhouse',color:'#7df7a1',text:state.home.greenhouseCrop ? state.home.greenhouseCrop + ' growing · ' + Math.max(0,Math.ceil(90-(state.playSeconds-state.home.greenhousePlantedAt))) + 's remaining' : state.home.greenhouseHarvests + ' harvests · Plot ready',action:state.home.greenhouseCrop && state.playSeconds-state.home.greenhousePlantedAt>=90 ? 'Harvest' : state.home.greenhouseCrop ? 'Check Growth' : 'Plant Crop'},
      {id:'odin',icon:'◆',name:'Odin’s Corner',color:'#62c7ff',text:'Friendship ' + state.home.odinFriendship + '/100 · Bed, toys, feeding station and training mat.',action:state.heartblooms > 0 ? 'Feed & Train' : 'Pet & Train'},
      {id:'decorate',icon:'✦',name:'Decoration Studio',color:'#ff91d5',text:state.home.decorations.length + ' furnishings · Active: ' + (HOME_DECORATIONS[state.home.activeDecoration] || state.home.activeDecoration),action:'Rotate Display'}
    ];
    var roomGrid = byId('homeRooms');
    if (roomGrid) {
      roomGrid.innerHTML = '';
      rooms.forEach(function (room) {
        var card = document.createElement('article');
        card.className = 'home-room';
        card.style.setProperty('--room-color',room.color);
        card.innerHTML = '<span class="home-room-icon" aria-hidden="true">' + room.icon + '</span><h3>' + room.name +
          '</h3><p>' + room.text + '</p><button class="game-button button-secondary">' + room.action + '</button>';
        card.querySelector('button').onclick = function () { homeAction(room.id); };
        roomGrid.appendChild(card);
      });
    }
    var decoration = byId('homeDecoration');
    if (decoration) {
      decoration.innerHTML = '';
      state.home.decorations.forEach(function (id) {
        var option = document.createElement('option');
        option.value = id;
        option.textContent = HOME_DECORATIONS[id] || id;
        option.selected = id === state.home.activeDecoration;
        decoration.appendChild(option);
      });
      decoration.onchange = function () { state.home.activeDecoration = decoration.value; saveGame(true); renderHome(); };
    }
  }

  function savedStateForStatistics() {
    if (started) return state;
    var loaded = null;
    loaded = safeJson(readStorage(SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(LEGACY_SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(OLDER_SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(OLDEST_SAVE_KEY), null);
    if (!loaded) loaded = safeJson(readStorage(ANCIENT_SAVE_KEY), null);
    return sanitizeState(loaded);
  }

  function stateHasBoss(model, stage) {
    var id = bossDefForStage(stage).id;
    return model.stageBosses.indexOf(id) >= 0 || (stage === 1 && model.bossDefeated);
  }

  function completionPercent(model) {
    var bosses = Object.keys(BOSS_DEFS).filter(function (stage) { return stateHasBoss(model, Number(stage)); }).length;
    var mainQuests = EXPANSION_QUESTS.filter(function (quest) { return quest.category === 'main'; });
    var completedMainQuests = mainQuests.filter(function (quest) { return model.completedQuests.indexOf(quest.id) >= 0; }).length;
    var score =
      model.weeds.length / 30 * 12 +
      model.notes.length / 4 * 6 +
      model.skills.length / SKILL_ITEMS.length * 12 +
      model.chapterRelics.length / 3 * 8 +
      model.collectibles.length / Math.max(1,allLevelItems('collectibles').length) * 8 +
      bosses / 4 * 18 +
      (model.composed ? 4 : 0) +
      model.unlockedInstruments.length / INSTRUMENTS.length * 8 +
      completedMainQuests / Math.max(1,mainQuests.length) * 10 +
      model.eliteDefeated.length / Math.max(1,ELITE_VARIANTS.length) * 4 +
      model.miniBossesDefeated.length / MINIBOSS_DEFS.length * 4 +
      (model.home.unlocked ? model.home.level / 4 * 6 : 0);
    return clamp(Math.round(score), 0, 100);
  }

  function adventureRank(model, completion) {
    var bosses = Object.keys(BOSS_DEFS).filter(function (stage) { return stateHasBoss(model, Number(stage)); }).length;
    if (completion >= 100) return ['Mossvale Legend', 'Every stage knows your name and every boss knows your rhythm.'];
    if (bosses >= 3) return ['Moonwake Headliner', 'The final coast can already hear your encore coming.'];
    if (bosses >= 2) return ['Four-Road Virtuoso', 'Your melody carries beyond the grove and into the high paths.'];
    if (bosses >= 1) return ['Feedback Breaker', 'You turned the first wall of noise into an open road.'];
    if (model.totalKills >= 10 || model.notes.length >= 2) return ['Beat Scout', 'The paths are opening and your field kit is finding its rhythm.'];
    return ['Grove Rookie', 'The first beat is waiting.'];
  }

  function formatStatistic(value) {
    var number = Math.max(0, Math.round(Number(value) || 0));
    return number.toLocaleString ? number.toLocaleString() : String(number);
  }

  function renderStatistics() {
    var model = savedStateForStatistics();
    var stats = model.statistics || freshStatistics();
    var completion = completionPercent(model);
    var rank = adventureRank(model, completion);
    var defeatedBosses = Object.keys(BOSS_DEFS).filter(function (stage) { return stateHasBoss(model, Number(stage)); }).length;
    if (byId('statisticsRank')) byId('statisticsRank').textContent = rank[0];
    if (byId('statisticsSummary')) byId('statisticsSummary').textContent = rank[1];
    var completionElement = byId('statisticsCompletion');
    if (completionElement) {
      completionElement.textContent = completion + '%';
      if (completionElement.parentNode) completionElement.parentNode.setAttribute('aria-label', completion + ' percent adventure completion');
    }
    var groups = [
      ['Adventure', [
        ['Play time', formatTime(model.playSeconds)],
        ['Stage reached', model.stage + ' / 4'],
        ['Glowweed', model.weeds.length + ' / 30'],
        ['Lost notes', model.notes.length + ' / 4'],
        ['Skills learned', model.skills.length + ' / ' + SKILL_ITEMS.length],
        ['Distance travelled', formatStatistic(stats.distanceTravelled / 10) + ' m']
      ]],
      ['Combat', [
        ['Enemies defeated', formatStatistic(model.totalKills)],
        ['Bosses defeated', defeatedBosses + ' / 4'],
        ['Attacks swung', formatStatistic(stats.attacksSwung)],
        ['Highest rhythm combo', formatStatistic(stats.highestCombo || 0)],
        ['Perfect beat attacks', formatStatistic(stats.perfectBeats || 0)],
        ['Blocks performed', formatStatistic(stats.blocksPerformed || 0)],
        ['Perfect blocks', formatStatistic(stats.perfectBlocks || 0)],
        ['Damage blocked', formatStatistic(stats.damageBlocked || 0)],
        ['Counter attacks', formatStatistic(stats.counterAttacks || 0)],
        ['Echo Pulses', formatStatistic(stats.pulses)],
        ['Dodges', formatStatistic(stats.dashes)],
        ['Damage dealt', formatStatistic(stats.damageDealt)],
        ['Damage taken', formatStatistic(stats.damageTaken)],
        ['Times revived', formatStatistic(stats.deaths)]
      ]],
      ['Field & Trade', [
        ['Hearts recovered', formatStatistic(stats.heartsRecovered)],
        ['Medicine pouch', model.heartblooms + ' / ' + HEARTBLOOM_CAPACITY],
        ['Heartblooms collected', formatStatistic(stats.healingItemsCollected)],
        ['Heartblooms used', formatStatistic(stats.healingItemsUsed)],
        ['Beatcoins held', formatStatistic(model.beatcoins)],
        ['Beatcoins earned', formatStatistic(stats.beatcoinsEarned)],
        ['Beatcoins spent', formatStatistic(stats.beatcoinsSpent)],
        ['Shop purchases', formatStatistic(stats.shopPurchases)],
        ['Stage relics', model.chapterRelics.length + ' / 3'],
        ['World collectibles', model.collectibles.length + ' / ' + allLevelItems('collectibles').length],
        ['Collectible sets completed', model.collectibleRewards.length + ' / 4']
      ]],
      ['Living World', [
        ['Instruments unlocked', model.unlockedInstruments.length + ' / 6'],
        ['Instruments mastered', formatStatistic(stats.instrumentsMastered || 0) + ' / 6'],
        ['Elite enemies defeated', formatStatistic(stats.eliteEnemiesDefeated || 0)],
        ['Elite variants archived', model.eliteDefeated.length + ' / ' + ELITE_VARIANTS.length],
        ['Mini bosses defeated', model.miniBossesDefeated.length + ' / ' + MINIBOSS_DEFS.length],
        ['World events completed', formatStatistic(stats.worldEventsCompleted || 0)],
        ['Event types discovered', model.worldEventsSeen.length + ' / 16'],
        ['Expanded quests complete', model.completedQuests.length + ' / ' + EXPANSION_QUESTS.length],
        ['Secret paths found', model.discoveredSecrets.length + ' / 5'],
        ['Odin friendship', model.home.odinFriendship + ' / 100'],
        ['Home level', model.home.level + ' / 4']
      ]]
    ];
    var grid = byId('statisticsGrid');
    if (grid) {
      grid.innerHTML = '';
      groups.forEach(function (group) {
        var section = document.createElement('section');
        section.className = 'statistics-group';
        var heading = document.createElement('h3');
        heading.textContent = group[0];
        section.appendChild(heading);
        group[1].forEach(function (entry) {
          var row = document.createElement('div');
          row.className = 'stat-row';
          var label = document.createElement('span');
          label.textContent = entry[0];
          var value = document.createElement('strong');
          value.textContent = entry[1];
          row.appendChild(label);
          row.appendChild(value);
          section.appendChild(row);
        });
        grid.appendChild(section);
      });
    }
    var records = byId('bossRecordsList');
    if (records) {
      records.innerHTML = '';
      Object.keys(BOSS_DEFS).forEach(function (stage) {
        var def = BOSS_DEFS[stage];
        var defeated = stateHasBoss(model, Number(stage));
        var record = document.createElement('article');
        record.className = 'boss-record' + (defeated ? ' defeated' : '');
        var name = document.createElement('strong');
        name.textContent = def.shortName;
        var result = document.createElement('span');
        var best = stats.bestBossTimes && stats.bestBossTimes[def.id];
        result.textContent = defeated ? 'CLEARED' + (best ? ' · ' + formatTime(best) : '') : 'UNDISCOVERED';
        record.appendChild(name);
        record.appendChild(result);
        records.appendChild(record);
      });
    }
  }

  function openStatistics() {
    if (statisticsOpen || dialogue || composerOpen || inventoryOpen || shopOpen || skillsOpen || mapOpen || instrumentsOpen || homeOpen) return;
    releaseHeldInputs();
    statisticsReturnsToPause = started && paused;
    if (statisticsReturnsToPause) setOverlayIsolation('pause', 'pauseScreen', false);
    statisticsOpen = true;
    renderStatistics();
    setHidden(byId('statisticsScreen'), false);
    setOverlayIsolation('statistics', 'statisticsScreen', true);
    if (started) audioCall('pause', true);
    focusSoon('closeStatisticsButton');
  }

  function closeStatistics() {
    if (!statisticsOpen) return;
    statisticsOpen = false;
    setOverlayIsolation('statistics', 'statisticsScreen', false);
    setHidden(byId('statisticsScreen'), true);
    if (statisticsReturnsToPause && paused) setOverlayIsolation('pause', 'pauseScreen', true);
    if (started && !paused) audioCall('pause', false);
    var returnToPause = statisticsReturnsToPause && paused;
    statisticsReturnsToPause = false;
    focusSoon(returnToPause ? 'pauseStatisticsButton' : started ? 'gameCanvas' : 'statisticsButton');
  }

  function stageUnlockedForTravel(stage) {
    if (stage === 1) return true;
    if (stage === 2) return bossDefeatedForStage(1) || state.chapter >= 2;
    if (stage === 3) return bossDefeatedForStage(2) || state.chapter >= 3;
    return bossDefeatedForStage(3) || state.chapter >= 4;
  }

  function fastTravelTo(stage, visitShop) {
    if (!stageUnlockedForTravel(stage)) {
      audioCall('sfx', 'error');
      showToast('ROUTE UNKNOWN', 'Reach this world through its stage gate first.', '#8e9ba0', 2.8);
      return;
    }
    state.stagePositions[String(state.stage)] = {x:Math.round(player.x), y:Math.round(player.y)};
    state.stage = stage;
    state.chapter = Math.max(state.chapter, stage);
    var hubLocation=['mossvale-hub','rootsong-hub','skyglass-hub','moonwake-hub'][stage-1];
    if(state.discoveredLocations.indexOf(hubLocation)<0)state.discoveredLocations.push(hubLocation);
    document.body.classList.add('world-transition');
    activateLevel(stage);
    resetEnemies();
    var destination = currentLevel.hub || currentLevel.spawn;
    if (visitShop && stage === 1) {
      var brad = npcs.filter(function (npc) { return npc.id === 'brad'; })[0];
      if (brad) destination = {x:brad.x - 58, y:brad.y + 15};
    }
    player.x = clamp(destination.x, 40, WORLD.w - 40);
    player.y = clamp(destination.y, 40, WORLD.h - 40);
    camera.x = player.x; camera.y = player.y;
    state.x = player.x; state.y = player.y;
    attacks=[]; pulses=[]; particles=[]; projectiles=[]; hazards=[]; boss=null; bossPadLatch=null;
    resetFirstStageRuntime('fast-travel');
    spawnStageHeartblooms(stage);
    if (state.odinRecruited) {
      odin.x=player.x-40; odin.y=player.y+30; odin.target=null;
      resetOdinVisuals();
    }
    closeMap();
    audioCall('sfx', 'unlock');
    saveGame(true); updateHUD(true);
    if (visitShop && stage === 1) {
      window.setTimeout(function () { openShop(); }, 80);
    } else {
      showToast('FAST TRAVEL', 'Arrived at ' + STAGE_NAMES[stage] + '.', '#62c7ff', 2.5);
    }
    window.setTimeout(function(){document.body.classList.remove('world-transition');},520);
  }

  function renderFastTravel() {
    var el = byId('fastTravelList');
    if (!el) return;
    el.innerHTML = '';
    [1,2,3,4].forEach(function (stage) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'fast-travel-button' + (stage === state.stage ? ' current' : '');
      button.disabled = !stageUnlockedForTravel(stage) || stage === state.stage;
      button.innerHTML = '<strong>' + (stage === state.stage ? '● ' : '◇ ') + STAGE_NAMES[stage] + '</strong><small>' +
        (stage === state.stage ? 'Current world' : stageUnlockedForTravel(stage) ? 'Travel to hub' : 'Route locked') + '</small>';
      button.addEventListener('click', function () { fastTravelTo(stage, false); });
      el.appendChild(button);
    });
    var shop = byId('fastTravelShop');
    if (shop) shop.disabled = state.stage === 1 && shopOpen;
    var home = byId('fastTravelHome');
    if (home) home.disabled = !state.home.unlocked;
  }

  function openMap() {
    if (!started || dialogue || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || mapOpen) return;
    releaseHeldInputs();
    if (paused) setOverlayIsolation('pause', 'pauseScreen', false);
    mapOpen = true;
    if (byId('mapTitle')) byId('mapTitle').textContent = 'Road Atlas - ' + STAGE_NAMES[state.stage];
    if (byId('mapCanvas')) byId('mapCanvas').setAttribute('aria-label', 'Map of the connected stage roads. Current stage: ' + STAGE_NAMES[state.stage] + '.');
    setHidden(byId('mapScreen'), false);
    setOverlayIsolation('map', 'mapScreen', true);
    drawMap();
    renderQuestList();
    renderFastTravel();
    audioCall('pause', true);
    focusSoon('closeMapButton');
  }
  function closeMap() {
    mapOpen = false;
    setOverlayIsolation('map', 'mapScreen', false);
    setHidden(byId('mapScreen'), true);
    if (!paused) audioCall('pause', false);
    if (paused) setOverlayIsolation('pause', 'pauseScreen', true);
    focusSoon(paused ? 'pauseMapButton' : 'gameCanvas');
  }

  function renderQuestList() {
    var el=byId('questList');
    if(!el)return;
    Array.prototype.forEach.call(document.querySelectorAll('#questFilters [data-quest-filter]'),function(button){
      var active=button.getAttribute('data-quest-filter')===questLogFilter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',active?'true':'false');
      button.onclick=function(){questLogFilter=button.getAttribute('data-quest-filter');renderQuestList();};
    });
    var tasks=[];
    if(questLogFilter==='main'){
      tasks=[
        [state.metEems,'Meet EEMS and recover the scattered frequencies'],
        [hasAllNotes(),'Recover C · E · G · B'],
        [state.composed,'Compose an eight-beat gate-tone'],
        [bossDefeatedForStage(1),'Defeat the Nullspeaker'],
        [bossDefeatedForStage(2),'Defeat the Rootbound Colossus'],
        [bossDefeatedForStage(3),'Defeat the Prism Choir'],
        [bossDefeatedForStage(4),'Defeat the Tidebreaker']
      ];
      EXPANSION_QUESTS.filter(function(quest){return quest.category==='main'&&quest.unlock();}).forEach(function(quest){
        var complete=state.completedQuests.indexOf(quest.id)>=0;
        tasks.push([complete,quest.name+' · '+Math.min(quest.goal,quest.progress())+'/'+quest.goal,quest.objective,quest.reward]);
      });
    }else if(questLogFilter==='side'){
      EXPANSION_QUESTS.filter(function(quest){return quest.category==='side'&&quest.unlock();}).forEach(function(quest){
        var complete=state.completedQuests.indexOf(quest.id)>=0;
        tasks.push([complete,quest.name+' · '+Math.min(quest.goal,quest.progress())+'/'+quest.goal,quest.objective,quest.reward]);
      });
      if(!tasks.length)tasks.push([false,'Meet named travellers to unlock side quest chains.']);
    }else{
      tasks=[
        [state.eliteDefeated.length>=ELITE_VARIANTS.length,'Elite archive · '+state.eliteDefeated.length+'/'+ELITE_VARIANTS.length,
          ELITE_VARIANTS.map(function(elite){return elite.name;}).join(', ')+'.','Rare crafting drops'],
        [state.miniBossesDefeated.length>=MINIBOSS_DEFS.length,'Optional mini bosses · '+state.miniBossesDefeated.length+'/'+MINIBOSS_DEFS.length,
          'Search landmark arenas in every world.','Legendary modifications'],
        [state.worldEventsSeen.length>=10,'Living-world events · '+state.worldEventsSeen.length+'/16','Follow changing weather, music and encounter signals.','Beatcoins and discoveries'],
        [state.discoveredSecrets.length>=5,'Secret paths · '+state.discoveredSecrets.length+'/5','Hidden locations appear after clues, events and compass upgrades.','Dream Realm access'],
        [state.unlockedInstruments.length>=6,'Instrument collection · '+state.unlockedInstruments.length+'/6','Build relationships with every regional musician.','Instrumentalist achievement'],
        [state.home.odinFriendship>=100,'Odin friendship · '+state.home.odinFriendship+'/100','Pet, feed and train Odin at home.','Best Friend achievement']
      ];
    }
    el.innerHTML='';
    tasks.forEach(function(task){
      var li=document.createElement('li');
      li.className=task[0]?'complete':'';
      var title=document.createElement('strong');
      title.textContent=(task[0]?'✓ ':'◇ ')+task[1];
      li.appendChild(title);
      if(task[2]){var objective=document.createElement('small');objective.textContent=task[2];li.appendChild(objective);}
      if(task[3]){var reward=document.createElement('small');reward.textContent='Reward: '+task[3];li.appendChild(reward);}
      el.appendChild(li);
    });
  }

  function renderLegacyQuestList() {
    var el = byId('questList');
    if (!el) return;
    var tasks = [
      [collectedSetCount('mossvale')===collectibleSetCount('mossvale'), 'Lost Mixtapes · '+collectedSetCount('mossvale')+'/'+collectibleSetCount('mossvale')],
      [collectedSetCount('rootsong')===collectibleSetCount('rootsong'), 'Root Runes · '+collectedSetCount('rootsong')+'/'+collectibleSetCount('rootsong')],
      [collectedSetCount('skyglass')===collectibleSetCount('skyglass'), 'Prism Fragments · '+collectedSetCount('skyglass')+'/'+collectibleSetCount('skyglass')],
      [collectedSetCount('moonwake')===collectibleSetCount('moonwake'), 'Moon Pearls · '+collectedSetCount('moonwake')+'/'+collectibleSetCount('moonwake')],
      [state.metEems, 'Meet EEMS'],
      [state.pruner, 'Tune the Pruner Edge'],
      [state.pulse, 'Learn Resonance Pulse from Blu'],
      [hasAllNotes(), 'Recover C · E · G · B'],
      [state.composed, 'Compose an eight-beat gate-tone'],
      [bossDefeatedForStage(1), 'Defeat the Nullspeaker'],
      [state.odinRecruited, 'Recruit Odin at the Afterglow road'],
      [state.chapterRelics.indexOf('rootsong') >= 0, 'Rootsong drums · ' + countCollected(LEVELS[2].drums,state.drums) + '/3'],
      [bossDefeatedForStage(2), 'Defeat the Rootbound Colossus'],
      [state.chapterRelics.indexOf('skyglass') >= 0, 'Skyglass chimes · ' + countCollected(LEVELS[3].speakers,state.speakers) + '/3'],
      [bossDefeatedForStage(3), 'Defeat the Prism Choir'],
      [state.chapterRelics.indexOf('moonwake') >= 0, 'Moonwake shells · ' + countCollected(LEVELS[4].tokens,state.stageTokens) + '/3'],
      [bossDefeatedForStage(4), 'Defeat the Tidebreaker']
    ];
    el.innerHTML = '';
    tasks.forEach(function (t) {
      var li = document.createElement('li');
      li.className = t[0] ? 'complete' : '';
      li.textContent = (t[0] ? '✓ ' : '◇ ') + t[1];
      el.appendChild(li);
    });
  }

  var WORLD_MAP_REGIONS = {
    1:{x:68,y:178,w:200,h:150,labelX:92,labelY:309},
    2:{x:22,y:18,w:235,h:145,labelX:40,labelY:35},
    3:{x:300,y:18,w:224,h:150,labelX:355,labelY:35},
    4:{x:318,y:183,w:221,h:145,labelX:365,labelY:325}
  };

  function worldToAtlas(stage,x,y) {
    var region = WORLD_MAP_REGIONS[stage] || WORLD_MAP_REGIONS[1];
    var level = LEVELS[stage] || LEVELS[1];
    return {
      x:region.x + clamp(x/level.world.w,0,1)*region.w,
      y:region.y + clamp(y/level.world.h,0,1)*region.h
    };
  }

  function drawMapMarker(m,x,y,color,shape,label,pulse) {
    var size = pulse ? 5.5 + Math.sin(mapAnimationTime*4+x)*1.3 : 4.5;
    m.save();
    m.translate(x,y);
    m.shadowColor = color;
    m.shadowBlur = pulse ? 13 : 7;
    m.fillStyle = color;
    m.strokeStyle = '#061016';
    m.lineWidth = 1.5;
    m.beginPath();
    if (shape === 'diamond') {
      m.rotate(Math.PI/4);
      m.rect(-size,-size,size*2,size*2);
    } else if (shape === 'gate') {
      m.rect(-size,-size,size*2,size*2);
      m.fillStyle = 'rgba(5,15,24,.82)';
      m.strokeStyle = color;
      m.lineWidth = 2;
    } else if (shape === 'boss') {
      for (var point=0;point<8;point++) {
        var angle=point*Math.PI/4;
        var radius=point%2?size*.55:size*1.35;
        var px=Math.cos(angle)*radius,py=Math.sin(angle)*radius;
        if(point===0)m.moveTo(px,py);else m.lineTo(px,py);
      }
      m.closePath();
    } else {
      m.arc(0,0,size,0,Math.PI*2);
    }
    m.fill();
    m.stroke();
    m.shadowBlur = 0;
    if (label) {
      m.rotate(shape==='diamond'?-Math.PI/4:0);
      m.font = 'bold 8px monospace';
      m.textAlign = 'center';
      m.fillStyle = '#f1f7f4';
      m.strokeStyle = 'rgba(2,6,12,.92)';
      m.lineWidth = 3;
      m.strokeText(label,0,-size-5);
      m.fillText(label,0,-size-5);
    }
    m.restore();
  }

  function drawMap() {
    var map=byId('mapCanvas');
    if(!map)return;
    var m=map.getContext('2d'),mw=map.width,mh=map.height;
    mapAnimationTime=nowTime||performance.now()/1000;
    m.clearRect(0,0,mw,mh);
    if(worldMapImage.complete&&worldMapImage.naturalWidth&&!worldMapImage.failed)m.drawImage(worldMapImage,0,0,mw,mh);
    else{var fallback=m.createLinearGradient(0,0,mw,mh);fallback.addColorStop(0,'#10291f');fallback.addColorStop(.5,'#1b2449');fallback.addColorStop(1,'#082a38');m.fillStyle=fallback;m.fillRect(0,0,mw,mh);}

    if(!settings.reducedMotion){
      m.save();m.globalAlpha=.12;
      for(var cloud=0;cloud<4;cloud++){var cloudX=300+((mapAnimationTime*5+cloud*71)%245),cloudY=38+cloud*26;m.fillStyle='#d9f1ff';m.beginPath();m.ellipse(cloudX,cloudY,35,10,0,0,Math.PI*2);m.fill();}
      m.globalAlpha=.5;m.strokeStyle='#e4f5ff';m.lineWidth=1.2;
      for(var bird=0;bird<3;bird++){var birdX=120+((mapAnimationTime*12+bird*97)%350),birdY=54+bird*18;m.beginPath();m.arc(birdX-3,birdY,4,3.6,5.7);m.arc(birdX+4,birdY,4,3.7,5.8);m.stroke();}
      for(var glow=0;glow<11;glow++){var glowX=45+(glow*31%190),glowY=45+(glow*47%105);m.globalAlpha=.3+.25*Math.sin(mapAnimationTime*3+glow);m.fillStyle=glow%2?'#ff9d57':'#ffc857';m.beginPath();m.arc(glowX,glowY,1.7,0,Math.PI*2);m.fill();}
      for(var leaf=0;leaf<9;leaf++){var leafX=72+((mapAnimationTime*8+leaf*29)%190),leafY=190+((mapAnimationTime*5+leaf*43)%118);m.globalAlpha=.25;m.fillStyle='#a9f58b';m.fillRect(leafX,leafY,2,4);}
      m.restore();
    }

    Object.keys(WORLD_MAP_REGIONS).forEach(function(stageKey){
      var stage=Number(stageKey),region=WORLD_MAP_REGIONS[stage],unlocked=stageUnlockedForTravel(stage);
      if(!unlocked){m.fillStyle='rgba(2,7,13,.63)';m.beginPath();m.ellipse(region.x+region.w/2,region.y+region.h/2,region.w*.52,region.h*.52,0,0,Math.PI*2);m.fill();}
      m.font='bold 10px monospace';m.textAlign='left';m.strokeStyle='rgba(2,6,12,.9)';m.lineWidth=3;
      var regionLabel=unlocked?STAGE_NAMES[stage].toUpperCase():'UNKNOWN ROAD';
      m.strokeText(regionLabel,region.labelX,region.labelY);m.fillStyle=unlocked?'#f0f7ef':'#71808a';m.fillText(regionLabel,region.labelX,region.labelY);
      if(!unlocked)return;
      var level=LEVELS[stage],hub=worldToAtlas(stage,level.hub.x,level.hub.y),bossPoint=worldToAtlas(stage,level.boss.x,level.boss.y);
      drawMapMarker(m,hub.x,hub.y,'#62c7ff','gate','',false);
      drawMapMarker(m,bossPoint.x,bossPoint.y,bossDefeatedForStage(stage)?'#7ce4d1':'#ff7892','boss',bossDefeatedForStage(stage)?'CLEARED':bossDefForStage(stage).shortName.toUpperCase(),!bossDefeatedForStage(stage));
      MINIBOSS_DEFS.filter(function(definition){return definition.stage===stage&&state.miniBossesDefeated.indexOf(definition.id)<0;}).forEach(function(definition){
        var miniPoint=worldToAtlas(stage,definition.x,definition.y);
        drawMapMarker(m,miniPoint.x,miniPoint.y,definition.color,'boss','OPTIONAL',false);
      });
    });

    var objectiveTarget=getObjective(),objectivePoint=worldToAtlas(state.stage,objectiveTarget.x,objectiveTarget.y);
    drawMapMarker(m,objectivePoint.x,objectivePoint.y,'#ffc857','diamond','QUEST',true);
    var playerPoint=worldToAtlas(state.stage,player.x,player.y);
    drawMapMarker(m,playerPoint.x,playerPoint.y,'#ffffff','circle','YOU',true);
    if(state.stage===1){
      shrines.forEach(function(shrine){var point=worldToAtlas(1,shrine.x,shrine.y);drawMapMarker(m,point.x,point.y,state.notes.indexOf(shrine.note)>=0?NOTE_COLORS[shrine.note]:'#758083','diamond',shrine.note,false);});
      var shopPoint=worldToAtlas(1,1320,1180);drawMapMarker(m,shopPoint.x,shopPoint.y,'#f6e36d','gate','BRAD',false);
    }
    if(state.skills.indexOf('relic-hunter')>=0||state.purchases.indexOf('collector-compass')>=0){
      Object.keys(LEVELS).forEach(function(stageKey){var stage=Number(stageKey);if(!stageUnlockedForTravel(stage))return;LEVELS[stage].collectibles.forEach(function(item){if(state.collectibles.indexOf(item.id)>=0)return;var point=worldToAtlas(stage,item.x,item.y);drawMapMarker(m,point.x,point.y,COLLECTIBLE_SETS[item.set].color,'diamond','',false);});});
    }
    [['fernside-secret',1,470,520],['root-camp',2,580,1160],['cloud-sanctum',3,1620,280],['tidal-vault',4,1960,1080],['dream-gate',1,2240,420]].forEach(function(secret){if(state.discoveredSecrets.indexOf(secret[0])<0)return;var point=worldToAtlas(secret[1],secret[2],secret[3]);drawMapMarker(m,point.x,point.y,'#d77cff','diamond','SECRET',true);});
    if(state.home.unlocked)drawMapMarker(m,278,203,'#ffc857','gate','HOME',false);
    var vignette=m.createRadialGradient(mw/2,mh/2,mh*.18,mw/2,mh/2,mh*.72);vignette.addColorStop(0,'rgba(2,6,12,0)');vignette.addColorStop(1,'rgba(2,6,12,.38)');m.fillStyle=vignette;m.fillRect(0,0,mw,mh);
  }

  function drawLegacyMap() {
    var map = byId('mapCanvas');
    if (!map) return;
    var m = map.getContext('2d');
    var mw = map.width;
    var mh = map.height;
    var scale = Math.min((mw-24) / WORLD.w, (mh-24) / WORLD.h);
    var sx = scale, sy = scale;
    var ox=(mw-WORLD.w*scale)/2, oy=(mh-WORLD.h*scale)/2;
    var gradient = m.createLinearGradient(0, 0, mw, mh);
    gradient.addColorStop(0, '#061719');
    gradient.addColorStop(1, '#102824');
    m.fillStyle = gradient;
    m.fillRect(0, 0, mw, mh);
    m.strokeStyle = 'rgba(255,220,145,.18)';
    m.lineWidth = 1;
    for (var gx = 20; gx < mw; gx += 40) { m.beginPath(); m.moveTo(gx,0); m.lineTo(gx,mh); m.stroke(); }
    for (var gy = 20; gy < mh; gy += 40) { m.beginPath(); m.moveTo(0,gy); m.lineTo(mw,gy); m.stroke(); }
    m.save(); m.translate(ox,oy);
    currentLevel.zones.forEach(function (z, index) {
      m.fillStyle = z[5];
      m.beginPath();
      m.ellipse(z[0]*sx,z[1]*sy,z[2]*sx,z[3]*sy,0,0,Math.PI*2);
      m.fill();
      m.strokeStyle = 'rgba(229,240,208,.12)';
      m.lineWidth = 2;
      m.stroke();
    });
    m.strokeStyle='rgba(255,220,145,.55)';m.lineWidth=5;m.beginPath();
    currentLevel.routes.forEach(function (r) { m.moveTo(r[0]*sx,r[1]*sy);m.quadraticCurveTo(r[2]*sx,r[3]*sy,r[4]*sx,r[5]*sy); });
    m.stroke();
    m.font='bold 10px monospace';
    currentLevel.labels.forEach(function (label) {
      m.fillStyle='rgba(0,0,0,.72)';
      m.fillText(label[2],label[0]*sx+1,label[1]*sy+1);
      m.fillStyle='#e7f7df';
      m.fillText(label[2],label[0]*sx,label[1]*sy);
    });
    var mapBossDef = bossDefForStage(state.stage);
    m.beginPath();
    m.arc(BOSS_CENTER.x * sx, BOSS_CENTER.y * sy, 285 * sx, 0, Math.PI * 2);
    m.fillStyle = bossDefeatedForStage(state.stage) ? 'rgba(47,102,83,.35)' :
      bossPrerequisiteMet(state.stage) ? 'rgba(91,47,91,.58)' : 'rgba(35,34,51,.52)';
    m.fill();
    m.fillStyle = bossDefeatedForStage(state.stage) ? '#7ce4d1' : '#f0c8e8';
    m.fillText((bossDefeatedForStage(state.stage) ? 'CLEARED · ' : '') + mapBossDef.shortName.toUpperCase(),
      (BOSS_CENTER.x - 150) * sx, (BOSS_CENTER.y + 8) * sy);
    shrines.forEach(function (s) {
      m.fillStyle = state.notes.indexOf(s.note) >= 0 ? NOTE_COLORS[s.note] : '#758083';
      m.beginPath();
      m.arc(s.x * sx, s.y * sy, 6, 0, Math.PI * 2);
      m.fill();
      m.fillStyle = '#fff';
      m.fillText(s.note, s.x * sx - 3, s.y * sy + 3);
    });
    drums.forEach(function (d) { m.fillStyle=state.drums.indexOf(d.id)>=0?'#ffc857':'#77745f';m.beginPath();m.arc(d.x*sx,d.y*sy,4,0,Math.PI*2);m.fill(); });
    speakers.forEach(function (s) { m.fillStyle=state.speakers.indexOf(s.id)>=0?'#9de8ff':'#606781';m.fillRect(s.x*sx-3,s.y*sy-3,6,6); });
    stageTokens.forEach(function (token) { if(state.stageTokens.indexOf(token.id)<0){m.fillStyle='#86e8ff';m.beginPath();m.arc(token.x*sx,token.y*sy,4,0,Math.PI*2);m.fill();} });
    if (state.skills.indexOf('relic-hunter') >= 0 || state.purchases.indexOf('collector-compass') >= 0) collectibles.forEach(function(item){if(state.collectibles.indexOf(item.id)<0){m.fillStyle=COLLECTIBLE_SETS[item.set].color;m.save();m.translate(item.x*sx,item.y*sy);m.rotate(Math.PI/4);m.fillRect(-3,-3,6,6);m.restore();}});
    npcs.forEach(function (n) {
      m.fillStyle = n.color;
      m.fillRect(n.x * sx - 3, n.y * sy - 3, 6, 6);
      if (n.id === 'brad') {
        m.fillStyle = '#fff0a7';
        m.fillText('SHOP', n.x * sx + 6, n.y * sy - 4);
      }
    });
    stagePortals.forEach(function (p) {
      m.strokeStyle = portalUnlocked(p) ? '#62c7ff' : '#59656b';
      m.lineWidth = 2;
      m.strokeRect(p.x*sx-5,p.y*sy-5,10,10);
      m.fillStyle = portalUnlocked(p) ? '#dff8ff' : '#879196';
      m.fillText(String(p.target), p.x*sx-3, p.y*sy+3);
    });
    healthPickups.forEach(function(h){m.fillStyle='#ff7892';m.beginPath();m.arc(h.x*sx,h.y*sy,3,0,Math.PI*2);m.fill();});
    if (activeBuffs.mapTimer > 0) {
      enemies.forEach(function (e) {
        if (e.dead) return;
        m.fillStyle = enemyColor(e);
        m.beginPath();
        m.arc(e.x * sx, e.y * sy, 3, 0, Math.PI * 2);
        m.fill();
      });
    }
    var objectiveTarget = getObjective();
    m.save();
    m.translate(objectiveTarget.x * sx, objectiveTarget.y * sy);
    m.rotate(Math.PI / 4);
    m.fillStyle = '#ffc857';
    m.fillRect(-4, -4, 8, 8);
    m.restore();
    m.fillStyle = '#fff';
    m.beginPath();
    m.arc(player.x * sx, player.y * sy, 5, 0, Math.PI * 2);
    m.fill();
    m.strokeStyle = '#56f0c4';
    m.lineWidth = 2;
    m.stroke();
    m.restore();
  }

  function openComposer() {
    if (!hasAllNotes()) return;
    composerOpen = true;
    pendingComposer = true;
    setHidden(byId('composerScreen'), false);
    setOverlayIsolation('composer', 'composerScreen', true);
    renderComposer();
    releaseHeldInputs();
    focusSoon('closeComposerButton');
  }
  function closeComposer() {
    composerOpen = false;
    pendingComposer = false;
    audioCall('playMelody', []);
    if (melodyPreviewTimer) {
      clearInterval(melodyPreviewTimer);
      melodyPreviewTimer = null;
    }
    setOverlayIsolation('composer', 'composerScreen', false);
    setHidden(byId('composerScreen'), true);
    focusSoon('gameCanvas');
  }
  function melodyUsesAllNotes() {
    return NOTE_ORDER.every(function (n) { return state.melody.indexOf(n) >= 0; });
  }
  function renderComposer(focusIndex) {
    var grid = byId('composerGrid');
    var info = byId('composerInfo');
    if (!grid) return;
    grid.innerHTML = '';
    state.melody.forEach(function (note, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'beat-cell' + (note === '-' ? ' rest' : '');
      button.setAttribute('data-beat-index', index);
      button.textContent = note === '-' ? '—' : note;
      button.style.setProperty('--beat-color', note === '-' ? '#667274' : NOTE_COLORS[note]);
      button.setAttribute('aria-label', 'Beat ' + (index + 1) + ': ' + (note === '-' ? 'rest' : 'note ' + note));
      button.addEventListener('click', function () {
        var choices = ['-'].concat(state.notes);
        var next = (choices.indexOf(state.melody[index]) + 1) % choices.length;
        state.melody[index] = choices[next];
        audioCall('previewNote', state.melody[index]);
        audioCall('setProgress', state.notes.length, state.melody, state.notes.slice());
        renderComposer(index);
      });
      grid.appendChild(button);
    });
    if (typeof focusIndex === 'number') {
      window.requestAnimationFrame(function () {
        var next = grid.querySelector('[data-beat-index="' + focusIndex + '"]');
        if (next) next.focus();
      });
    }
    if (info) {
      info.textContent = melodyUsesAllNotes() ?
        'All four colors are in the groove. Save it when it feels right.' :
        'Use C, E, G, and B at least once. Rests are welcome.';
      info.classList.toggle('ready', melodyUsesAllNotes());
    }
  }
  function previewMelody() {
    if (!composerOpen) return;
    if (melodyPreviewTimer) {
      clearInterval(melodyPreviewTimer);
      melodyPreviewTimer = null;
    }
    audioCall('setProgress', state.notes.length, state.melody, state.notes.slice());
    if (window.MossAudio && typeof window.MossAudio.playMelody === 'function') {
      audioCall('playMelody', state.melody);
    } else {
      var index = 0;
      var copy = state.melody.slice();
      melodyPreviewTimer = setInterval(function () {
        if (!composerOpen || index >= copy.length) {
          clearInterval(melodyPreviewTimer);
          melodyPreviewTimer = null;
          return;
        }
        if (copy[index] !== '-') audioCall('previewNote', copy[index]);
        index++;
      }, 250);
    }
  }
  function saveMelody() {
    if (!melodyUsesAllNotes()) {
      audioCall('sfx', 'error');
      showToast('ONE COLOR IS MISSING', 'Use C, E, G, and B at least once.', '#ff7892', 2.7);
      return;
    }
    state.composed = true;
    audioCall('sfx', 'unlock');
    saveGame(true);
    updateHUD();
    closeComposer();
    showToast('GATE-TONE SAVED', 'The Feedback Amphitheatre is open.', '#d77cff', 4);
  }

  var controlContacts = new Map();
  var joystickVector = { x: 0, y: 0, magnitude: 0, pointerId: null };
  var directionActions = { up: true, down: true, left: true, right: true };

  function contactUsesAction(action) {
    var found = false;
    controlContacts.forEach(function (contact) {
      if (contact.action === action) found = true;
    });
    return found;
  }

  function attackSourceIsActive() {
    return keys.has('space') || keys.has('j') || contactUsesAction('attack');
  }

  function releaseAttackIfIdle() {
    if (attackSourceIsActive()) return;
    player.attackHeld = false;
    player.attackHold = 0;
    player.chargedThisHold = false;
  }

  function releaseHeldInputs() {
    keys.clear();
    player.attackHeld = false;
    player.attackHold = 0;
    player.chargedThisHold = false;
    player.blocking = false;
    player.moveX = 0;
    player.moveY = 0;
    inputBuffer.attack = inputBuffer.dodge = inputBuffer.block = inputBuffer.interact = 0;
    controlContacts.forEach(function (contact) {
      if (contact.button) contact.button.classList.remove('pressed', 'is-pressed');
    });
    controlContacts.clear();
    joystickVector.x = 0; joystickVector.y = 0; joystickVector.magnitude = 0; joystickVector.pointerId = null;
    var joystickBase = byId('joystickBase');
    if (joystickBase) joystickBase.classList.remove('active');
    document.querySelectorAll('[data-control].pressed, [data-control].is-pressed').forEach(function (button) {
      button.classList.remove('pressed', 'is-pressed');
    });
  }

  function runControlAction(action) {
    if (action === 'dodge') doDash();
    else if (action === 'pulse') doPulse();
    else if (action === 'block') beginBlock();
    else if (action === 'heal') useStoredHeartbloom();
    else if (action === 'odin') cycleOdinCommand();
    else if (action === 'interact') interact();
    else if (action === 'map') {
      if (mapOpen) closeMap(); else openMap();
    } else if (action === 'pause') togglePause();
  }

  var gamepadVector = { x:0, y:0, magnitude:0 };
  var gamepadButtonState = [];
  var gamepadBlockHeld = false;

  function pollGamepad() {
    if (!navigator.getGamepads) return;
    var pads;
    try {
      pads = navigator.getGamepads();
    } catch (error) {
      reportRuntimeIssue('Gamepad polling failed.', error);
      return;
    }
    var pad = null;
    for (var padIndex = 0; pads && padIndex < pads.length; padIndex++) {
      if (pads[padIndex] && pads[padIndex].connected) { pad = pads[padIndex]; break; }
    }
    if (!pad) {
      gamepadVector.x = 0; gamepadVector.y = 0; gamepadVector.magnitude = 0;
      if (gamepadBlockHeld) endBlock();
      gamepadBlockHeld = false;
      gamepadButtonState.length = 0;
      canvas.dataset.gamepad = 'disconnected';
      return;
    }
    canvas.dataset.gamepad = pad.id || 'connected';
    var axisX = Math.abs(pad.axes[0] || 0) >= 0.18 ? pad.axes[0] : 0;
    var axisY = Math.abs(pad.axes[1] || 0) >= 0.18 ? pad.axes[1] : 0;
    var dpadX = (pad.buttons[15] && pad.buttons[15].pressed ? 1 : 0) -
      (pad.buttons[14] && pad.buttons[14].pressed ? 1 : 0);
    var dpadY = (pad.buttons[13] && pad.buttons[13].pressed ? 1 : 0) -
      (pad.buttons[12] && pad.buttons[12].pressed ? 1 : 0);
    gamepadVector.x = dpadX || axisX;
    gamepadVector.y = dpadY || axisY;
    gamepadVector.magnitude = Math.min(1, Math.sqrt(gamepadVector.x * gamepadVector.x + gamepadVector.y * gamepadVector.y));
    if (gamepadVector.magnitude > 1) {
      gamepadVector.x /= gamepadVector.magnitude;
      gamepadVector.y /= gamepadVector.magnitude;
      gamepadVector.magnitude = 1;
    }

    function pressed(index) { return !!(pad.buttons[index] && pad.buttons[index].pressed); }
    function justPressed(index) { return pressed(index) && !gamepadButtonState[index]; }
    var modalOpen = mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen ||
      statisticsOpen || instrumentsOpen || homeOpen || panelIsOpen('settingsPanel');
    if (justPressed(9)) {
      if (modalOpen || dialogue) closeTopOverlay(); else togglePause();
    } else if (justPressed(1) && (modalOpen || dialogue || paused)) {
      closeTopOverlay();
    } else if (started && !paused && !modalOpen && !dialogue) {
      if (pressed(0) && !gamepadButtonState[0] && !player.attackHeld) {
        player.attackHeld = true;
        player.attackHold = 0;
        player.chargedThisHold = false;
        performAttack(false);
      } else if (!pressed(0) && gamepadButtonState[0]) {
        releaseAttackIfIdle();
      }
      if (justPressed(1)) runControlAction('dodge');
      if (justPressed(2)) runControlAction('pulse');
      if (justPressed(3)) runControlAction('interact');
      if (justPressed(5)) runControlAction('odin');
      if (justPressed(8)) runControlAction('map');
      if (pressed(4) && !gamepadBlockHeld) beginBlock();
      if (!pressed(4) && gamepadBlockHeld) endBlock();
      gamepadBlockHeld = pressed(4);
    }
    for (var buttonIndex = 0; buttonIndex < pad.buttons.length; buttonIndex++) {
      gamepadButtonState[buttonIndex] = pressed(buttonIndex);
    }
  }

  function pressControl(button, action, contactId) {
    if (controlContacts.has(contactId)) return;
    var alreadyActive = contactUsesAction(action);
    controlContacts.set(contactId, { button: button, action: action });
    button.classList.add('pressed');

    if (directionActions[action]) {
      keys.add('touch-' + action);
    } else if (action === 'block') {
      beginBlock();
    } else if (action === 'attack') {
      if (!player.attackHeld) {
        player.attackHeld = true;
        player.attackHold = 0;
        player.chargedThisHold = false;
        performAttack(false);
      }
    } else if (!alreadyActive) {
      runControlAction(action);
    }
  }

  function releaseControl(contactId) {
    var contact = controlContacts.get(contactId);
    if (!contact) return;
    controlContacts.delete(contactId);
    if (contact.button) {
      var buttonStillActive = false;
      controlContacts.forEach(function (other) {
        if (other.button === contact.button) buttonStillActive = true;
      });
      if (!buttonStillActive) contact.button.classList.remove('pressed', 'is-pressed');
    }
    if (!contactUsesAction(contact.action)) {
      if (directionActions[contact.action]) keys.delete('touch-' + contact.action);
      if (contact.action === 'attack') releaseAttackIfIdle();
      if (contact.action === 'block') { inputBuffer.block = 0; endBlock(); }
    }
  }

  function controlAtPoint(x, y) {
    var hit = document.elementFromPoint(x, y);
    var button = hit && hit.closest ? hit.closest('[data-control]') : null;
    return button && byId('touchControls').contains(button) ? button : null;
  }

  function moveDirectionalContact(contactId, x, y) {
    var current = controlContacts.get(contactId);
    if (!current || !directionActions[current.action]) return;
    var nextButton = controlAtPoint(x, y);
    var nextAction = nextButton && nextButton.getAttribute('data-control');
    if (!directionActions[nextAction] || nextAction === current.action) return;
    releaseControl(contactId);
    pressControl(nextButton, nextAction, contactId);
  }

  function activateControlClick(button, action) {
    button.classList.add('pressed');
    window.setTimeout(function () { button.classList.remove('pressed'); }, 140);
    if (directionActions[action]) {
      keys.add('touch-' + action);
      window.setTimeout(function () { keys.delete('touch-' + action); }, 180);
    } else if (action === 'block') {
      beginBlock();
      window.setTimeout(endBlock, 240);
    } else if (action === 'attack') {
      if (player.attackHeld) return;
      player.attackHeld = true;
      player.attackHold = 0;
      player.chargedThisHold = false;
      performAttack(false);
      window.setTimeout(function () {
        releaseAttackIfIdle();
      }, 120);
    } else {
      runControlAction(action);
    }
  }

  function togglePause(force) {
    if (!started || dialogue || composerOpen || mapOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen) return;
    var nextPaused = typeof force === 'boolean' ? force : !paused;
    if (!nextPaused && orientationBlocked) return;
    paused = nextPaused;
    if (!paused) setOverlayIsolation('pause', 'pauseScreen', false);
    setHidden(byId('pauseScreen'), !paused);
    if (paused) setOverlayIsolation('pause', 'pauseScreen', true);
    audioCall('pause', paused);
    resumeAudioOnGesture = false;
    releaseHeldInputs();
    if (paused) {
      var pauseHome=byId('pauseHomeButton');
      if(pauseHome){pauseHome.disabled=!state.home.unlocked;pauseHome.textContent=state.home.unlocked?'Player Home':'Player Home · Locked';}
      var pauseLocation=byId('pauseLocation');
      if(pauseLocation)pauseLocation.textContent=STAGE_NAMES[state.stage]+' is holding your place · '+equippedInstrument().name+' · '+state.weather.replace('-',' ');
      saveGame(true);
      focusSoon('resumeButton');
    } else {
      focusSoon('gameCanvas');
    }
  }

  function keyName(event) {
    var key = event.key.toLowerCase();
    if (event.code === 'Space') return 'space';
    if (key === 'shift') return 'shift';
    return key;
  }
  var controlledKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'space', 'j', 'shift', 'k', 'q', 'l', 'f', 'h', 'r', 'e', 'enter', 'tab', 'i', 'b', 'v', 'o', 'escape']);

  function panelIsOpen(id) {
    var panel = byId(id);
    return !!panel && !panel.hidden;
  }

  function openHowPanel() {
    setHidden(byId('howPanel'), false);
    setOverlayIsolation('how', 'howPanel', true);
    focusSoon('closeHowButton');
  }

  function closeHowPanel() {
    setOverlayIsolation('how', 'howPanel', false);
    setHidden(byId('howPanel'), true);
    focusSoon('howButton');
  }

  var settingsReturnsToPause = false;
  function openSettingsPanel() {
    releaseHeldInputs();
    settingsReturnsToPause = paused && panelIsOpen('pauseScreen');
    if (settingsReturnsToPause) setOverlayIsolation('pause', 'pauseScreen', false);
    setHidden(byId('settingsPanel'), false);
    setOverlayIsolation('settings', 'settingsPanel', true);
    focusSoon('closeSettingsButton');
  }

  function closeSettingsPanel() {
    setOverlayIsolation('settings', 'settingsPanel', false);
    setHidden(byId('settingsPanel'), true);
    if (settingsReturnsToPause && paused) setOverlayIsolation('pause', 'pauseScreen', true);
    settingsReturnsToPause = false;
    focusSoon(paused ? 'pauseSettingsButton' : 'settingsButton');
  }

  function recoverAudioFromGesture() {
    if (!started || document.hidden || orientationBlocked) return;
    if (resumeAudioOnGesture && !paused && !dialogue && !composerOpen && !mapOpen && !inventoryOpen && !shopOpen && !skillsOpen && !statisticsOpen && !instrumentsOpen && !homeOpen) {
      resumeAudioOnGesture = false;
      audioCall('pause', orientationBlocked);
    }
  }

  function pauseForInterruption() {
    releaseHeldInputs();
    if (!started) return;
    saveGame(true);
    var modalOpen = !!dialogue || composerOpen || mapOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen;
    if (!paused && !modalOpen) {
      togglePause(true);
    } else if (paused && !modalOpen) {
      setHidden(byId('pauseScreen'), false);
      setOverlayIsolation('pause', 'pauseScreen', true);
      audioCall('pause', true);
    } else {
      resumeAudioOnGesture = true;
      audioCall('pause', true);
    }
    canvasDirty = true;
  }

  function closeTopOverlay() {
    if (panelIsOpen('settingsPanel')) closeSettingsPanel();
    else if (panelIsOpen('howPanel')) closeHowPanel();
    else if (inventoryOpen) closeInventory();
    else if (shopOpen) closeShop();
    else if (skillsOpen) closeSkills();
    else if (instrumentsOpen) closeInstruments();
    else if (homeOpen) closeHome();
    else if (statisticsOpen) closeStatistics();
    else if (mapOpen) closeMap();
    else if (composerOpen) closeComposer();
    else if (dialogue) advanceDialogue();
    else if (paused) togglePause(false);
  }

  window.addEventListener('keydown', function (event) {
    var key = keyName(event);
    recoverAudioFromGesture();
    var target = event.target;
    var interactiveTarget = target && target.closest &&
      target.closest('button, input, select, textarea, [contenteditable="true"], a[href]');
    if (key === 'escape' && (panelIsOpen('settingsPanel') || panelIsOpen('howPanel') || statisticsOpen)) {
      event.preventDefault();
      closeTopOverlay();
      return;
    }
    if (interactiveTarget) {
      if (key === 'escape' && (started || statisticsOpen)) {
        event.preventDefault();
        closeTopOverlay();
      }
      return;
    }
    if (!started) return;
    if (paused || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen) {
      if (key === 'escape' || (inventoryOpen && (key === 'i' || key === 'b')) || (instrumentsOpen && key === 'v') || (homeOpen && key === 'o')) {
        event.preventDefault();
        closeTopOverlay();
      }
      return;
    }
    if (controlledKeys.has(key)) event.preventDefault();
    if (event.repeat && ['e', 'enter', 'tab', 'i', 'b', 'escape', 'shift', 'k', 'q', 'l', 'f', 'h', 'r'].indexOf(key) >= 0) return;
    keys.add(key);
    if (key === 'e' || key === 'enter') interact();
    else if (key === 'shift' || key === 'k') doDash();
    else if (key === 'q' || key === 'l') doPulse();
    else if (key === 'f') beginBlock();
    else if (key === 'h') useStoredHeartbloom();
    else if (key === 'r') cycleOdinCommand();
    else if (key === 'space' || key === 'j') {
      if (!player.attackHeld) {
        player.attackHeld = true;
        player.attackHold = 0;
        player.chargedThisHold = false;
        performAttack(false);
      }
    } else if (key === 'tab') {
      if (mapOpen) closeMap(); else openMap();
    } else if (key === 'i' || key === 'b') {
      openInventory();
    } else if (key === 'v') {
      openInstruments();
    } else if (key === 'o') {
      openHome();
    } else if (key === 'escape') {
      if (dialogue) advanceDialogue();
      else togglePause();
    }
  });
  window.addEventListener('keyup', function (event) {
    var key = keyName(event);
    keys.delete(key);
    if (key === 'space' || key === 'j') {
      releaseAttackIfIdle();
    }
    if (key === 'f') { inputBuffer.block = 0; endBlock(); }
  });
  window.addEventListener('blur', pauseForInterruption);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseForInterruption();
  });
  window.addEventListener('pagehide', pauseForInterruption);
  window.addEventListener('pageshow', function () {
    lastFrame = performance.now();
    canvasDirty = true;
    queueViewportSync();
  });
  window.addEventListener('resize', queueViewportSync, { passive: true });
  window.addEventListener('orientationchange', function () {
    releaseHeldInputs();
    queueViewportSync();
    window.setTimeout(syncViewport, 120);
    window.setTimeout(syncViewport, 420);
  }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueViewportSync, { passive: true });
    window.visualViewport.addEventListener('scroll', queueViewportSync, { passive: true });
  }
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', recoverAudioFromGesture, { capture: true, passive: true });
  } else {
    document.addEventListener('touchstart', recoverAudioFromGesture, { capture: true, passive: true });
  }

  function bindControls() {
    var start = byId('startButton');
    var cont = byId('continueButton');
    var how = byId('howButton');
    var closeHow = byId('closeHowButton');
    var settingsButton = byId('settingsButton');
    var statisticsButton = byId('statisticsButton');
    var closeSettings = byId('closeSettingsButton');
    var resume = byId('resumeButton');
    var pauseMapButton = byId('pauseMapButton');
    var pauseBackpackButton = byId('pauseBackpackButton');
    var pauseInstrumentsButton = byId('pauseInstrumentsButton');
    var pauseHomeButton = byId('pauseHomeButton');
    var pauseSettingsButton = byId('pauseSettingsButton');
    var pauseStatisticsButton = byId('pauseStatisticsButton');
    var backpackHudButton = byId('backpackHudButton');
    var closeInventoryButton = byId('closeInventoryButton');
    var dialogueContinueButton = byId('dialogueContinueButton');
    var closeMapButton = byId('closeMapButton');
    var playMelodyButton = byId('playMelodyButton');
    var saveMelodyButton = byId('saveMelodyButton');
    var closeComposerButton = byId('closeComposerButton');
    var resetButton = byId('resetButton');
    var replayButton = byId('replayButton');
    var closeShopButton=byId('closeShopButton'), closeSkillsButton=byId('closeSkillsButton'), pauseSkillsButton=byId('pauseSkillsButton');
    var closeInstrumentsButton=byId('closeInstrumentsButton'), closeHomeButton=byId('closeHomeButton'), homeLeaveButton=byId('homeLeaveButton');
    var closeStatisticsButton = byId('closeStatisticsButton');
    var joystickZone = byId('joystickZone');
    var joystickBase = byId('joystickBase');
    var joystickKnob = byId('joystickKnob');
    if (joystickZone && joystickBase && joystickKnob && window.PointerEvent) {
      var joyOrigin = { x: 0, y: 0 };
      function moveJoystick(event) {
        if (joystickVector.pointerId !== event.pointerId) return;
        var dx = event.clientX - joyOrigin.x, dy = event.clientY - joyOrigin.y;
        var distanceValue = Math.sqrt(dx * dx + dy * dy), radius = 54;
        var scale = distanceValue > radius ? radius / distanceValue : 1;
        var px = dx * scale, py = dy * scale;
        joystickKnob.style.transform = 'translate(' + px + 'px,' + py + 'px)';
        joystickVector.magnitude = distanceValue < 10 ? 0 : Math.min(1, distanceValue / radius);
        joystickVector.x = distanceValue ? dx / distanceValue : 0; joystickVector.y = distanceValue ? dy / distanceValue : 0;
      }
      joystickZone.addEventListener('pointerdown', function (event) {
        if (joystickVector.pointerId !== null) return;
        event.preventDefault(); joystickVector.pointerId = event.pointerId;
        joyOrigin.x = event.clientX; joyOrigin.y = event.clientY;
        var rect = joystickZone.getBoundingClientRect();
        joystickBase.style.left = (event.clientX - rect.left) + 'px'; joystickBase.style.top = (event.clientY - rect.top) + 'px';
        joystickBase.classList.add('active'); joystickZone.setPointerCapture(event.pointerId); moveJoystick(event);
      }, { passive: false });
      joystickZone.addEventListener('pointermove', function (event) { event.preventDefault(); moveJoystick(event); }, { passive: false });
      function endJoystick(event) {
        if (joystickVector.pointerId !== event.pointerId) return;
        joystickVector.x = 0; joystickVector.y = 0; joystickVector.magnitude = 0; joystickVector.pointerId = null;
        joystickKnob.style.transform = ''; joystickBase.classList.remove('active');
      }
      joystickZone.addEventListener('pointerup', endJoystick); joystickZone.addEventListener('pointercancel', endJoystick); joystickZone.addEventListener('lostpointercapture', endJoystick);
    }
    if (start) start.addEventListener('click', newGame);
    if (cont) cont.addEventListener('click', continueGame);
    if (how) how.addEventListener('click', openHowPanel);
    if (closeHow) closeHow.addEventListener('click', closeHowPanel);
    if (settingsButton) settingsButton.addEventListener('click', openSettingsPanel);
    if (statisticsButton) statisticsButton.addEventListener('click', openStatistics);
    if (closeSettings) closeSettings.addEventListener('click', closeSettingsPanel);
    if (resume) resume.addEventListener('click', function () { togglePause(false); });
    if (pauseMapButton) pauseMapButton.addEventListener('click', openMap);
    if (pauseBackpackButton) pauseBackpackButton.addEventListener('click', openInventory);
    if (pauseInstrumentsButton) pauseInstrumentsButton.addEventListener('click', openInstruments);
    if (pauseHomeButton) pauseHomeButton.addEventListener('click', openHome);
    if (pauseSettingsButton) pauseSettingsButton.addEventListener('click', openSettingsPanel);
    if (pauseStatisticsButton) pauseStatisticsButton.addEventListener('click', openStatistics);
    if (backpackHudButton) backpackHudButton.addEventListener('click', openInventory);
    if (closeInventoryButton) closeInventoryButton.addEventListener('click', closeInventory);
    if(closeShopButton)closeShopButton.addEventListener('click',closeShop);
    if(closeSkillsButton)closeSkillsButton.addEventListener('click',closeSkills);
    if(pauseSkillsButton)pauseSkillsButton.addEventListener('click',openSkills);
    if(closeInstrumentsButton)closeInstrumentsButton.addEventListener('click',closeInstruments);
    if(closeHomeButton)closeHomeButton.addEventListener('click',closeHome);
    if(homeLeaveButton)homeLeaveButton.addEventListener('click',closeHome);
    if (closeStatisticsButton) closeStatisticsButton.addEventListener('click', closeStatistics);
    if (dialogueContinueButton) dialogueContinueButton.addEventListener('click', advanceDialogue);
    if (closeMapButton) closeMapButton.addEventListener('click', closeMap);
    var fastTravelShop = byId('fastTravelShop');
    var fastTravelHome = byId('fastTravelHome');
    if (fastTravelShop) fastTravelShop.addEventListener('click', function () { fastTravelTo(1, true); });
    if (fastTravelHome) fastTravelHome.addEventListener('click', travelHome);
    if (playMelodyButton) playMelodyButton.addEventListener('click', previewMelody);
    if (saveMelodyButton) saveMelodyButton.addEventListener('click', saveMelody);
    if (closeComposerButton) closeComposerButton.addEventListener('click', closeComposer);
    if (resetButton) resetButton.addEventListener('click', function () {
      if (window.confirm('Start a fresh adventure? Settings will be kept.')) {
        started = false;
        releaseHeldInputs();
        removeStoredSaves();
        window.location.reload();
      }
    });
    if (replayButton) replayButton.addEventListener('click', function () {
      setOverlayIsolation('ending', 'endingScreen', false);
      setHidden(byId('endingScreen'), true);
      var advancing=state.bossDefeated&&state.stage===1;
      if(advancing) enterStage(stagePortals[0]);
      else { player.x = HUB.x; player.y = HUB.y + 100; }
      player.health = player.maxHealth;
      paused = orientationBlocked;
      if (orientationBlocked) {
        setHidden(byId('pauseScreen'), false);
        setOverlayIsolation('pause', 'pauseScreen', true);
        audioCall('pause', true);
      } else {
        audioCall('pause', false);
        focusSoon('gameCanvas');
      }
      if(!advancing) showToast('ENCORE MODE', 'Explore, finish the harvest, or replay your melody with EEMS.', '#f6e36d', 4);
    });

    bindSetting('difficultySelect', 'difficulty', false);
    bindSetting('musicVolume', 'musicVolume', true);
    bindSetting('sfxVolume', 'sfxVolume', true);
    bindSetting('screenShake', 'screenShake', false);
    bindSetting('reducedMotion', 'reducedMotion', false);
    bindSetting('objectiveArrow', 'objectiveArrow', false);
    bindSetting('largeText', 'largeText', false);
    bindSetting('interfaceSize', 'interfaceSize', false);

    var controlButtons = Array.prototype.slice.call(document.querySelectorAll('[data-control]'));
    controlButtons.forEach(function (button) {
      var action = button.getAttribute('data-control');
      button.addEventListener('click', function (event) {
        if (event.detail > 0) {
          event.preventDefault();
          return;
        }
        activateControlClick(button, action);
      });

      if (window.PointerEvent) {
        button.addEventListener('pointerdown', function (event) {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.preventDefault();
          var contactId = 'pointer-' + event.pointerId;
          try {
            button.setPointerCapture(event.pointerId);
          } catch (error) {
            reportUnexpectedDomError('A touch control could not capture its pointer.', error);
          }
          pressControl(button, action, contactId);
        }, { passive: false });
        button.addEventListener('pointermove', function (event) {
          var contactId = 'pointer-' + event.pointerId;
          if (!controlContacts.has(contactId)) return;
          event.preventDefault();
          moveDirectionalContact(contactId, event.clientX, event.clientY);
        }, { passive: false });
        function releasePointer(event) {
          var contactId = 'pointer-' + event.pointerId;
          if (!controlContacts.has(contactId)) return;
          event.preventDefault();
          releaseControl(contactId);
          try {
            if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
          } catch (error) {
            reportUnexpectedDomError('A touch control could not release its pointer.', error);
          }
        }
        button.addEventListener('pointerup', releasePointer, { passive: false });
        button.addEventListener('pointercancel', releasePointer, { passive: false });
        button.addEventListener('lostpointercapture', function (event) {
          releaseControl('pointer-' + event.pointerId);
        });
      } else {
        button.addEventListener('touchstart', function (event) {
          event.preventDefault();
          Array.prototype.forEach.call(event.changedTouches, function (touch) {
            pressControl(button, action, 'touch-' + touch.identifier);
          });
        }, { passive: false });
      }
    });

    if (window.PointerEvent) {
      function moveGlobalPointer(event) {
        var contactId = 'pointer-' + event.pointerId;
        if (!controlContacts.has(contactId)) return;
        event.preventDefault();
        moveDirectionalContact(contactId, event.clientX, event.clientY);
      }
      function releaseGlobalPointer(event) {
        var contactId = 'pointer-' + event.pointerId;
        if (!controlContacts.has(contactId)) return;
        event.preventDefault();
        releaseControl(contactId);
      }
      document.addEventListener('pointermove', moveGlobalPointer, { capture: true, passive: false });
      document.addEventListener('pointerup', releaseGlobalPointer, { capture: true, passive: false });
      document.addEventListener('pointercancel', releaseGlobalPointer, { capture: true, passive: false });
    }

    if (!window.PointerEvent) {
      document.addEventListener('touchmove', function (event) {
        var handled = false;
        Array.prototype.forEach.call(event.touches, function (touch) {
          var contactId = 'touch-' + touch.identifier;
          if (!controlContacts.has(contactId)) return;
          handled = true;
          moveDirectionalContact(contactId, touch.clientX, touch.clientY);
        });
        if (handled) event.preventDefault();
      }, { passive: false });
      function releaseTouches(event) {
        Array.prototype.forEach.call(event.changedTouches, function (touch) {
          releaseControl('touch-' + touch.identifier);
        });
      }
      document.addEventListener('touchend', releaseTouches, { passive: false });
      document.addEventListener('touchcancel', releaseTouches, { passive: false });
    }

    var shell = byId('gameShell');
    if (shell) {
      shell.addEventListener('gesturestart', function (event) {
        if (event.target && event.target.closest && event.target.closest('.modal-card, .feature-card, .pause-card, .ending-card')) return;
        event.preventDefault();
      }, { passive: false });
    }
  }

  function updatePlayer(dt) {
    var previousX = player.x;
    var previousY = player.y;
    var left = keys.has('a') || keys.has('arrowleft') || keys.has('touch-left');
    var right = keys.has('d') || keys.has('arrowright') || keys.has('touch-right');
    var up = keys.has('w') || keys.has('arrowup') || keys.has('touch-up');
    var down = keys.has('s') || keys.has('arrowdown') || keys.has('touch-down');
    var mx = (right ? 1 : 0) - (left ? 1 : 0);
    var my = (down ? 1 : 0) - (up ? 1 : 0);
    if (joystickVector.magnitude > 0) { mx = joystickVector.x * joystickVector.magnitude; my = joystickVector.y * joystickVector.magnitude; }
    else if (gamepadVector.magnitude > 0) { mx = gamepadVector.x * gamepadVector.magnitude; my = gamepadVector.y * gamepadVector.magnitude; }
    if ((mx || my) && joystickVector.magnitude === 0) {
      var n = normalize(mx, my);
      mx = n.x;
      my = n.y;
    }
    if (mx || my) player.facing = Math.atan2(my, mx);
    player.moveX = mx;
    player.moveY = my;
    var speed = player.speed;
    if (player.dashTimer > 0) {
      mx = player.dashX;
      my = player.dashY;
      speed = 520;
      if (!settings.reducedMotion && Math.random() < 0.55) spawnParticle(player.x, player.y, '#5ab7a7', 28, 3);
    }
    if (player.blocking) speed *= 0.34;
    if (activeBuffs.speedTimer > 0) speed *= 1.3;
    if (state.skills.indexOf('moss-treader') >= 0) speed *= 1.12;
    if (state.purchases.indexOf('moss-boots') >= 0) speed *= 1.12;
    moveWithCollision(player, mx * speed * dt, my * speed * dt);
    var travelledX = player.x - previousX;
    var travelledY = player.y - previousY;
    state.statistics.distanceTravelled += Math.sqrt(travelledX * travelledX + travelledY * travelledY);
    gateBossArena();
    if ((mx || my) && player.dashTimer <= 0) {
      player.stepTimer -= dt;
      if (player.stepTimer <= 0) {
        player.stepTimer = 0.34;
        audioCall('sfx', 'step');
      }
    }
    player.invuln = Math.max(0, player.invuln - dt);
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.dashTimer = Math.max(0, player.dashTimer - dt);
    player.pulseCooldown = Math.max(0, player.pulseCooldown - dt);
    player.guardBroken = Math.max(0, player.guardBroken - dt);
    player.counterWindow = Math.max(0, player.counterWindow - dt);
    player.blockFlash = Math.max(0, player.blockFlash - dt);
    inputBuffer.attack = Math.max(0, inputBuffer.attack - dt);
    inputBuffer.dodge = Math.max(0, inputBuffer.dodge - dt);
    inputBuffer.block = Math.max(0, inputBuffer.block - dt);
    inputBuffer.interact = Math.max(0, inputBuffer.interact - dt);
    var bufferedBlockHeld = keys.has('f') || contactUsesAction('block') || gamepadBlockHeld;
    if (inputBuffer.block > 0 && bufferedBlockHeld && player.guardBroken <= 0 && player.dashTimer <= 0) beginBlock(true);
    else if (inputBuffer.dodge > 0 && player.dashCooldown <= 0) doDash(true);
    else if (inputBuffer.attack > 0 && player.attackCooldown <= 0 && !player.blocking) performAttack(false,true);
    if (inputBuffer.interact > 0) interact(true);
    if (player.blocking) {
      player.blockStamina = Math.max(0, player.blockStamina - 7 * dt);
      if (player.blockStamina <= 0) breakGuard();
    } else if (player.guardBroken <= 0) {
      player.blockStamina = Math.min(player.blockMaxStamina, player.blockStamina + 24 * dt);
    }
    if (!player.blocking && player.attackHeld && !player.chargedThisHold) {
      player.attackHold += dt;
      var chargeTime = state.skills.indexOf('rhythm-master') >= 0 ? 0.48 : 0.68;
      if (player.attackHold >= chargeTime) {
        player.chargedThisHold = true;
        player.attackCooldown = 0;
        performAttack(true);
      }
    }
    var weedRange = activeBuffs.autoCollectTimer > 0 ? 65 : (state.skills.indexOf('bloom-sense') >= 0 ? 48 : 28);
    weeds.forEach(function (w) {
      if (state.weeds.indexOf(w.id) < 0 && distance(player, w) < weedRange) collectWeed(w);
    });
    stageTokens.forEach(function (token) {
      if (state.stageTokens.indexOf(token.id) < 0 && distance(player, token) < 30) collectStageToken(token);
    });
    collectibles.forEach(function (item) {
      var range = state.skills.indexOf('relic-hunter') >= 0 ? 46 : 28;
      if (state.collectibles.indexOf(item.id) < 0 && distance(player,item) < range) collectWorldCollectible(item);
    });
    if (state.skills.indexOf('verdant-vigor') >= 0 && !mx && !my && player.dashTimer <= 0 && player.health < player.maxHealth) {
      player.vigorTimer = (player.vigorTimer || 0) + dt;
      if (player.vigorTimer >= (activeResonance('nature') ? 6 : 8)) {
        player.vigorTimer = 0;
        healPlayer(1);
        showFloat(player.x, player.y - 24, '+1 ♥', '#7df7a1');
      }
    } else {
      player.vigorTimer = 0;
    }
  }

  function attackDamageFor(a, target, isBoss) {
    var profile = a.profile || instrumentProfile(a.instrument);
    var dmg = profile.damage + (a.charged ? 1 : 0);
    if(a.charged&&state.charged)dmg+=1;
    if (state.skills.indexOf('strong-strike') >= 0) dmg += 1;
    if (state.purchases.indexOf('pruner-polish') >= 0) dmg += 1;
    if (activeResonance('heavy')) dmg += 1;
    if (activeBuffs.odinHowlTimer > 0) dmg += 1;
    if (state.skills.indexOf('battle-focus') >= 0 && player.health >= player.maxHealth) dmg += 1;
    if (!isBoss && target && target.armorBroken > 0) dmg += 1;
    dmg += comboDamageBonus();
    if (a.counter) dmg += 2;
    var critChance = profile.crit + (state.skills.indexOf('critical-rhythm') >= 0 ? 0.20 : 0);
    if (Math.random() < critChance) {
      dmg *= 2;
      showFloat(target.x,target.y-(isBoss?70:24),'CRITICAL!',equippedInstrument().color);
    }
    return dmg;
  }

  function registerInstrumentHit(a, enemy) {
    var instrument = instrumentById(a.instrument);
    var profile = a.profile || instrumentProfile(a.instrument);
    gainInstrumentMastery(a.charged ? 3 : 1);
    instrumentHitStreak++;
    if (instrument.id === 'bass') {
      enemy.armorBroken = Math.max(enemy.armorBroken || 0,activeResonance('heavy') ? 8 : 4);
      enemy.stun = Math.max(enemy.stun,0.65);
    } else if (instrument.id === 'drums') {
      enemy.stun = Math.max(enemy.stun,a.charged ? 2.1 : 0.9);
    } else if (instrument.id === 'violin') {
      enemy.bleedTimer = Math.max(enemy.bleedTimer || 0,a.charged ? 6 : 3.2);
      enemy.bleedTick = 0.75;
    } else if (instrument.id === 'microphone' && instrumentHitStreak % 6 === 0) {
      healPlayer(1);
      showFloat(player.x,player.y-26,'CHORUS +1','#7ce4d1');
    } else if (instrument.id === 'guitar' && !a.chainTriggered) {
      var chained = enemies.filter(function (candidate) {
        return !candidate.dead && candidate !== enemy && !a.hit.has(candidate.id) && distance(enemy,candidate) < 96;
      }).sort(function (left,right) { return distance(enemy,left)-distance(enemy,right); })[0];
      if (chained) {
        a.chainTriggered = true;
        a.hit.add(chained.id);
        hitEnemy(chained,activeResonance('conductor') ? 2 : 1,enemy.x,enemy.y);
        for (var i=0;i<8;i++) spawnParticle(chained.x,chained.y,instrument.color,70,3);
      }
    }
    if (profile.knockback > 14) {
      var push = normalize(enemy.x-player.x,enemy.y-player.y);
      enemy.x += push.x * (profile.knockback-14);
      enemy.y += push.y * (profile.knockback-14);
    }
  }

  function updateAttacks(dt) {
    attacks.forEach(function (a) {
      a.life -= dt;
      var progress = clamp(1 - a.life / a.maxLife,0,1);
      var origin = equipmentWorldOrigin(
        a.instrument,a.charged ? 'charged' : 'attack',a.angle,
        progress * a.maxLife,'hitbox',Math.min(progress,0.999999)
      );
      a.x = origin.x;
      a.y = origin.y;
      enemies.forEach(function (e) {
        if (e.dead || a.hit.has(e.id)) return;
        var d = distance(a, e);
        var hit = false;
        var profile = a.profile || instrumentProfile(a.instrument);
        if (a.charged) hit = d < Math.max(86,profile.range * 1.28) + e.r;
        else {
          var angle = Math.atan2(e.y - a.y, e.x - a.x);
          var wideArc = state.skills.indexOf('strong-strike') >= 0;
          hit = d < (profile.range + (wideArc ? 8 : 0)) + e.r &&
            Math.abs(angleDelta(angle, a.angle)) < (profile.arc + (wideArc ? 0.15 : 0));
        }
        if (hit) {
          a.hit.add(e.id);
          var dmg = attackDamageFor(a,e,false);
          if (hitEnemy(e, dmg, a.x, a.y)) registerInstrumentHit(a,e);
        }
      });
      hitBossWeakPoints(a);
      if (boss && !boss.dead && !a.hit.has('boss')) {
        var bossProfile = a.profile || instrumentProfile(a.instrument);
        var bossRange = a.charged ? Math.max(100,bossProfile.range*1.28) : bossProfile.range + 12;
        if (distance(a, boss) < bossRange + boss.r) {
          a.hit.add('boss');
          var bossDmg = attackDamageFor(a,boss,true);
          hitBoss(bossDmg);
          gainInstrumentMastery(a.charged ? 4 : 2);
        }
      }
      a.progress = progress;
    });
    attacks = attacks.filter(function (a) { return a.life > 0; });
  }

  function updatePulses(dt) {
    pulses.forEach(function (p) {
      p.life -= dt;
      p.r = (1 - p.life / p.maxLife) * 135;
    });
    pulses = pulses.filter(function (p) { return p.life > 0; });
  }

  function difficultySpeed() {
    var speed=settings.difficulty === 'story' ? 0.78 : settings.difficulty === 'hard' ? 1.18 : 1;
    if(state.weather==='blood-moon')speed*=1.14;
    if(state.weather==='fog')speed*=.94;
    return speed;
  }

  function activeEnemyCount() {
    var count = 0;
    for (var index = 0; index < enemies.length; index++) {
      if (!enemies[index].dead && !enemies[index].progressionLocked) count++;
    }
    return count;
  }

  var WORLD_EVENT_DEFS = {
    'travelling-merchant':{name:'Travelling Merchant',color:'#f6e36d',icon:'B',text:'A road trader offers one emergency purchase.'},
    'band-rehearsal':{name:'Band Rehearsal',color:'#d77cff',icon:'♪',text:'Join the groove for mastery XP and a combo blessing.'},
    'campfire':{name:'Campfire',color:'#ff9d57',icon:'✦',text:'Rest, heal and save your progress.'},
    'treasure-caravan':{name:'Treasure Caravan',color:'#ffc857',icon:'◆',text:'A humming lock responds to your instrument.'},
    'lost-explorer':{name:'Lost Explorer',color:'#7ce4d1',icon:'?',text:'Help them home to reveal a secret path.'},
    'rare-collectible':{name:'Rare Record',color:'#ff91d5',icon:'◈',text:'A one-night pressing is hidden nearby.'},
    'secret-cave':{name:'Secret Cave',color:'#9de8ff',icon:'◇',text:'The weather opened a path that was not here before.'},
    'meteor-strike':{name:'Resonance Meteor',color:'#86e8ff',icon:'✹',text:'Tune the fallen crystal for a skill point.'},
    'shrine-awakening':{name:'Awakened Shrine',color:'#a9f58b',icon:'♬',text:'A dormant shrine answers your current instrument.'},
    'ghost-procession':{name:'Ghost Procession',color:'#b7a0ff',icon:'☾',text:'Walk with the quiet musicians to earn a spectral boon.'},
    'music-festival':{name:'Roadside Festival',color:'#ff91d5',icon:'♫',text:'Play a song with the gathering travellers.'}
  };

  function markWorldEvent(id) {
    if(state.worldEventsSeen.indexOf(id)<0)state.worldEventsSeen.push(id);
  }

  function spawnDirectedEnemy(elite,index) {
    var stageLimit = state.stage === 1 ? FIRST_STAGE_BALANCE.maximumActiveEnemies : MAX_ACTIVE_ENEMIES;
    if (activeEnemyCount() >= stageLimit || firstStageHostilesSuspended()) return null;
    if (state.stage === 1 && elite && !firstStageProgressMilestone()) return null;
    var angle=(index||0)*2.1+Math.random()*.7;
    var offscreenRadius = Math.sqrt(W * W + H * H) * 0.5 + FIRST_STAGE_BALANCE.minimumOffscreenSpawnDistance;
    var placement = findValidEnemySpawn(player,{
      radius:18,
      baseRadius:state.stage === 1 ? Math.max(FIRST_STAGE_BALANCE.minimumEnemyDistance + 120,offscreenRadius) : 130+(index||0)*24,
      radiusStep:state.stage === 1 ? 38 : 22,
      angle:angle,
      playerPosition:state.stage === 1 ? player : null,
      enforcePlayerDistance:state.stage === 1,
      minimumPlayerDistance:state.stage === 1 ? Math.max(FIRST_STAGE_BALANCE.minimumEnemyDistance,offscreenRadius) :
        FIRST_STAGE_BALANCE.minimumEnemyDistance
    });
    if (!placement.position) return null;
    var x=placement.position.x;
    var y=placement.position.y;
    var enemy=makeEnemy(['event_'+Date.now()+'_'+index,'thorn',x,y,'world-event'],(index||0)%6);
    if(elite){
      var eliteDef=ELITE_VARIANTS[(state.stage+state.totalKills+index)%ELITE_VARIANTS.length];
      enemy.elite=true;enemy.eliteId=eliteDef.id;enemy.eliteName=eliteDef.name;enemy.eliteColor=eliteDef.color;
      enemy.hp=enemy.maxHp+=5;enemy.r+=3;
    }
    prepareEnemyForSpawn(enemy,{fixed:false,playerPosition:player});
    enemies.push(enemy);
    return enemy;
  }

  function triggerWorldEvent(id) {
    if (state.stage === 1 && (firstStageHostilesSuspended() || dialogue || firstStageRuntime.zone === 'intro' &&
        (id === 'ambush' || id === 'elite-patrol'))) {
      encounterDirector.cooldown = FIRST_STAGE_BALANCE.encounterCooldownSeconds;
      encounterDirector.tension = 0;
      return;
    }
    encounterDirector.tension=0;
    encounterDirector.cooldown=32+Math.random()*22;
    if(id==='ambush'){
      var ambushCount = state.stage === 1 ? (firstStageRuntime.zone === 'standard' ? 2 : 3) : 3+Math.min(2,state.stage);
      var spawnedAmbushers = 0;
      for(var ambusher=0;ambusher<ambushCount;ambusher++)if(spawnDirectedEnemy(false,ambusher))spawnedAmbushers++;
      if (!spawnedAmbushers) return;
      markWorldEvent(id);state.statistics.worldEventsCompleted++;showToast('ENEMY AMBUSH','The director heard your momentum and raised the pressure.','#ff7892',3.2);return;
    }
    if(id==='elite-patrol'){
      if (!spawnDirectedEnemy(true,0)) return;
      markWorldEvent(id);state.statistics.worldEventsCompleted++;showToast('ELITE PATROL','A rare echo is stalking this road.','#f6e36d',3.2);return;
    }
    if(['blood-moon','crystal-storm','forest-bloom'].indexOf(id)>=0){
      state.weather=id;encounterDirector.weatherTimer=55;
      markWorldEvent(id);state.statistics.worldEventsCompleted++;
      var weatherName=id.split('-').map(function(word){return word.charAt(0).toUpperCase()+word.slice(1);}).join(' ');
      showToast(weatherName.toUpperCase(),id==='forest-bloom'?'Heartblooms and regeneration are empowered.':id==='crystal-storm'?'Storm wisps fire faster and rare crystals fall.':'Enemies grow fierce, but drop more Beatcoins.',id==='blood-moon'?'#ff6680':id==='crystal-storm'?'#9de8ff':'#7df7a1',4);
      return;
    }
    var definition=WORLD_EVENT_DEFS[id];
    if(!definition)return;
    var direction=normalize(Math.cos(player.facing)+.2,Math.sin(player.facing)+.2);
    encounterDirector.activeEvent={id:id,x:clamp(player.x+direction.x*105,40,WORLD.w-40),y:clamp(player.y+direction.y*105,40,WORLD.h-40),life:48,color:definition.color};
    showToast(definition.name.toUpperCase(),definition.text,definition.color,3.4);
  }

  function resolveWorldEvent(event) {
    if(!event)return;
    var id=event.id,definition=WORLD_EVENT_DEFS[id];
    if(id==='travelling-merchant'){
      state.beatcoins+=2;state.statistics.beatcoinsEarned+=2;
      showToast('MERCHANT SAMPLE','A free Field Tonic and 2 Beatcoins for listening.','#f6e36d',2.8);
      healPlayer(2);
    }else if(id==='band-rehearsal'){
      gainInstrumentMastery(16);rhythmCombo.count=Math.max(rhythmCombo.count,10);rhythmCombo.timer=4;
    }else if(id==='campfire'){
      healPlayer(999);player.blockStamina=player.blockMaxStamina;saveGame(true);
    }else if(id==='treasure-caravan'){
      var caravanReward=8+instrumentMasteryRecord(state.equippedInstrument).level;
      state.beatcoins+=caravanReward;state.statistics.beatcoinsEarned+=caravanReward;
      showFloat(event.x,event.y-20,'+'+caravanReward+' COINS','#ffc857');
    }else if(id==='lost-explorer'||id==='secret-cave'){
      var secrets=['fernside-secret','root-camp','cloud-sanctum','tidal-vault'];
      var secret=secrets[state.stage-1];
      if(state.discoveredSecrets.indexOf(secret)<0)state.discoveredSecrets.push(secret);
      if(state.discoveredLocations.indexOf(secret)<0)state.discoveredLocations.push(secret);
      showToast('SECRET PATH REVEALED','The location is now marked on the illustrated world map.','#9de8ff',3.2);
    }else if(id==='rare-collectible'){
      state.beatcoins+=6;state.statistics.beatcoinsEarned+=6;
      if(state.home.decorations.indexOf('vinyl-wall')<0)state.home.decorations.push('vinyl-wall');
    }else if(id==='meteor-strike'){
      state.skillPoints++;gainInstrumentMastery(12);
    }else if(id==='shrine-awakening'){
      instrumentUltimateCharge=100;player.pulseCooldown=0;
    }else if(id==='ghost-procession'){
      player.invuln=Math.max(player.invuln,8);activeBuffs.odinHowlTimer=8;
    }else if(id==='music-festival'){
      gainInstrumentMastery(20);state.beatcoins+=5;state.statistics.beatcoinsEarned+=5;
    }
    markWorldEvent(id);
    state.statistics.worldEventsCompleted++;
    encounterDirector.activeEvent=null;
    audioCall('sfx','unlock');
    for(var sparkle=0;sparkle<24;sparkle++)spawnParticle(event.x,event.y,definition.color,95,4);
    saveGame(true);updateHUD(true);
  }

  function updateEncounterDirector(dt) {
    if(encounterDirector.weatherTimer>0){
      encounterDirector.weatherTimer-=dt;
      if(encounterDirector.weatherTimer<=0)state.weather=state.stage===2?'fog':state.stage===3?'wind':state.stage===4?'rain':'clear';
    }
    if(encounterDirector.activeEvent){
      encounterDirector.activeEvent.life-=dt;
      if(encounterDirector.activeEvent.life<=0)encounterDirector.activeEvent=null;
    }
    if(boss&&!boss.dead)return;
    if (state.dreamEncore.active) {
      encounterDirector.cooldown = Math.max(encounterDirector.cooldown,10);
      return;
    }
    if (dialogue || firstStageHostilesSuspended()) {
      if (state.stage === 1) encounterDirector.cooldown = Math.max(encounterDirector.cooldown, 8);
      return;
    }
    if (state.stage === 1) {
      var unresolvedEnemies = 0;
      for (var stageEnemyIndex = 0; stageEnemyIndex < enemies.length; stageEnemyIndex++) {
        var stageEnemy = enemies[stageEnemyIndex];
        if (!stageEnemy.dead && !stageEnemy.progressionLocked && distanceSquared(stageEnemy,player) < 176400) unresolvedEnemies++;
      }
      if (unresolvedEnemies > 0) {
        encounterDirector.cooldown = Math.max(encounterDirector.cooldown, 10);
        return;
      }
    }
    encounterDirector.cooldown-=dt;
    var healthPressure=1-player.health/Math.max(1,player.maxHealth);
    var exploration=Math.min(1,distance(player,HUB)/700);
    var performance=comboTier()*.22+instrumentMasteryRecord(state.equippedInstrument).level*.02;
    encounterDirector.tension+=dt*(.7+state.stage*.1+exploration*.35+performance-healthPressure*.28);
    var firstStageAssist = adaptiveFirstStageStrength();
    var requiredTension = state.stage === 1 ? 36 + firstStageAssist * 10 : 28;
    if(encounterDirector.cooldown>0||encounterDirector.tension<requiredTension||encounterDirector.activeEvent)return;
    var choices;
    if(healthPressure>.55)choices=['campfire','travelling-merchant','lost-explorer'];
    else if(rhythmCombo.count>=25)choices=['elite-patrol','band-rehearsal','treasure-caravan','music-festival'];
    else if(state.stage===1 && !firstStageProgressMilestone()) choices=['travelling-merchant','band-rehearsal','campfire','lost-explorer','rare-collectible'];
    else if(state.stage===1 && firstStageRuntime.zone==='standard') choices=['ambush','travelling-merchant','band-rehearsal','campfire','treasure-caravan','lost-explorer','rare-collectible'];
    else choices=['ambush','elite-patrol','travelling-merchant','band-rehearsal','campfire','treasure-caravan','lost-explorer','rare-collectible','secret-cave','meteor-strike','shrine-awakening'];
    if(state.stage===2)choices.push('forest-bloom');
    if(state.stage===3)choices.push('crystal-storm');
    if(state.stage===4)choices.push('ghost-procession','blood-moon');
    triggerWorldEvent(choices[Math.floor(Math.random()*choices.length)]);
  }

  function updateEnemies(dt) {
    var speedScale = difficultySpeed();
    var cooldownScale = stageEnemyScale().cooldown;
    var firstStageAssist = adaptiveFirstStageStrength();
    if (state.stage === 1) {
      speedScale *= FIRST_STAGE_BALANCE.enemyAggressionMultiplier - firstStageAssist * 0.08;
      cooldownScale *= FIRST_STAGE_BALANCE.attackCooldownMultiplier + firstStageAssist * 0.18;
    }
    var enemyCount = enemies.length;
    for (var enemyIndex = 0; enemyIndex < enemyCount; enemyIndex++) {
      var e = enemies[enemyIndex];
      if (e.dead) {
        releaseEnemyAttackSlot(e);
        if (typeof e.deathTimer === 'number') {
          e.deathTimer = Math.min(e.deathDuration || 1.3, e.deathTimer + dt);
          e.animTime = e.deathTimer;
        }
        continue;
      }
      var previousX = e.x;
      var previousY = e.y;
      e.animTime = (e.animTime || 0) + dt;
      e.animLock = Math.max(0, (e.animLock || 0) - dt);
      e.flash = Math.max(0, e.flash - dt);
      e.weaknessFlash = Math.max(0,(e.weaknessFlash || 0) - dt);
      e.armorBroken = Math.max(0,(e.armorBroken || 0) - dt);
      if (e.bleedTimer > 0) {
        e.bleedTimer -= dt;
        e.bleedTick -= dt;
        if (e.bleedTick <= 0) {
          e.bleedTick = 0.8;
          e.hp -= 1;
          state.statistics.damageDealt += 1;
          showFloat(e.x,e.y-18,'♪','#a9f58b');
          if (e.hp <= 0) {
            killEnemy(e);
            continue;
          }
        }
      }
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.contactCooldown = Math.max(0, (e.contactCooldown || 0) - dt);
      if (e.stun > 0) {
        e.stun -= dt;
        if (e.type === 'wisp' && e.stun <= 0) e.shielded = true;
        setAnimationState(e, 'stunned');
        continue;
      }
      var playerDx = player.x - e.x;
      var playerDy = player.y - e.y;
      var playerDistanceSq = playerDx * playerDx + playerDy * playerDy;
      var d = Math.sqrt(playerDistanceSq);
      var inverseDistance = d > 0.0001 ? 1 / d : 0;
      var toPlayerX = playerDx * inverseDistance;
      var toPlayerY = playerDy * inverseDistance;
      e.facing = Math.atan2(playerDy, playerDx);
      if (!e.introduced && d < 460) {
        e.introduced = true;
        e.spawnWarmup = state.stage === 1 ? FIRST_STAGE_BALANCE.enemySpawnWarmupSeconds : 0.85;
        setAnimationState(e, 'spawn', e.spawnWarmup);
      }
      if (e.spawnWarmup > 0) {
        e.spawnWarmup = Math.max(0, e.spawnWarmup - dt);
        releaseEnemyAttackSlot(e);
        if (d > 76) moveWithCollision(e,toPlayerX*12*dt,toPlayerY*12*dt);
        continue;
      }
      if (e.progressionLocked && firstStageProgressMilestone()) e.progressionLocked = false;
      if (state.stage === 1 && firstStageHostilesSuspended()) {
        e.disengageTimer = FIRST_STAGE_BALANCE.safeZoneDisengageDelaySeconds;
        returnEnemyHome(e,dt);
        continue;
      }
      if (e.disengageTimer > 0) {
        e.disengageTimer = Math.max(0,e.disengageTimer-dt);
        returnEnemyHome(e,dt);
        continue;
      }
      var homeDx = e.x - e.homeX;
      var homeDy = e.y - e.homeY;
      if ((state.stage === 1 && e.progressionLocked) ||
          (!e.isMiniBoss && d > (e.encounterZone === 'intro' ? 300 : e.encounterZone === 'standard' ? 390 : 480) &&
           homeDx * homeDx + homeDy * homeDy > 48400)) {
        returnEnemyHome(e,dt);
        continue;
      }
      if (state.stage === 1 && !e.isMiniBoss && !firstStageRuntime.attackSlots.has(e.id) &&
          firstStageRuntime.attackSlots.size >= firstStageAttackerLimit()) {
        if (d < 132) {
          moveWithCollision(e,-toPlayerX*46*dt,-toPlayerY*46*dt);
          setAnimationState(e,'walk');
        } else {
          setAnimationState(e,'idle');
        }
        continue;
      }
      if (e.isMiniBoss && e.cooldown <= 0 && d < 430 && claimEnemyAttackSlot(e)) {
        var rays=e.miniPattern==='storm'?10:e.miniPattern==='spores'?12:8;
        var projectileColor=e.miniColor||'#ffc857';
        if(e.miniPattern==='notes'){
          for(var noteRay=-2;noteRay<=2;noteRay++){
            var noteAngle=e.facing+noteRay*.18;
            fireProjectile(e.x,e.y,Math.cos(noteAngle)*185,Math.sin(noteAngle)*185,projectileColor,7,4,e.power);
          }
        }else{
          for(var miniRay=0;miniRay<rays;miniRay++){
            var miniAngle=miniRay*Math.PI*2/rays+e.angle;
            var miniSpeed=e.miniPattern==='tides'?115+(miniRay%2)*55:e.miniPattern==='storm'?205:135;
            fireProjectile(e.x,e.y,Math.cos(miniAngle)*miniSpeed,Math.sin(miniAngle)*miniSpeed,projectileColor,e.miniPattern==='spores'?9:6,4,e.power);
          }
        }
        e.cooldown=(settings.difficulty==='hard'?1.65:2.15)*cooldownScale;
        e.angle+=.37;
        setAnimationState(e, 'special', 0.62);
        showFloat(e.x,e.y-e.r-16,e.miniPattern.toUpperCase(),projectileColor);
      } else if (e.ai === 'support' && e.cooldown <= 0 && d < 340 && claimEnemyAttackSlot(e)) {
        var ally = null;
        for (var allyIndex = 0; allyIndex < enemies.length; allyIndex++) {
          var candidate = enemies[allyIndex];
          if (candidate.dead || candidate === e || candidate.hp >= candidate.maxHp) continue;
          var allyDx = candidate.x - e.x;
          var allyDy = candidate.y - e.y;
          if (allyDx * allyDx + allyDy * allyDy < 32400) { ally = candidate; break; }
        }
        if (ally) {
          ally.hp = Math.min(ally.maxHp,ally.hp + 1);
          for (var supportSpark=0;supportSpark<7;supportSpark++) spawnParticle(ally.x,ally.y,'#ffb454',45,2);
        } else {
          fireProjectile(e.x,e.y,toPlayerX*125,toPlayerY*125,'#ff9d57',8,4);
        }
        e.cooldown = 2.8 * cooldownScale;
        setAnimationState(e, 'special', 0.58);
      } else if (e.ai === 'storm' && e.cooldown <= 0 && d < 320 && claimEnemyAttackSlot(e)) {
        for (var stormRay=0;stormRay<6;stormRay++) {
          var stormAngle = stormRay * Math.PI / 3 + e.angle;
          fireProjectile(e.x,e.y,Math.cos(stormAngle)*135,Math.sin(stormAngle)*135,'#86e8ff',6,3.5);
        }
        e.cooldown = 2.5 * cooldownScale;
        setAnimationState(e, 'special', 0.58);
      } else if (e.ai === 'ambusher' && e.cooldown <= 0 && d > 100 && d < 260 && claimEnemyAttackSlot(e)) {
        e.x = clamp(player.x - toPlayerX * 92 + -toPlayerY * 34,30,WORLD.w-30);
        e.y = clamp(player.y - toPlayerY * 92 + toPlayerX * 34,30,WORLD.h-30);
        e.mode = 'windup';
        e.timer = 0.34;
        e.cooldown = 2.9;
        setAnimationState(e, 'spawn', 0.44);
        for (var ambushSpark=0;ambushSpark<9;ambushSpark++) spawnParticle(e.x,e.y,enemyColor(e),58,3);
      } else if (e.ai === 'splitter' && !e.splitTriggered &&
          (e.splitGeneration || 0) === 0 && e.hp <= Math.ceil(e.maxHp/2)) {
        // Split children are terminal. At 1 max HP they otherwise satisfy the
        // half-health check immediately and double the enemy list every frame.
        e.splitTriggered = true;
        var splitLimit = state.stage === 1 ? FIRST_STAGE_BALANCE.maximumActiveEnemies : MAX_ACTIVE_ENEMIES;
        var splitRoom = Math.max(0, splitLimit - activeEnemyCount());
        var splitChildCount = Math.min(2, splitRoom);
        var splitSpeciesIndex = typeof e.speciesIndex === 'number' ? e.speciesIndex : 4;
        for (var splitIndex = 0; splitIndex < splitChildCount; splitIndex++) {
          var side = splitIndex === 0 ? -1 : 1;
          var splitPlacement = findValidEnemySpawn(e,{
            radius:Math.max(10,e.r-5),
            baseRadius:28,
            radiusStep:18,
            angle:side < 0 ? Math.PI : 0,
            playerPosition:player,
            minimumPlayerDistance:state.stage === 1 ? 90 : 0,
            ignoreEnemy:e
          });
          if (!splitPlacement.position) continue;
          var spawn = makeEnemy(
            ['summon_' + e.id + '_' + splitIndex,'slime',splitPlacement.position.x,splitPlacement.position.y,e.group],
            splitSpeciesIndex
          );
          spawn.hp = spawn.maxHp = Math.max(1,Math.floor(e.maxHp/3));
          spawn.r = Math.max(10,e.r-5);
          spawn.elite = false;
          spawn.splitGeneration = 1;
          spawn.splitTriggered = true;
          prepareEnemyForSpawn(spawn,{fixed:false,playerPosition:player});
          enemies.push(spawn);
        }
        if (splitChildCount > 0) showFloat(e.x,e.y-24,'SPLIT!','#7df7a1');
      }
      if (e.type === 'thorn') {
        if (e.mode === 'windup') {
          e.timer -= dt;
          if (e.timer <= 0) {
            e.mode = 'lunge';
            e.timer = 0.28;
            var lungeSpeed = e.ai === 'charger' ? 380 : 310;
            e.vx = toPlayerX * lungeSpeed * speedScale * (e.stageScale || 1);
            e.vy = toPlayerY * lungeSpeed * speedScale * (e.stageScale || 1);
            setAnimationState(e, 'attack_a', 0.38);
          }
        } else if (e.mode === 'lunge') {
          moveWithCollision(e, e.vx * dt, e.vy * dt);
          e.timer -= dt;
          if (e.timer <= 0) { e.mode = 'idle'; e.cooldown = 1.1 * cooldownScale; }
        } else if (d < 250) {
          if (d < 72 && e.cooldown <= 0 && claimEnemyAttackSlot(e)) {
            e.mode = 'windup';
            e.timer = 0.42 * (state.stage === 1 ? FIRST_STAGE_BALANCE.attackTelegraphMultiplier + firstStageAssist * 0.18 : 1);
            setAnimationState(e, 'attack_a', e.timer);
          } else {
            var stalkSpeed = e.ai === 'guardian' ? 42 : e.ai === 'skirmisher' ? 76 : 58;
            moveWithCollision(e,
              toPlayerX * stalkSpeed * speedScale * (e.stageScale || 1) * dt,
              toPlayerY * stalkSpeed * speedScale * (e.stageScale || 1) * dt);
          }
        }
      } else if (e.type === 'buzz') {
        e.angle += dt * 2.2;
        if (e.mode === 'dive') {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.timer -= dt;
          if (e.timer <= 0) { e.mode = 'orbit'; e.cooldown = 1.2 * cooldownScale; }
        } else if (d < 300) {
          var orbitX = player.x + Math.cos(e.angle) * 105;
          var orbitY = player.y + Math.sin(e.angle) * 76;
          e.x += clamp(orbitX - e.x, -100, 100) * dt * speedScale * (e.stageScale || 1);
          e.y += clamp(orbitY - e.y, -100, 100) * dt * speedScale * (e.stageScale || 1);
          if (e.cooldown <= 0 && d < 150 && claimEnemyAttackSlot(e)) {
            e.mode = 'dive';
            e.timer = 0.58;
            e.vx = toPlayerX * 225 * speedScale * (e.stageScale || 1);
            e.vy = toPlayerY * 225 * speedScale * (e.stageScale || 1);
            setAnimationState(e, 'attack_a', 0.58);
          }
        }
      } else if (e.type === 'slime') {
        if (d < 310 && e.cooldown <= 0 && claimEnemyAttackSlot(e)) {
          var slimeProjectileScale = state.stage === 1 ? FIRST_STAGE_BALANCE.projectileSpeedMultiplier : 1;
          fireProjectile(e.x, e.y, toPlayerX * 135 * speedScale * (e.projectileScale || 1) * slimeProjectileScale, toPlayerY * 135 * speedScale * (e.projectileScale || 1) * slimeProjectileScale, '#e86edf', 8, 4);
          e.cooldown = (settings.difficulty === 'hard' ? 1.45 : 1.9) * cooldownScale;
          setAnimationState(e, 'special', 0.48);
        }
        if (d < 160) {
          moveWithCollision(e, -toPlayerX * 24 * dt, -toPlayerY * 24 * dt);
        }
      } else if (e.type === 'wisp') {
        e.angle += dt * 1.8;
        e.x = e.homeX + Math.cos(e.angle) * 28;
        e.y = e.homeY + Math.sin(e.angle * 1.3) * 24;
        if (d < 330 && e.cooldown <= 0 && claimEnemyAttackSlot(e)) {
          var wispProjectileScale = state.stage === 1 ? FIRST_STAGE_BALANCE.projectileSpeedMultiplier : 1;
          for (var s = -1; s <= 1; s++) {
            var base = e.facing + s * 0.22;
            fireProjectile(e.x, e.y, Math.cos(base) * 155 * speedScale * (e.projectileScale || 1) * wispProjectileScale, Math.sin(base) * 155 * speedScale * (e.projectileScale || 1) * wispProjectileScale, '#82aaff', 6, 4);
          }
          e.cooldown = 2.25 * cooldownScale;
          setAnimationState(e, 'special', 0.58);
        }
      }
      e.x = clamp(e.x, 30, WORLD.w - 30);
      e.y = clamp(e.y, 30, WORLD.h - 30);
      if (state.stage === 1 && isFirstStageProtected(e,e.r + 8)) {
        var safeSpawn = firstStageSpawnPoint();
        var safeDirection = normalize(e.x-safeSpawn.x || 1,e.y-safeSpawn.y || 0);
        e.x = safeSpawn.x + safeDirection.x * (FIRST_STAGE_BALANCE.safeZoneRadius + e.r + 10);
        e.y = safeSpawn.y + safeDirection.y * (FIRST_STAGE_BALANCE.safeZoneRadius + e.r + 10);
        e.mode = 'idle';
        e.vx = e.vy = 0;
        releaseEnemyAttackSlot(e);
        continue;
      }
      if (e.animLock <= 0) {
        var movedSq = (e.x - previousX) * (e.x - previousX) + (e.y - previousY) * (e.y - previousY);
        setAnimationState(e, movedSq > 0.08 ? (e.mode === 'lunge' || e.mode === 'dive' ? 'run' : 'walk') : 'idle');
      }
      var contactDx = e.x - player.x;
      var contactDy = e.y - player.y;
      var contactRange = e.r + player.r + 2;
      if (e.contactCooldown <= 0 &&
          contactDx * contactDx + contactDy * contactDy < contactRange * contactRange &&
          claimEnemyAttackSlot(e)) {
        damagePlayer(e.power || 1, e.x, e.y);
        e.contactCooldown = state.stage === 1 ? 1.35 : 0.75;
      }
    }
  }

  function fireProjectile(x, y, vx, vy, color, r, life, damage) {
    if (projectiles.length >= MAX_ENEMY_PROJECTILES) return;
    if (state.stage === 1 && (firstStageHostilesSuspended() || isFirstStageProtected({x:x,y:y},r || 0))) return;
    var projectile = projectilePool.pop() || {};
    projectile.x = x;
    projectile.y = y;
    projectile.vx = vx;
    projectile.vy = vy;
    projectile.color = color;
    projectile.r = r;
    projectile.life = life || 4;
    projectile.damage = damage || (state.stage >= 4 ? 2 : 1);
    projectiles.push(projectile);
  }

  function recycleProjectile(index) {
    var projectile = projectiles[index];
    var lastProjectile = projectiles.pop();
    if (index < projectiles.length) projectiles[index] = lastProjectile;
    if (projectilePool.length < MAX_PROJECTILE_POOL) projectilePool.push(projectile);
  }

  function updateProjectiles(dt) {
    for (var projectileIndex = projectiles.length - 1; projectileIndex >= 0; projectileIndex--) {
      var p = projectiles[projectileIndex];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (state.stage === 1 && isFirstStageProtected(p,p.r || 0)) {
        recycleProjectile(projectileIndex);
        continue;
      }
      var projectileDx = p.x - player.x;
      var projectileDy = p.y - player.y;
      var projectileHitRadius = p.r + player.r;
      if (projectileDx * projectileDx + projectileDy * projectileDy < projectileHitRadius * projectileHitRadius) {
        damagePlayer(p.damage || 1, p.x, p.y);
        p.life = 0;
      }
      if (p.life <= 0 || p.x <= 0 || p.y <= 0 || p.x >= WORLD.w || p.y >= WORLD.h) {
        recycleProjectile(projectileIndex);
      }
    }
  }

  function updateParticles(dt) {
    for (var index = particles.length - 1; index >= 0; index--) {
      var p = particles[index];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.text) p.vy += 34 * dt;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.text) floatingTextCount = Math.max(0, floatingTextCount - 1);
        particles.splice(index, 1);
        if (particlePool.length < 180) particlePool.push(p);
      }
    }
  }

  function updateCamera(dt) {
    var targetX = clamp(player.x, W / 2, WORLD.w - W / 2);
    var targetY = clamp(player.y, H / 2, WORLD.h - H / 2);
    var factor = settings.reducedMotion ? 1 : 1 - Math.pow(0.001, dt);
    camera.x = lerp(camera.x, targetX, factor);
    camera.y = lerp(camera.y, targetY, factor);
  }

  var ODIN_COMMANDS = ['follow', 'attack', 'guard', 'fetch'];
  function cycleOdinCommand() {
    if (!state.odinRecruited) {
      showToast('NO COMPANION', 'Recruit Odin on the Afterglow road first.', '#8e9ba0', 2.4);
      return;
    }
    var index = ODIN_COMMANDS.indexOf(odin.command);
    recordFirstStageTutorial('odin');
    odin.command = ODIN_COMMANDS[(index + 1) % ODIN_COMMANDS.length];
    odin.target = null;
    odin.targetScanTimer = 0;
    var labels = {follow:'FOLLOW',attack:'HUNT',guard:'GUARD',fetch:'FETCH'};
    var details = {
      follow:'Odin stays close and attacks nearby threats.',
      attack:'Odin actively hunts enemies around you.',
      guard:'Odin holds close and protects your position.',
      fetch:state.skills.indexOf('odin-fetch') >= 0 ? 'Odin searches for nearby Glowweed and Heartblooms.' : 'Learn Keen Nose to collect items; Odin will still scout.'
    };
    audioCall('sfx', 'dialogue');
    showToast('ODIN: ' + labels[odin.command], details[odin.command], '#62c7ff', 2.7);
  }

  function nearestOdinEnemy(range) {
    if (firstStageHostilesSuspended()) return null;
    var best = null;
    var bestDistanceSq = range * range;
    for (var enemyIndex = 0; enemyIndex < enemies.length; enemyIndex++) {
      var enemy = enemies[enemyIndex];
      if (enemy.dead || enemy.progressionLocked || (state.stage === 1 && isFirstStageProtected(enemy,48))) continue;
      var dx = odin.x - enemy.x;
      var dy = odin.y - enemy.y;
      var distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        best = enemy;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  function odinTargetInRange(target, range) {
    if (!target || target.dead || target.progressionLocked || firstStageHostilesSuspended()) return false;
    var dx = odin.x - target.x;
    var dy = odin.y - target.y;
    return dx * dx + dy * dy < range * range;
  }

  function nearestOdinPickup(range) {
    var best = null;
    var bestDistance = range;
    if (state.skills.indexOf('odin-fetch') < 0) return null;
    weeds.forEach(function (weed) {
      if (state.weeds.indexOf(weed.id) >= 0) return;
      var d = distance(odin, weed);
      if (d < bestDistance) { best = {type:'weed', item:weed}; bestDistance = d; }
    });
    healthPickups.forEach(function (heart) {
      var d = distance(odin, heart);
      if (d < bestDistance) { best = {type:'heart', item:heart}; bestDistance = d; }
    });
    return best;
  }

  function updateOdin(dt) {
    if (!state.odinRecruited) return;
    odin.animTime = (odin.animTime || 0) + dt;
    odin.activityTimer = Math.max(0, (odin.activityTimer || 0) - dt);
    if (odin.activityTimer <= 0) odin.activity = '';
    odin.idleActionCooldown = Math.max(0, (odin.idleActionCooldown || 0) - dt);
    odin.biteCooldown = Math.max(0, odin.biteCooldown - dt);
    odin.pounceCooldown = Math.max(0, odin.pounceCooldown - dt);
    odin.howlCooldown = Math.max(0, odin.howlCooldown - dt);
    odin.guardianCooldown = Math.max(0, odin.guardianCooldown - dt);
    odin.spiritTimer = Math.max(0, odin.spiritTimer - dt);
    odin.attackFlash = Math.max(0, odin.attackFlash - dt);
    odin.targetScanTimer = Math.max(0, odin.targetScanTimer - dt);

    var target = null;
    var pickup = null;
    if (odin.command === 'fetch') pickup = nearestOdinPickup(520);
    if (!pickup) {
      var huntRange = odin.command === 'attack' ? 430 : odin.command === 'guard' ? 190 : 260;
      if (!odinTargetInRange(odin.target, huntRange + 28)) {
        odin.target = null;
        odin.targetScanTimer = 0;
      }
      if (odin.targetScanTimer <= 0) {
        odin.target = nearestOdinEnemy(huntRange);
        odin.targetScanTimer = ODIN_TARGET_SCAN_INTERVAL;
      }
      target = odin.target;
    }

    if (player.moveX || player.moveY) {
      var desiredFollowAngle = Math.atan2(player.moveY, player.moveX);
      odin.followAngle += clamp(angleDelta(desiredFollowAngle, odin.followAngle), -6 * dt, 6 * dt);
    }

    var bossTarget = !target && !pickup && boss && !boss.dead &&
      (odin.command === 'attack' || distance(odin, boss) < 180);
    var goalX = player.x - Math.cos(odin.followAngle) * 46;
    var goalY = player.y - Math.sin(odin.followAngle) * 46;
    if (target) { goalX = target.x; goalY = target.y; }
    if (pickup) { goalX = pickup.item.x; goalY = pickup.item.y; }
    if (bossTarget) { goalX = boss.x; goalY = boss.y; }

    var dx = goalX - odin.x, dy = goalY - odin.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (distance(player, odin) > 620) {
      odin.x = player.x - Math.cos(odin.followAngle) * 46;
      odin.y = player.y - Math.sin(odin.followAngle) * 46;
      resetOdinVisuals();
      dx = goalX - odin.x;
      dy = goalY - odin.y;
      d = Math.sqrt(dx * dx + dy * dy) || 1;
    }
    var stopRange = target ? 39 : pickup ? 22 : bossTarget ? boss.r + 36 :
      (odin.command === 'guard' ? 34 : 58);
    var gap = Math.max(0, d - stopRange);
    var movedDistance = 0;
    if (gap > 0.02) {
      var spiritSpeed = odin.spiritTimer > 0 ? 1.55 : 1;
      var pursuitBoost = target || pickup || bossTarget ? 82 : 0;
      var speed = Math.min(300, pursuitBoost + gap * 5.2) * spiritSpeed;
      movedDistance = Math.min(gap, speed * dt);
      odin.x += dx / d * movedDistance;
      odin.y += dy / d * movedDistance;
      odin.facing = Math.atan2(dy, dx);
      odin.gait = (odin.gait + movedDistance * 0.19) % (Math.PI * 2);
    }
    odin.motionGrace = movedDistance > 0.08 ? 0.13 : Math.max(0, odin.motionGrace - dt);
    odin.moving = movedDistance > 0.08 || odin.motionGrace > 0;
    odin.sniffing = odin.attackFlash <= 0 && !odin.moving && (!!pickup || odin.command === 'fetch');
    if (!odin.moving && !target && !pickup && !bossTarget && !odin.activity && odin.idleActionCooldown <= 0) {
      var odinIdleHour = Math.floor((state.playSeconds / 60 * 3 + 8) % 24);
      var odinIdleActions = odinIdleHour >= 23 || odinIdleHour < 6 ?
        ['sleep','sit'] : ['sit','roll','happy','excited','drink','dig','play','celebrate'];
      odin.activity = odinIdleActions[Math.floor(state.playSeconds / 7) % odinIdleActions.length];
      odin.activityTimer = odin.activity === 'sleep' ? 2.6 : 1.35;
      odin.idleActionCooldown = 7.5;
      setAnimationState(odin, odin.activity);
    } else if (!odin.moving && target && odin.command === 'guard' && d <= 85 && !odin.activity) {
      odin.activity = 'growl';
      odin.activityTimer = 0.85;
      odin.idleActionCooldown = 3;
      setAnimationState(odin, 'growl');
    }
    if (odin.attackFlash <= 0 && !odin.activity) {
      setAnimationState(odin, odin.moving ? (movedDistance > 2.5 ? 'run' : 'walk') :
        odin.sniffing ? 'sniff' : odin.command === 'guard' ? 'guard' : 'idle');
    }
    d = Math.sqrt((goalX - odin.x) * (goalX - odin.x) + (goalY - odin.y) * (goalY - odin.y));

    if (pickup && d <= 28) {
      odin.activity = 'carry_item';
      odin.activityTimer = 0.8;
      setAnimationState(odin, 'carry_item');
      if (pickup.type === 'weed') collectWeed(pickup.item);
      else {
        var heartIndex = healthPickups.indexOf(pickup.item);
        if (heartIndex >= 0) {
          healthPickups.splice(heartIndex, 1);
          if (state.heartblooms < HEARTBLOOM_CAPACITY) {
            state.heartblooms++;
            state.statistics.healingItemsCollected++;
            showFloat(odin.x, odin.y - 25, 'FETCHED ♥', '#ff7892');
            updateHUD(); saveGame(true);
          }
        }
      }
    }

    if (target) {
      var pounceReady = state.skills.indexOf('odin-pounce') >= 0 && odin.pounceCooldown <= 0 && d > 95 && d < 270;
      if (pounceReady) {
        odin.x = target.x - Math.cos(odin.facing) * 24;
        odin.y = target.y - Math.sin(odin.facing) * 24;
        target.shielded = false;
        hitEnemy(target, state.skills.indexOf('odin-spirit') >= 0 ? 3 : 2, odin.x, odin.y, true);
        target.stun = Math.max(target.stun, 2.2);
        odin.pounceCooldown = state.skills.indexOf('odin-bond') >= 0 ? 6.5 : 8;
        triggerOdinAttack(0.42, 'dash');
        if (state.skills.indexOf('odin-spirit') >= 0) odin.spiritTimer = 7;
        audioCall('sfx', 'pulse');
        showFloat(target.x, target.y - 28, 'POUNCE!', '#62c7ff');
      } else if (d <= 58 && odin.biteCooldown <= 0) {
        var biteDamage = state.skills.indexOf('odin-bond') >= 0 ? 2 : 1;
        if (odin.spiritTimer > 0) biteDamage += 1;
        hitEnemy(target, biteDamage, odin.x, odin.y, true);
        target.stun = Math.max(target.stun, state.skills.indexOf('odin-bond') >= 0 ? 0.85 : 0.42);
        odin.biteCooldown = state.skills.indexOf('odin-bond') >= 0 ? 1.05 : 1.45;
        triggerOdinAttack(0.24);
      }
    } else if (bossTarget) {
      var bossDistance = distance(odin, boss);
      if (bossDistance <= boss.r + 42 && odin.biteCooldown <= 0 && !boss.shielded) {
        hitBoss(odin.spiritTimer > 0 ? 2 : 1, true);
        odin.biteCooldown = 1.5;
        triggerOdinAttack(0.24);
      }
    }

    if (state.skills.indexOf('odin-howl') >= 0 && odin.howlCooldown <= 0) {
      var nearby = 0;
      for (var nearbyIndex = 0; nearbyIndex < enemies.length && nearby < 2; nearbyIndex++) {
        var nearbyEnemy = enemies[nearbyIndex];
        if (nearbyEnemy.dead) continue;
        var nearbyDx = player.x - nearbyEnemy.x;
        var nearbyDy = player.y - nearbyEnemy.y;
        if (nearbyDx * nearbyDx + nearbyDy * nearbyDy < 62500) nearby++;
      }
      if (nearby >= 2 || (boss && !boss.dead && distance(player, boss) < 330)) {
        activeBuffs.odinHowlTimer = 8;
        activeBuffs.speedTimer = Math.max(activeBuffs.speedTimer, 8);
        odin.howlCooldown = 22;
        odin.activity = 'spirit_howl';
        odin.activityTimer = 1.2;
        setAnimationState(odin, 'spirit_howl');
        audioCall('sfx', 'quest');
        showToast('HOWL OF COURAGE', 'Movement and strike damage boosted for 8 seconds.', '#62c7ff', 2.8);
        for (var howlFx = 0; howlFx < 18; howlFx++) spawnParticle(odin.x, odin.y, '#62c7ff', 110, 3);
      }
    }
    updateOdinSpriteDirection(dt);
  }

  function updateBuffs(dt) {
    if (activeBuffs.speedTimer > 0) activeBuffs.speedTimer -= dt;
    if (activeBuffs.defenseTimer > 0) activeBuffs.defenseTimer -= dt;
    if (activeBuffs.mapTimer > 0) activeBuffs.mapTimer -= dt;
    if (activeBuffs.autoCollectTimer > 0) activeBuffs.autoCollectTimer -= dt;
    if (activeBuffs.odinHowlTimer > 0) activeBuffs.odinHowlTimer -= dt;
  }

  function update(dt) {
    updateToast(dt);
    updateBuffs(dt);
    pollGamepad();
    if (!started || paused || orientationBlocked || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || dialogue) return;
    state.playSeconds += dt;
    syncExpansionQuests(dt);
    updateRhythmCombo(dt);
    updatePlayer(dt);
    updateEquipmentVisual(dt);
    updateFirstStageBalance(dt);
    updateOdin(dt);
    updateAttacks(dt);
    updatePulses(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateHealthPickups(dt);
    updateHazards(dt);
    updateBoss(dt);
    updateEncounterDirector(dt);
    updateDreamEncore(dt);
    updateParticles(dt);
    updateCamera(dt);
    updateHUD();
    saveGame(false);
  }

  function beginBoss() {
    var def = bossDefForStage(state.stage);
    var maxHp = def.hp[settings.difficulty] || def.hp.standard;
    boss = {
      x: BOSS_CENTER.x,
      y: BOSS_CENTER.y,
      r: 48,
      stage: state.stage,
      defId: def.id,
      hp: maxHp,
      maxHp: maxHp,
      flash: 0,
      dead: false,
      shielded: false,
      challengeMode: false,
      sequenceMode: false,
      sequence: [],
      sequenceIndex: 0,
      thresholdIndex: 0,
      projectileCooldown: 1.2,
      hazardCooldown: 2.8,
      pulse: 0,
      angle: 0,
      weakPoints: [],
      weakOrbit: 0,
      surgesRemaining: 0,
      surgeTimer: 0,
      surgeReleaseTimer: 0,
      startedAt: state.playSeconds,
      facing:Math.PI, animState:'spawn', animTime:0, animLock:0.9,
      deathTimer:null, deathDuration:1.35
    };
    projectiles = [];
    hazards = [];
    player.health = player.maxHealth;
    player.invuln = 1.5;
    audioCall('sfx', 'boss');
    showToast(def.name, def.intro, def.color, 5);
    updateHUD();
  }

  function bossThresholds() {
    if (!boss) return [];
    return [Math.ceil(boss.maxHp * 0.66), Math.ceil(boss.maxHp * 0.33)];
  }

  function startBossChallenge() {
    if (!boss || boss.challengeMode || boss.dead) return;
    var def = bossDefForStage(boss.stage);
    boss.challengeMode = true;
    boss.sequenceMode = def.mechanic === 'sequence';
    boss.shielded = true;
    setAnimationState(boss, 'special', 0.8);
    bossPadLatch = null;
    boss.weakPoints = [];
    if (def.mechanic === 'sequence') {
      var sequence = state.melody.filter(function (n) { return n !== '-'; }).slice(0, 4);
      NOTE_ORDER.forEach(function (n) {
        if (sequence.length < 4 && sequence.indexOf(n) < 0) sequence.push(n);
      });
      boss.sequence = sequence.slice(0, 4);
      boss.sequenceIndex = 0;
      showToast('CORE SHIELDED', 'Step on: ' + boss.sequence.join('  →  '), def.shieldColor, 4);
    } else if (def.mechanic === 'root-knots') {
      [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6].forEach(function (angle, index) {
        boss.weakPoints.push({
          id:'root-knot-' + index,
          x:boss.x + Math.cos(angle) * 170,
          y:boss.y + Math.sin(angle) * 170,
          angle:angle,
          broken:false
        });
      });
      showToast('ROOT SHIELD', 'Move close and Echo Pulse all three glowing knots.', def.shieldColor, 4.2);
    } else if (def.mechanic === 'prism-shards') {
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(function (angle, index) {
        boss.weakPoints.push({
          id:'prism-shard-' + index,
          x:boss.x + Math.cos(angle) * 155,
          y:boss.y + Math.sin(angle) * 155,
          angle:angle,
          broken:false
        });
      });
      showToast('PRISM BARRIER', 'Strike all four orbiting shards to expose the choir.', def.shieldColor, 4.2);
    } else {
      boss.surgesRemaining = 3;
      boss.surgeTimer = 0.72;
      boss.surgeReleaseTimer = 0;
      showToast('MOON-TIDE RISING', 'Dodge three surges—or Echo Pulse the open core.', def.shieldColor, 4.2);
    }
    audioCall('sfx', 'boss');
  }

  function completeBossChallenge(message) {
    if (!boss || !boss.challengeMode) return;
    boss.challengeMode = false;
    boss.sequenceMode = false;
    boss.shielded = false;
    boss.thresholdIndex++;
    boss.projectileCooldown = 1.25;
    boss.hazardCooldown = 2.15;
    boss.pulse = 1;
    boss.weakPoints = [];
    bossPadLatch = null;
    audioCall('sfx', 'unlock');
    showToast(message || 'SHIELD BROKEN', 'The core is exposed!', bossDefForStage(boss.stage).color, 2.8);
    shake = 8;
  }

  function pulseBossChallenge() {
    if (!boss || !boss.challengeMode || boss.dead) return;
    var def = bossDefForStage(boss.stage);
    var pulseRange = state.skills.indexOf('wide-pulse') >= 0 ? 155 : 128;
    if (def.mechanic === 'root-knots') {
      boss.weakPoints.forEach(function (point) {
        if (point.broken || distance(player, point) > pulseRange) return;
        point.broken = true;
        audioCall('previewNote', NOTE_ORDER[boss.weakPoints.indexOf(point)] || 'C');
        showFloat(point.x, point.y - 20, 'KNOT RELEASED', '#d8d66b');
        for (var i = 0; i < 20; i++) spawnParticle(point.x, point.y, '#d8d66b', 95, 4);
      });
      if (boss.weakPoints.length && boss.weakPoints.every(function (point) { return point.broken; })) {
        completeBossChallenge('ROOT SHIELD BROKEN');
      }
    } else if (def.mechanic === 'tide-surges' && distance(player, boss) < pulseRange + boss.r) {
      boss.surgesRemaining = Math.max(0, boss.surgesRemaining - 1);
      boss.surgeTimer = Math.max(boss.surgeTimer, 0.7);
      showFloat(boss.x, boss.y - 64, 'SURGE CUT', '#86eff1');
      for (var p = 0; p < 22; p++) spawnParticle(boss.x, boss.y, '#86eff1', 115, 4);
      if (boss.surgesRemaining <= 0) completeBossChallenge('TIDE SHIELD BROKEN');
    }
  }

  function hitBossWeakPoints(attack) {
    if (!boss || !boss.challengeMode || bossDefForStage(boss.stage).mechanic !== 'prism-shards') return;
    boss.weakPoints.forEach(function (point) {
      if (point.broken || attack.hit.has(point.id)) return;
      var d = distance(attack, point);
      var hit = attack.charged ? d < 102 : d < 76 &&
        Math.abs(angleDelta(Math.atan2(point.y - attack.y, point.x - attack.x), attack.angle)) < 1.15;
      if (!hit) return;
      attack.hit.add(point.id);
      point.broken = true;
      state.statistics.damageDealt++;
      showFloat(point.x, point.y - 20, 'PRISM SHATTERED', '#9de8ff');
      audioCall('sfx', 'enemyHit');
      for (var i = 0; i < 18; i++) spawnParticle(point.x, point.y, '#9de8ff', 110, 4);
    });
    if (boss.weakPoints.length && boss.weakPoints.every(function (point) { return point.broken; })) {
      completeBossChallenge('PRISM BARRIER SHATTERED');
    }
  }

  function bossPads() {
    return [
      { note: 'C', x: BOSS_CENTER.x, y: BOSS_CENTER.y - 178 },
      { note: 'E', x: BOSS_CENTER.x + 178, y: BOSS_CENTER.y },
      { note: 'G', x: BOSS_CENTER.x, y: BOSS_CENTER.y + 178 },
      { note: 'B', x: BOSS_CENTER.x - 178, y: BOSS_CENTER.y }
    ];
  }

  function updateBossSequence() {
    if (!boss || !boss.sequenceMode) return;
    var pads = bossPads();
    var touching = null;
    for (var i = 0; i < pads.length; i++) {
      if (distance(player, pads[i]) < 34) {
        touching = pads[i].note;
        break;
      }
    }
    if (!touching) {
      bossPadLatch = null;
      return;
    }
    if (bossPadLatch === touching) return;
    bossPadLatch = touching;
    var expected = boss.sequence[boss.sequenceIndex];
    if (touching === expected) {
      boss.sequenceIndex++;
      audioCall('previewNote', touching);
      for (var p = 0; p < 18; p++) {
        var pad = pads.find(function (item) { return item.note === touching; });
        spawnParticle(pad.x, pad.y, NOTE_COLORS[touching], 85, 4);
      }
      showFloat(player.x, player.y - 28, touching + '  ✓', NOTE_COLORS[touching]);
      if (boss.sequenceIndex >= boss.sequence.length) {
        completeBossChallenge('FEEDBACK BROKEN');
      }
    } else {
      boss.sequenceIndex = 0;
      audioCall('sfx', 'error');
      showFloat(player.x, player.y - 28, 'RESET', '#ff7892');
      damagePlayer(1, boss.x, boss.y);
    }
  }

  function updateBossChallenge(dt) {
    if (!boss || !boss.challengeMode) return;
    var def = bossDefForStage(boss.stage);
    if (def.mechanic === 'sequence') {
      updateBossSequence();
    } else if (def.mechanic === 'prism-shards') {
      boss.weakOrbit += dt * (settings.difficulty === 'hard' ? 1.05 : 0.78);
      boss.weakPoints.forEach(function (point) {
        var angle = point.angle + boss.weakOrbit;
        point.x = boss.x + Math.cos(angle) * 155;
        point.y = boss.y + Math.sin(angle) * 155;
      });
    } else if (def.mechanic === 'tide-surges') {
      boss.surgeTimer -= dt;
      if (boss.surgesRemaining > 0 && boss.surgeTimer <= 0) {
        var count = settings.difficulty === 'hard' ? 18 : 14;
        var speed = settings.difficulty === 'story' ? 112 : 132;
        for (var i = 0; i < count; i++) {
          var angle = boss.angle + i / count * Math.PI * 2;
          fireProjectile(boss.x + Math.cos(angle) * 54, boss.y + Math.sin(angle) * 54,
            Math.cos(angle) * speed, Math.sin(angle) * speed, def.projectileColor, 8, 4.7);
        }
        boss.surgesRemaining--;
        boss.surgeTimer = 1.55;
        boss.surgeReleaseTimer = boss.surgesRemaining === 0 ? 1.25 : 0;
        audioCall('sfx', 'boss');
        showFloat(boss.x, boss.y - 64, 'TIDE SURGE ' + (3 - boss.surgesRemaining) + '/3', '#86eff1');
      } else if (boss.surgesRemaining === 0 && boss.surgeReleaseTimer > 0) {
        boss.surgeReleaseTimer -= dt;
        if (boss.surgeReleaseTimer <= 0) completeBossChallenge('TIDE SHIELD BROKEN');
      }
    }
  }

  function fireBossPattern() {
    var def = bossDefForStage(boss.stage);
    var hard = settings.difficulty === 'hard';
    var story = settings.difficulty === 'story';
    if (boss.stage === 1) {
      var count = boss.hp < boss.maxHp / 2 ? 10 : 8;
      for (var i = 0; i < count; i++) {
        var angle = boss.angle + i / count * Math.PI * 2;
        var speed = hard ? 175 : 145;
        fireProjectile(boss.x + Math.cos(angle) * 45, boss.y + Math.sin(angle) * 45,
          Math.cos(angle) * speed, Math.sin(angle) * speed, def.projectileColor, 7, 4.5);
      }
      boss.projectileCooldown = boss.challengeMode ? 2.6 : (boss.hp < boss.maxHp / 2 ? 1.65 : 2.15);
    } else if (boss.stage === 2) {
      var aim = Math.atan2(player.y - boss.y, player.x - boss.x);
      for (var fan = -2; fan <= 2; fan++) {
        var fanAngle = aim + fan * 0.18;
        fireProjectile(boss.x, boss.y, Math.cos(fanAngle) * (story ? 120 : 150),
          Math.sin(fanAngle) * (story ? 120 : 150), def.projectileColor, 8, 4.4);
      }
      if (boss.hp < boss.maxHp / 2) {
        for (var root = 0; root < 6; root++) {
          var rootAngle = boss.angle + root * Math.PI / 3;
          fireProjectile(boss.x, boss.y, Math.cos(rootAngle) * 105, Math.sin(rootAngle) * 105, '#c9d66b', 7, 4.8);
        }
      }
      boss.projectileCooldown = boss.challengeMode ? 2.65 : (hard ? 1.45 : 1.85);
    } else if (boss.stage === 3) {
      var shards = boss.hp < boss.maxHp / 2 ? 14 : 10;
      for (var crystal = 0; crystal < shards; crystal++) {
        var crystalAngle = boss.angle + crystal / shards * Math.PI * 2;
        var crystalSpeed = (crystal % 2 ? 130 : 175) * (story ? 0.82 : hard ? 1.12 : 1);
        fireProjectile(boss.x, boss.y, Math.cos(crystalAngle) * crystalSpeed,
          Math.sin(crystalAngle) * crystalSpeed, crystal % 2 ? '#d77cff' : def.projectileColor, 7, 4.3);
      }
      boss.projectileCooldown = boss.challengeMode ? 2.5 : (hard ? 1.3 : 1.7);
    } else {
      var tideCount = boss.hp < boss.maxHp / 2 ? 13 : 10;
      for (var tide = 0; tide < tideCount; tide++) {
        var tideAngle = boss.angle * 1.35 + tide / tideCount * Math.PI * 2;
        fireProjectile(boss.x, boss.y, Math.cos(tideAngle) * (story ? 110 : 140),
          Math.sin(tideAngle) * (story ? 110 : 140), def.projectileColor, 8, 4.6);
      }
      var targetAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
      for (var stream = -1; stream <= 1; stream++) {
        var streamAngle = targetAngle + stream * 0.16;
        fireProjectile(boss.x, boss.y, Math.cos(streamAngle) * (hard ? 205 : 175),
          Math.sin(streamAngle) * (hard ? 205 : 175), '#c5f7ff', 6, 3.8);
      }
      boss.projectileCooldown = boss.challengeMode ? 2.75 : (hard ? 1.25 : 1.65);
    }
    audioCall('sfx', 'boss');
  }

  function createBossHazards() {
    var def = bossDefForStage(boss.stage);
    if (boss.stage === 1) {
      hazards.push({x:player.x,y:player.y,r:46,timer:0.9,active:0.24,hit:false,color:def.color,fillColor:'#7f2948'});
      if (boss.hp < boss.maxHp / 2) {
        var side = Math.random() > 0.5 ? 1 : -1;
        hazards.push({x:player.x + side * 92,y:player.y - 30,r:38,timer:1.08,active:0.24,hit:false,color:def.color,fillColor:'#7f2948'});
      }
    } else if (boss.stage === 2) {
      for (var root = -1; root <= 1; root++) {
        hazards.push({x:player.x + root * 64,y:player.y + Math.abs(root) * 24,r:34,timer:0.86 + Math.abs(root) * 0.12,active:0.3,hit:false,color:'#d8c35e',fillColor:'#786330'});
      }
    } else if (boss.stage === 3) {
      [[0,0],[68,0],[-68,0],[0,68],[0,-68]].forEach(function (offset, index) {
        hazards.push({x:player.x + offset[0],y:player.y + offset[1],r:index ? 27 : 36,timer:0.72 + index * 0.08,active:0.22,hit:false,color:'#9de8ff',fillColor:'#4165a0'});
      });
    } else {
      hazards.push({x:player.x,y:player.y,r:58,timer:1.02,active:0.32,hit:false,color:'#61d8c8',fillColor:'#276b7d'});
      var side = Math.random() > 0.5 ? 1 : -1;
      hazards.push({x:player.x + side * 105,y:player.y,r:42,timer:1.18,active:0.3,hit:false,color:'#86cfff',fillColor:'#315b83'});
    }
    boss.hazardCooldown = boss.challengeMode ? 3.35 : (boss.stage >= 3 ? 2.35 : 2.75);
  }

  function hitBoss(damage, lightweightEffects) {
    if (!boss || boss.dead) return;
    if (boss.shielded) {
      audioCall('sfx', 'error');
      var mechanic = bossDefForStage(boss.stage).mechanic;
      var shieldHint = mechanic === 'sequence' ? 'PLAY THE PADS' :
        mechanic === 'root-knots' ? 'PULSE THE KNOTS' :
        mechanic === 'prism-shards' ? 'BREAK THE PRISMS' : 'DODGE OR PULSE';
      showFloat(boss.x, boss.y - 58, shieldHint, bossDefForStage(boss.stage).shieldColor);
      return;
    }
    if (boss.flash > 0) return;
    if (activeBuffs.bossBane) {
      damage = Math.floor(damage * 1.5);
      activeBuffs.bossBane = false;
      showFloat(boss.x, boss.y - 70, 'BOSS BANE!', '#ff7892');
    }
    state.statistics.damageDealt += Math.min(boss.hp, damage);
    boss.hp -= damage;
    boss.flash = 0.13;
    boss.pulse = 0.35;
    setAnimationState(boss, 'hurt', 0.18);
    audioCall('sfx', 'enemyHit');
    shake = damage > 1 ? 7 : 4;
    var hitParticleCount = lightweightEffects ? 6 : 12;
    for (var i = 0; i < hitParticleCount; i++) spawnParticle(boss.x, boss.y, bossDefForStage(boss.stage).color, 95, 4);
    if (boss.hp <= 0) finishBoss();
  }

  function updateBoss(dt) {
    if (boss && boss.dead) {
      if (typeof boss.deathTimer === 'number') {
        boss.deathTimer = Math.min(boss.deathDuration || 1.35, boss.deathTimer + dt);
        boss.animTime = boss.deathTimer;
      }
      return;
    }
    if (bossDefeatedForStage(state.stage)) return;
    if (!boss && bossPrerequisiteMet(state.stage) && distance(player, BOSS_CENTER) < 305) beginBoss();
    if (!boss || boss.dead) return;
    boss.animTime = (boss.animTime || 0) + dt;
    boss.animLock = Math.max(0, (boss.animLock || 0) - dt);
    boss.facing = Math.atan2(player.y - boss.y, player.x - boss.x);
    boss.flash = Math.max(0, boss.flash - dt);
    boss.pulse = Math.max(0, boss.pulse - dt);
    boss.angle += dt * (boss.challengeMode ? 0.68 : 1.35);
    updateBossChallenge(dt);
    var thresholds = bossThresholds();
    if (!boss.challengeMode && boss.thresholdIndex < thresholds.length && boss.hp <= thresholds[boss.thresholdIndex]) {
      startBossChallenge();
      return;
    }
    boss.projectileCooldown -= dt;
    boss.hazardCooldown -= dt;
    if (boss.projectileCooldown <= 0) {
      setAnimationState(boss, 'attack_a', 0.65);
      fireBossPattern();
    }
    if (boss.hazardCooldown <= 0) {
      createBossHazards();
    }
    if (boss.animLock <= 0) setAnimationState(boss, boss.challengeMode ? 'special' : 'idle');
    if (distance(player, boss) < player.r + boss.r + 4) damagePlayer(1, boss.x, boss.y);
  }

  function updateHazards(dt) {
    for (var hazardIndex = hazards.length - 1; hazardIndex >= 0; hazardIndex--) {
      var h = hazards[hazardIndex];
      if (h.timer > 0) {
        h.timer -= dt;
      } else {
        h.active -= dt;
        var hazardDx = player.x - h.x;
        var hazardDy = player.y - h.y;
        var hazardHitRadius = h.r + player.r;
        if (!h.hit && hazardDx * hazardDx + hazardDy * hazardDy < hazardHitRadius * hazardHitRadius) {
          h.hit = true;
          damagePlayer(1, h.x, h.y);
        }
      }
      if (h.active <= 0) {
        var lastHazard = hazards.pop();
        if (hazardIndex < hazards.length) hazards[hazardIndex] = lastHazard;
      }
    }
  }

  function finishBoss() {
    if (!boss) return;
    var def = bossDefForStage(boss.stage);
    var defeatedStage = boss.stage;
    boss.hp = 0;
    boss.dead = true;
    boss.deathTimer = 0;
    setAnimationState(boss, 'death');
    if (state.stageBosses.indexOf(def.id) < 0) state.stageBosses.push(def.id);
    if (defeatedStage === 1) state.bossDefeated = true;
    state.skillPoints += 2;
    state.beatcoins += 8;
    state.statistics.beatcoinsEarned += 8;
    gainInstrumentMastery(28);
    gainProfessionXp('bossHunting',32,'Defeating ' + def.name);
    addCraftingMaterial('echoCore',3);
    state.regionalReputation[regionIdForStage(defeatedStage)] =
      clamp(state.regionalReputation[regionIdForStage(defeatedStage)] + 12,0,100);
    if(defeatedStage===1){
      state.home.unlocked=true;
      if(state.discoveredLocations.indexOf('player-home')<0)state.discoveredLocations.push('player-home');
      unlockInstrument('bass','The Nullspeaker leaves behind a heavy low-frequency core.');
    }else if(defeatedStage===2)unlockInstrument('drums','The Colossus releases the ancient Rootsong sticks.');
    else if(defeatedStage===3)unlockInstrument('synth','The Prism Choir condenses into a playable synth circuit.');
    else if(defeatedStage===4)unlockInstrument('violin','Moonwake gifts a tidewood violin for the final song.');
    refreshHomeProgress();
    var clearTime = Math.max(0.1, state.playSeconds - boss.startedAt);
    var previousBest = state.statistics.bestBossTimes[def.id];
    if (!previousBest || clearTime < previousBest) state.statistics.bestBossTimes[def.id] = clearTime;
    projectiles = [];
    hazards = [];
    audioCall('sfx', 'win');
    for (var i = 0; i < 80; i++) {
      var color = NOTE_COLORS[NOTE_ORDER[i % NOTE_ORDER.length]];
      spawnParticle(boss.x, boss.y, color, 165, 5);
    }
    shake = 12;
    saveGame(true);
    updateHUD();
    showToast(def.name + ' DEFEATED', def.victory + ' · +2 skill points · +8 Beatcoins', '#f6e36d', 4.6);
    syncExpansionQuests(99);
    if (defeatedStage === 1) {
      setTimeout(function () {
        paused = true;
        var title = byId('endingTitle');
        var text = byId('endingText');
        if (title) title.textContent = 'MOSSVALE, IN FULL COLOR';
        if (text) {
          var harvest = state.weeds.length === 30 ?
            'Jimbo raises the golden bloom. Every plant in the grove answers your rhythm.' :
            'Jimbo counts ' + state.weeds.length + ' bright sprigs and insists the rest are “encore material.”';
          text.textContent = 'Blu bends the high notes, EEMS drops the beat, and your eight-step melody rolls through the trees. ' +
            harvest + ' You restored all four notes in ' + formatTime(state.playSeconds) + '.';
        }
        setHidden(byId('endingScreen'), false);
        if(byId('replayButton'))byId('replayButton').textContent='Continue to Rootsong';
        setOverlayIsolation('ending', 'endingScreen', true);
        audioCall('pause', false);
        focusSoon('replayButton');
      }, settings.reducedMotion ? 350 : 1500);
    } else if (defeatedStage === 4 && !campaignFinaleShown) {
      window.setTimeout(showCampaignFinale, settings.reducedMotion ? 450 : 1300);
    }
  }

  function formatTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function isVisible(x, y, margin) {
    margin = margin || 80;
    return x > camera.x - W / 2 - margin && x < camera.x + W / 2 + margin &&
      y > camera.y - H / 2 - margin && y < camera.y + H / 2 + margin;
  }

  function drawGround() {
    var palette = currentLevel.palette;
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    function paintZone(x, y, rx, ry, inner, middle) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      var zone = ctx.createRadialGradient(0, 0, rx * 0.16, 0, 0, rx);
      zone.addColorStop(0, inner);
      zone.addColorStop(0.66, middle);
      zone.addColorStop(1, palette.fade);
      ctx.fillStyle = zone;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    currentLevel.zones.forEach(function (z) { paintZone(z[0],z[1],z[2],z[3],z[4],z[5]); });

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var routes = currentLevel.routes;
    function traceRoutes() {
      ctx.beginPath();
      routes.forEach(function (r) {
        ctx.moveTo(r[0], r[1]);
        ctx.quadraticCurveTo(r[2], r[3], r[4], r[5]);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = palette.routeOuter;
    ctx.lineWidth = 68;
    traceRoutes();
    ctx.strokeStyle = palette.route;
    ctx.lineWidth = 35;
    traceRoutes();
    ctx.strokeStyle = palette.routeGlow;
    ctx.lineWidth = 3;
    traceRoutes();
    routes.forEach(function (r, routeIndex) {
      for (var step = 1; step < 13; step++) {
        var t = step / 13;
        var u = 1 - t;
        var x = u * u * r[0] + 2 * u * t * r[2] + t * t * r[4];
        var y = u * u * r[1] + 2 * u * t * r[3] + t * t * r[5];
        var dx = 2 * u * (r[2] - r[0]) + 2 * t * (r[4] - r[2]);
        var dy = 2 * u * (r[3] - r[1]) + 2 * t * (r[5] - r[3]);
        var tangent = normalize(dx, dy);
        var side = Math.sin(step * 8.7 + routeIndex * 2.1) * 9;
        x += -tangent.y * side;
        y += tangent.x * side;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = step % 3 === 0 ? 'rgba(208,189,139,0.32)' : 'rgba(43,55,45,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 6 + step % 4, 2.5 + step % 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    var arenaBoss = bossDefForStage(state.stage);
    ctx.strokeStyle = bossDefeatedForStage(state.stage) ? 'rgba(87,157,126,.55)' : 'rgba(56,39,72,.7)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(BOSS_CENTER.x, BOSS_CENTER.y, 330, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = bossDefeatedForStage(state.stage) ? '#7ce4d1' :
      bossPrerequisiteMet(state.stage) ? arenaBoss.shieldColor : '#59616c';
    ctx.lineWidth = 5;
    ctx.setLineDash([18, 14]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 22;
    ctx.strokeRect(18, 18, WORLD.w - 36, WORLD.h - 36);
  }

  function drawWater() {
    waterPools.forEach(function (p) {
      if (!isVisible(p.x, p.y, p.rx + 20)) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, p.ry / p.rx);
      var grad = ctx.createRadialGradient(-20, -20, 5, 0, 0, p.rx);
      grad.addColorStop(0, currentLevel.palette.waterA);
      grad.addColorStop(1, currentLevel.palette.waterB);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, p.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = currentLevel.palette.waterLine;
      ctx.lineWidth = 4;
      for (var i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * 30, Math.sin(nowTime * 2 + i) * 9, 24, 0.2, 2.7);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawDecorations() {
    decorations.forEach(function (d) {
      if (!isVisible(d.x, d.y, 12)) return;
      var sway = settings.reducedMotion ? 0 : Math.sin(nowTime * 1.6 + d.phase) * 1.4;
      if (d.kind === 'grass') {
        ctx.strokeStyle = currentLevel.palette.grass[d.tint % currentLevel.palette.grass.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y + 4);
        ctx.lineTo(d.x - 3 + sway, d.y - 4);
        ctx.moveTo(d.x + 1, d.y + 4);
        ctx.lineTo(d.x + 4 + sway, d.y - 5);
        ctx.stroke();
      } else if (d.kind === 'flower') {
        var colors = currentLevel.palette.flowers;
        ctx.fillStyle = colors[d.tint];
        ctx.fillRect(Math.round(d.x - 2), Math.round(d.y - 2), 4, 4);
        ctx.fillStyle = '#d8ffe5';
        ctx.fillRect(Math.round(d.x - 1), Math.round(d.y - 1), 2, 2);
      } else {
        if (drawSpriteCell('items', 3, 3, d.x, d.y + 5, 24 + d.tint * 2, 0.72, 0.82)) return;
        ctx.fillStyle = d.tint % 2 ? '#f08d67' : '#9c78db';
        ctx.beginPath();
        ctx.arc(d.x, d.y - 2, 4, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c9d6b1';
        ctx.fillRect(d.x - 1, d.y - 2, 2, 5);
      }
    });
  }

  function drawAmbientWildlife() {
    ctx.save();
    var count=settings.reducedMotion?4:10;
    for(var wildlife=0;wildlife<count;wildlife++){
      var baseX=(wildlife*337+state.stage*191)%WORLD.w;
      var baseY=(wildlife*211+state.stage*127)%WORLD.h;
      var x=baseX+Math.sin(nowTime*.55+wildlife)*38;
      var y=baseY+Math.cos(nowTime*.42+wildlife)*22;
      if(!isVisible(x,y,20))continue;
      if(state.stage===1){
        ctx.fillStyle=wildlife%2?'rgba(246,227,109,.72)':'rgba(125,247,161,.62)';
        ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=8;ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();
      }else if(state.stage===2){
        ctx.fillStyle='rgba(255,157,87,.35)';ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();
      }else if(state.stage===3){
        ctx.strokeStyle='rgba(210,244,255,.52)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x-3,y,4,3.6,5.7);ctx.arc(x+4,y,4,3.7,5.8);ctx.stroke();
      }else{
        ctx.fillStyle='rgba(134,232,255,.42)';ctx.beginPath();ctx.arc(x,y,2+Math.sin(nowTime*2+wildlife),0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawObstacles() {
    obstacles.forEach(function (o, index) {
      if (!isVisible(o.x, o.y, o.r + 25)) return;
      var obstacleStyle = currentLevel.palette.obstacle;
      if (obstacleStyle === 'crystal') {
        ctx.save();
        ctx.translate(o.x,o.y);
        ctx.fillStyle='rgba(4,10,28,.34)';ctx.beginPath();ctx.ellipse(10,o.r*.45,o.r*.58,o.r*.2,0,0,Math.PI*2);ctx.fill();
        var crystal=ctx.createLinearGradient(-o.r,-o.r,o.r,o.r);crystal.addColorStop(0,index%2?'#bdefff':'#e5c7ff');crystal.addColorStop(.5,'#6889d1');crystal.addColorStop(1,'#303d86');ctx.fillStyle=crystal;
        ctx.beginPath();ctx.moveTo(0,-o.r*.8);ctx.lineTo(o.r*.52,-o.r*.05);ctx.lineTo(o.r*.26,o.r*.62);ctx.lineTo(-o.r*.38,o.r*.48);ctx.lineTo(-o.r*.5,-o.r*.05);ctx.closePath();ctx.fill();
        ctx.strokeStyle='rgba(215,247,255,.62)';ctx.lineWidth=3;ctx.stroke();ctx.restore();return;
      }
      if (obstacleStyle === 'root') {
        ctx.fillStyle='rgba(8,9,4,.34)';ctx.beginPath();ctx.ellipse(o.x+8,o.y+o.r*.48,o.r*.7,o.r*.23,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#755b35';ctx.lineWidth=Math.max(8,o.r*.18);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(o.x,o.y+o.r*.45);ctx.lineTo(o.x-6,o.y-o.r*.25);ctx.moveTo(o.x,o.y+o.r*.28);ctx.lineTo(o.x-o.r*.48,o.y+o.r*.48);ctx.moveTo(o.x,o.y+o.r*.28);ctx.lineTo(o.x+o.r*.52,o.y+o.r*.46);ctx.stroke();
        ctx.fillStyle=index%2?'#4f5d2f':'#596638';ctx.beginPath();ctx.arc(o.x,o.y-o.r*.28,o.r*.58,0,Math.PI*2);ctx.fill();return;
      }
      if (obstacleStyle === 'coast') {
        ctx.fillStyle='rgba(3,15,22,.34)';ctx.beginPath();ctx.ellipse(o.x+8,o.y+o.r*.42,o.r*.66,o.r*.22,0,0,Math.PI*2);ctx.fill();
        var rock=ctx.createRadialGradient(o.x-o.r*.2,o.y-o.r*.35,4,o.x,o.y,o.r);rock.addColorStop(0,index%2?'#7fa69f':'#7794a2');rock.addColorStop(1,'#36505b');ctx.fillStyle=rock;ctx.beginPath();ctx.ellipse(o.x,o.y,o.r*.62,o.r*.56,-.16,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(160,235,220,.25)';ctx.lineWidth=3;ctx.stroke();return;
      }
      ctx.fillStyle = 'rgba(2, 13, 15, 0.35)';
      ctx.beginPath();
      ctx.ellipse(o.x + 10, o.y + o.r * 0.55, o.r * 0.74, o.r * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#553f34';
      ctx.fillRect(o.x - o.r * 0.13, o.y, o.r * 0.26, o.r * 0.72);
      var grad = ctx.createRadialGradient(o.x - o.r * 0.22, o.y - o.r * 0.22, 5, o.x, o.y, o.r);
      grad.addColorStop(0, index % 3 === 0 ? '#49845c' : '#3e7655');
      grad.addColorStop(0.65, '#295943');
      grad.addColorStop(1, '#173c35');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(o.x, o.y - o.r * 0.18, o.r * 0.74, 0, Math.PI * 2);
      ctx.arc(o.x - o.r * 0.38, o.y, o.r * 0.47, 0, Math.PI * 2);
      ctx.arc(o.x + o.r * 0.38, o.y, o.r * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(114, 199, 126, 0.22)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(o.x - o.r * 0.12, o.y - o.r * 0.28, o.r * 0.42, Math.PI, Math.PI * 1.8);
      ctx.stroke();
    });
  }

  function drawWeed(weed) {
    if (state.weeds.indexOf(weed.id) >= 0 || !isVisible(weed.x, weed.y, 25)) return;
    var bob = settings.reducedMotion ? 0 : Math.sin(nowTime * 3 + weed.x) * 2;
    ctx.save();
    ctx.translate(weed.x, weed.y + bob);
    ctx.shadowColor = '#7df7a1';
    ctx.shadowBlur = 12;
    if (drawSpriteCell('items', 0, 0, 0, 10, 45, 0.72)) {
      ctx.restore();
      return;
    }
    ctx.strokeStyle = '#b8ff9c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(0, -8);
    ctx.stroke();
    ctx.fillStyle = '#63d982';
    for (var i = -1; i <= 1; i++) {
      ctx.save();
      ctx.rotate(i * 0.65);
      ctx.beginPath();
      ctx.ellipse(0, -10, 4, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#d5ff86';
    ctx.beginPath();
    ctx.arc(0, -9, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStageToken(token) {
    if (state.stageTokens.indexOf(token.id) >= 0 || !isVisible(token.x,token.y,28)) return;
    var bob=settings.reducedMotion?0:Math.sin(nowTime*3+token.x)*3;
    ctx.save();ctx.translate(token.x,token.y+bob);ctx.shadowColor='#86e8ff';ctx.shadowBlur=15;
    ctx.fillStyle='#d7f7ef';ctx.beginPath();ctx.moveTo(-12,8);ctx.quadraticCurveTo(-15,-10,0,-14);ctx.quadraticCurveTo(15,-10,12,8);ctx.quadraticCurveTo(0,15,-12,8);ctx.fill();
    ctx.strokeStyle='#4f9fb4';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,1,7,-2.5,2.5);ctx.stroke();ctx.restore();
  }

  function drawCollectible(item) {
    if (state.collectibles.indexOf(item.id)>=0 || !isVisible(item.x,item.y,30)) return;
    var set=COLLECTIBLE_SETS[item.set];
    var bob=settings.reducedMotion?0:Math.sin(nowTime*3.2+item.x)*3;
    ctx.save();ctx.translate(item.x,item.y+bob);ctx.rotate(nowTime*0.45);ctx.shadowColor=set.color;ctx.shadowBlur=16;
    ctx.fillStyle=set.color;ctx.beginPath();
    for(var i=0;i<8;i++){var a=i*Math.PI/4;var r=i%2?7:13;var x=Math.cos(a)*r,y=Math.sin(a)*r;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.restore();
  }

  function drawShrine(shrine) {
    if (!isVisible(shrine.x, shrine.y, 80)) return;
    var found = state.notes.indexOf(shrine.note) >= 0;
    var color = NOTE_COLORS[shrine.note];
    ctx.save();
    ctx.translate(shrine.x, shrine.y);
    ctx.fillStyle = 'rgba(4, 16, 20, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 17, 55, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    if (drawSpriteCell('items', 3, 0, 0, 25, 104, 0.75, found ? 1 : 0.72)) {
      ctx.shadowColor = color;
      ctx.shadowBlur = found ? 18 : 6;
      ctx.fillStyle = found ? color : '#a1ada6';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(shrine.note, 0, 2);
      if (!settings.reducedMotion) {
        ctx.globalAlpha = 0.3 + Math.sin(nowTime * 2.5) * 0.1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 3, 46 + Math.sin(nowTime * 2) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#52645d';
    ctx.beginPath();
    ctx.arc(0, 4, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = found ? color : '#88948d';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#293d3a';
    ctx.beginPath();
    ctx.arc(0, 2, 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = color;
    ctx.shadowBlur = found ? 18 : 7;
    ctx.fillStyle = found ? color : '#a1ada6';
    ctx.font = 'bold 29px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shrine.note, 0, 1);
    if (!settings.reducedMotion) {
      ctx.globalAlpha = 0.35 + Math.sin(nowTime * 2.5) * 0.12;
      ctx.beginPath();
      ctx.arc(0, 2, 53 + Math.sin(nowTime * 2) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPuzzleObjects() {
    drums.forEach(function (d) {
      if (!isVisible(d.x, d.y, 40)) return;
      var active = state.drums.indexOf(d.id) >= 0;
      if (drawSpriteCell('items', 3, 1, d.x, d.y + 20, 70, 0.72, active ? 1 : 0.72)) {
        ctx.strokeStyle = active ? NOTE_COLORS[d.note] : '#758086';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 28 + (active && !settings.reducedMotion ? Math.sin(nowTime * 5) * 2 : 0), 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = '#262f38';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = active ? NOTE_COLORS[d.note] : '#758086';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = active ? NOTE_COLORS[d.note] : '#939b9b';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.note, d.x, d.y + 5);
    });
    speakers.forEach(function (s) {
      if (!isVisible(s.x, s.y, 45)) return;
      var active = state.speakers.indexOf(s.id) >= 0;
      if (drawSpriteCell('items', 3, 2, s.x, s.y + 20, 72, 0.72, active ? 1 : 0.7)) {
        ctx.strokeStyle = active ? '#d77cff' : '#596179';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 29 + (active && !settings.reducedMotion ? Math.sin(nowTime * 5) * 2 : 0), 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = '#151b2a';
      roundedRect(ctx, s.x - 22, s.y - 32, 44, 64, 7);
      ctx.fill();
      ctx.strokeStyle = active ? '#d77cff' : '#596179';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = active ? '#e39bff' : '#343c50';
      ctx.beginPath();
      ctx.arc(s.x, s.y + 8, 12 + (active && !settings.reducedMotion ? Math.sin(nowTime * 5) * 2 : 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = active ? '#62c7ff' : '#727a89';
      ctx.fillRect(s.x - 8, s.y - 21, 16, 6);
    });
  }

  function drawNpc(npc) {
    var position=npcWorldPosition(npc);
    if (!isVisible(position.x, position.y, 50)) return;
    ctx.save();
    ctx.translate(position.x, position.y);
    if (npc.id === 'brad') {
      ctx.fillStyle = '#6e3140';
      roundedRect(ctx, -42, 12, 84, 30, 5);
      ctx.fill();
      ctx.strokeStyle = '#e1b752';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#7df7a1';
      ctx.fillRect(-31, 20, 7, 10);
      ctx.fillStyle = '#62c7ff';
      ctx.fillRect(23, 18, 8, 12);
    }
    ctx.fillStyle = 'rgba(3, 10, 12, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 17, 19, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    var npcPerforming = dialogue && dialogue.speaker.toLowerCase() === npc.id;
    var npcAnimation = npcPerforming || position.activity === 'playing music' ? 'special' :
      position.activity === 'travelling' ? 'walk_east' : 'idle_south';
    var productionDrawn = drawProductionSprite(
      npc.spriteId || npc.id, npcAnimation, nowTime + (npc.x % 37) * 0.037,
      0, 21, npc.id === 'eems' ? 80 : 84
    );
    if (productionDrawn) {
      ctx.fillStyle = npc.color;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(npc.name, 0, -43);
      if (npc.ambient) {
        ctx.fillStyle='rgba(232,246,238,.72)';
        ctx.font='bold 7px monospace';
        ctx.fillText(position.activity.toUpperCase(),0,-33);
      }
      ctx.restore();
      return;
    }
    var atlasIndex=NAMED_NPC_ATLAS[npc.id];
    var customDrawn=atlasIndex!=null&&drawAtlasCell('named-npcs',6,2,0,atlasIndex,0,18,90,90,.73,1);
    if (customDrawn || drawSpriteCell(npc.id, npcPerforming ? 2 : 0, 0, 0, 17, npc.id === 'eems' ? 78 : 84, 0.72)) {
      ctx.fillStyle = npc.color;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(npc.name, 0, -39);
      if(customDrawn){
        ctx.fillStyle='rgba(232,246,238,.7)';
        ctx.font='bold 7px monospace';
        ctx.fillText(position.activity.toUpperCase(),0,-29);
      }
      ctx.restore();
      return;
    }
    if (npc.id === 'jimbo') {
      ctx.fillStyle = '#9d5b35';
      ctx.fillRect(-15, -4, 30, 24);
      ctx.fillStyle = '#ffb454';
      ctx.beginPath();
      ctx.arc(0, -9, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e7c26c';
      ctx.fillRect(-23, -13, 46, 6);
      ctx.fillRect(-14, -23, 28, 12);
      ctx.fillStyle = '#31443b';
      ctx.fillRect(10, 4, 11, 15);
    } else if (npc.id === 'eems') {
      ctx.fillStyle = '#6c3f91';
      roundedRect(ctx, -18, -18, 36, 32, 7);
      ctx.fill();
      ctx.strokeStyle = '#d77cff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#0e2731';
      ctx.fillRect(-12, -10, 24, 10);
      ctx.strokeStyle = '#62e4e7';
      ctx.beginPath();
      ctx.moveTo(-9, -5);
      ctx.lineTo(-4, -8);
      ctx.lineTo(1, -2);
      ctx.lineTo(7, -7);
      ctx.lineTo(10, -5);
      ctx.stroke();
      ctx.fillStyle = '#d77cff';
      ctx.beginPath();
      ctx.arc(-22, 0, 5, 0, Math.PI * 2);
      ctx.arc(22, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#2f6e9e';
      ctx.beginPath();
      ctx.arc(0, -8, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#77cfff';
      ctx.beginPath();
      ctx.arc(-9, -4, 10, 0, Math.PI * 2);
      ctx.arc(8, -3, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3d4b8a';
      ctx.fillRect(-12, 6, 24, 16);
      ctx.strokeStyle = '#dceeff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, -3);
      ctx.lineTo(19, 16);
      ctx.stroke();
    }
    ctx.fillStyle = npc.color;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(npc.name, 0, -34);
    ctx.restore();
  }

  function drawEnemy(e) {
    if (e.progressionLocked ||
        (e.dead && (typeof e.deathTimer !== 'number' || e.deathTimer >= (e.deathDuration || 1.3))) ||
        !isVisible(e.x, e.y, 145)) return;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.flash > 0) ctx.globalCompositeOperation = 'screen';
    var color = enemyColor(e);
    ctx.fillStyle = 'rgba(2, 8, 12, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, e.r, e.r * 0.9, e.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    var enemyColumn = e.flash > 0 ? 3 : (e.mode === 'idle' ? (Math.floor(nowTime * 4 + e.x) % 2) : (e.mode === 'wander' ? 1 : 2));
    if (e.elite) {
      var eliteColor = e.eliteColor || '#f6e36d';
      var elitePulse = settings.reducedMotion ? 0 : Math.sin(nowTime * 4 + e.x * 0.01) * 2;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = eliteColor;
      ctx.beginPath();
      ctx.arc(0, 0, e.r + 13 + elitePulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    var speciesSize = e.isMiniBoss ? 116 : e.elite ? 84 : (e.type === 'thorn' || e.type === 'slime' ? 74 : 68);
    var assetId = e.isMiniBoss ? e.assetId : e.elite ? e.eliteAssetId : e.speciesId;
    var animationName = e.dead ? 'death' : (e.animState || 'idle');
    if (animationName === 'idle' || animationName === 'walk' || animationName === 'run') {
      animationName += '_' + spriteDirection(e.facing);
    }
    var productionSize = e.isMiniBoss ? 148 : e.elite ? 112 : Math.max(72, speciesSize);
    var spriteDrawn = drawProductionSprite(
      assetId, animationName, e.dead ? e.deathTimer : e.animTime,
      0, e.r + 10, productionSize,
      e.type === 'wisp' ? WISP_ENEMY_DRAW_OPTIONS : ENEMY_DRAW_OPTIONS
    );
    if (!spriteDrawn) spriteDrawn = drawAtlasCell('expanded-enemy-species',6,4,e.atlasRow || 0,e.atlasCol || 0,
      0,e.r+8,speciesSize,speciesSize,0.72,e.type === 'wisp' ? 0.94 : 1);
    if (!spriteDrawn) spriteDrawn = drawSpriteCell('enemy', ENEMY_ROWS[e.type], enemyColumn, 0, e.r + 5,
      e.type === 'thorn' || e.type === 'slime' ? 67 : 62, 0.72, e.type === 'wisp' ? 0.92 : 1);
    if (!spriteDrawn && e.type === 'thorn') {
      ctx.fillStyle = color;
      for (var i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 4 + (e.mode === 'windup' ? nowTime * 3 : 0));
        ctx.beginPath();
        ctx.moveTo(0, -e.r - 9);
        ctx.lineTo(-5, -e.r + 3);
        ctx.lineTo(5, -e.r + 3);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3d1927';
      ctx.fillRect(-8, -2, 5, 5);
      ctx.fillRect(4, -2, 5, 5);
    } else if (!spriteDrawn && e.type === 'buzz') {
      var flap = settings.reducedMotion ? 5 : 5 + Math.sin(nowTime * 18) * 4;
      ctx.fillStyle = '#fff1a6';
      ctx.beginPath();
      ctx.ellipse(-12, -3, 11, flap, -0.3, 0, Math.PI * 2);
      ctx.ellipse(12, -3, 11, flap, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#33241c';
      ctx.fillRect(-5, -4, 3, 3);
      ctx.fillRect(3, -4, 3, 3);
    } else if (!spriteDrawn && e.type === 'slime') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-e.r, 9);
      ctx.quadraticCurveTo(-e.r - 2, -e.r, 0, -e.r);
      ctx.quadraticCurveTo(e.r + 2, -e.r, e.r, 9);
      ctx.quadraticCurveTo(8, 17, 0, 11);
      ctx.quadraticCurveTo(-8, 18, -e.r, 9);
      ctx.fill();
      ctx.fillStyle = '#1b2234';
      ctx.beginPath();
      ctx.arc(-6, -3, 3, 0, Math.PI * 2);
      ctx.arc(6, -3, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (!spriteDrawn) {
      ctx.globalAlpha = 0.84;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d9e4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 20, e.angle, e.angle + 4.6);
      ctx.stroke();
      if (e.shielded) {
        ctx.strokeStyle = '#d77cff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (spriteDrawn && e.type === 'wisp' && e.shielded) {
      ctx.strokeStyle = '#d77cff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!e.dead && e.stun > 0) {
      ctx.fillStyle = '#62c7ff';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('♫', 0, -e.r - 13);
    }
    var showHealth = !e.dead && (e.isMiniBoss || e.hp < e.maxHp || state.skills.indexOf('spectral-sight') >= 0 || state.purchases.indexOf('crystal-lens') >= 0);
    if (showHealth) {
      ctx.fillStyle = '#251b25';
      ctx.fillRect(-16, -e.r - 14, 32, 4);
      ctx.fillStyle = '#ff7892';
      ctx.fillRect(-16, -e.r - 14, 32 * (e.hp / e.maxHp), 4);
    }
    if (e.elite) {
      ctx.fillStyle = e.eliteColor || '#f6e36d';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((e.eliteName || 'ELITE').toUpperCase(),0,-e.r-20);
    }
    if (e.isMiniBoss) {
      ctx.fillStyle=e.miniColor||'#ffc857';
      ctx.font='bold 9px monospace';
      ctx.textAlign='center';
      ctx.fillText(e.name,0,-e.r-22);
    }
    ctx.restore();
  }

  function drawWorldEvent() {
    var event=encounterDirector.activeEvent;
    if(!event||!isVisible(event.x,event.y,75))return;
    var definition=WORLD_EVENT_DEFS[event.id];
    if(!definition)return;
    ctx.save();ctx.translate(event.x,event.y);
    var pulse=settings.reducedMotion?0:Math.sin(nowTime*3)*5;
    ctx.fillStyle='rgba(2,8,14,.52)';ctx.beginPath();ctx.ellipse(0,18,27,9,0,0,Math.PI*2);ctx.fill();
    ctx.shadowColor=definition.color;ctx.shadowBlur=20;
    ctx.strokeStyle=definition.color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,22+pulse,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='rgba(5,15,24,.9)';ctx.beginPath();ctx.arc(0,0,19,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=definition.color;ctx.font='bold 18px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(definition.icon,0,1);
    ctx.shadowBlur=0;ctx.fillStyle='#f1f7f4';ctx.font='bold 9px monospace';ctx.fillText(definition.name.toUpperCase(),0,-32);
    ctx.restore();
  }

  function drawMiniBossArenas() {
    enemies.forEach(function(enemy){
      if(!enemy.isMiniBoss||enemy.dead||enemy.progressionLocked||!isVisible(enemy.homeX,enemy.homeY,190))return;
      ctx.save();
      ctx.translate(enemy.homeX,enemy.homeY);
      ctx.strokeStyle=enemy.miniColor||'#ffc857';
      ctx.globalAlpha=distance(player,enemy)<310?.48:.18;
      ctx.lineWidth=3;
      ctx.setLineDash([16,12]);
      ctx.lineDashOffset=settings.reducedMotion?0:-nowTime*24;
      ctx.beginPath();ctx.arc(0,0,155,0,Math.PI*2);ctx.stroke();
      ctx.setLineDash([]);
      for(var rune=0;rune<8;rune++){
        var angle=rune*Math.PI/4;
        ctx.fillStyle=enemy.miniColor||'#ffc857';
        ctx.fillRect(Math.cos(angle)*155-2,Math.sin(angle)*155-2,4,4);
      }
      ctx.restore();
    });
  }

  function drawOnlineRemotePlayers() {
    for (var remoteIndex = 0; remoteIndex < onlineRemotePlayers.length; remoteIndex++) {
      var remote = onlineRemotePlayers[remoteIndex];
      if (remote.stage !== state.stage || !isVisible(remote.x,remote.y,90)) continue;
      ctx.save();
      ctx.translate(remote.x,remote.y);
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = 'rgba(2,8,10,.42)';
      ctx.beginPath();
      ctx.ellipse(0,15,15,6,0,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = remote.cosmetic === 'moonwake' ? '#86e8ff' :
        remote.cosmetic === 'skyglass' ? '#9de8ff' :
        remote.cosmetic === 'rootsong' ? '#ff9d57' : '#7df7a1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0,0,25,0,Math.PI*2);
      ctx.stroke();
      var remoteSwitching = remote.switching && remote.animationState === 'switch' && remote.switchProgress < 1;
      var remoteInstrumentId = remoteSwitching ?
        (remote.switchProgress < 0.5 ? remote.switchFrom : remote.switchTo) : remote.equipmentId;
      var remoteAnimation = remoteSwitching ? 'switch' :
        (remote.animationState || (remote.attacking ? 'attack' : (remote.moving ? 'walk' : 'idle')));
      var remotePose = resolveEquipmentPose(
        remoteInstrumentId,remoteAnimation,remote.facing,
        remote.animationElapsed,
        remoteSwitching ? remote.switchProgress : undefined,remote.legendary,remote.facingDirection
      );
      drawEquipmentLayer(remotePose,'rear',0.92);
      var remoteRow = remote.attacking ? 2 : (remote.moving ? 1 : 0);
      var drewRemote = drawSpriteCell('hero',remoteRow,facingColumn(remote.facing),0,20,76,0.73);
      if (drewRemote) {
        drawEquipmentLayer(remotePose,'front',0.92);
      }
      if (remote.odin) {
        drawProductionSprite('odin',(remote.moving ? 'walk_' : 'idle_') + spriteDirection(remote.facing),
          nowTime,remote.facing < 0 ? 28 : -28,22,46,{direction:spriteDirection(remote.facing),alpha:.82});
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f1f7f4';
      ctx.font = '700 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(remote.name,0,-36);
      ctx.fillStyle = remote.ping < 90 ? '#7df7a1' : remote.ping < 180 ? '#ffc857' : '#ff7892';
      ctx.font = '700 7px monospace';
      ctx.fillText(remote.ping + 'ms',0,-27);
      ctx.restore();
    }
  }

  function drawOnlineWorldPings() {
    for (var pingIndex = 0; pingIndex < onlineWorldPings.length; pingIndex++) {
      var ping = onlineWorldPings[pingIndex];
      if (ping.stage !== state.stage || !isVisible(ping.x,ping.y,110)) continue;
      ctx.save();
      ctx.translate(ping.x,ping.y);
      var pulse = settings.reducedMotion ? 0 : Math.sin(nowTime*7+pingIndex)*7;
      ctx.strokeStyle = ping.color;
      ctx.lineWidth = 3;
      ctx.shadowColor = ping.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0,0,22+pulse,0,Math.PI*2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0,-10);ctx.lineTo(0,10);ctx.moveTo(-10,0);ctx.lineTo(10,0);ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f1f7f4';
      ctx.font = '800 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ping.label,0,-35);
      ctx.restore();
    }
  }

  function drawPlayer() {
    var blink = player.invuln > 0 && Math.floor(nowTime * 14) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.35;
    ctx.save();
    ctx.translate(player.x, player.y);
    var walking = player.moveX || player.moveY;
    var bob = walking && !settings.reducedMotion ? Math.sin(nowTime * 13) * 2 : 0;
    ctx.rotate(player.dashTimer > 0 && !settings.reducedMotion ? 0.15 : 0);
    ctx.fillStyle = 'rgba(2, 8, 10, 0.38)';
    ctx.beginPath();
    ctx.ellipse(0, 15, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(0, bob);
    if (player.blocking || player.blockFlash > 0 || player.counterWindow > 0) {
      ctx.save();
      ctx.rotate(player.facing);
      ctx.strokeStyle = player.counterWindow > 0 ? '#f6e36d' : (player.blockFlash > 0 ? '#62c7ff' : '#7ce4d1');
      ctx.fillStyle = player.guardBroken > 0 ? 'rgba(255,102,128,.16)' : 'rgba(98,199,255,.12)';
      ctx.lineWidth = player.blockFlash > 0 ? 5 : 3;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = player.blockFlash > 0 ? 16 : 8;
      ctx.beginPath();
      ctx.arc(18, 0, 20, -1.15, 1.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(10, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    var equipmentPose = currentEquipmentPose();
    drawEquipmentLayer(equipmentPose,'rear');
    var heroRow = player.dashTimer > 0 ? 3 :
      (equipmentVisualRuntime.animationState === 'attack' || equipmentVisualRuntime.animationState === 'charged' ||
       equipmentVisualRuntime.animationState === 'special' ? 2 : (walking ? 1 : 0));
    if (drawSpriteCell('hero', heroRow, facingColumn(player.facing), 0, 20, 76, 0.73)) {
      drawEquipmentLayer(equipmentPose,'front');
      updateEquipmentDiagnostics(equipmentPose);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = '#1e5660';
    ctx.beginPath();
    ctx.moveTo(-13, 3);
    ctx.lineTo(13, 3);
    ctx.lineTo(10, 22);
    ctx.lineTo(-10, 22);
    ctx.fill();
    ctx.fillStyle = '#52c7b2';
    ctx.fillRect(-11, -5, 22, 18);
    ctx.fillStyle = '#e7b98b';
    ctx.beginPath();
    ctx.arc(0, -13, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#172b33';
    ctx.beginPath();
    ctx.arc(0, -17, 11, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f7d870';
    ctx.beginPath();
    ctx.arc(0, 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(player.facing + Math.PI / 2);
    ctx.strokeStyle = state.pruner ? '#e6f1d4' : '#a3754d';
    ctx.lineWidth = state.pruner ? 5 : 4;
    ctx.beginPath();
    ctx.moveTo(10, 3);
    ctx.lineTo(10, -26);
    ctx.stroke();
    if (state.pruner) {
      ctx.strokeStyle = '#ffc857';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(10, -28, 9, Math.PI * 0.1, Math.PI * 1.1);
      ctx.stroke();
    }
    drawEquipmentLayer(equipmentPose,'front');
    updateEquipmentDiagnostics(equipmentPose);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawOdin() {
    if (!state.odinRecruited || !isVisible(odin.x, odin.y, 55)) return;
    var attacking = odin.attackFlash > 0;
    var row = odin.sniffing ? 2 : (odin.moving || attacking ? 1 : 0);
    var col = odin.spriteColumn;
    var bob = odin.moving && !settings.reducedMotion ? Math.sin(odin.gait * 2) * 0.9 : 0;
    var attackProgress = attacking ? 1 - odin.attackFlash / Math.max(0.01, odin.attackDuration) : 0;
    var lunge = attacking && !settings.reducedMotion ? Math.sin(attackProgress * Math.PI) * 6 : 0;
    var renderX = odin.x + Math.cos(odin.facing) * lunge;
    var renderY = odin.y + Math.sin(odin.facing) * lunge;
    ctx.save();
    ctx.fillStyle = 'rgba(2,8,12,.34)';
    ctx.beginPath(); ctx.ellipse(odin.x, odin.y + 29, attacking ? 20 : 18, 6, 0, 0, Math.PI * 2); ctx.fill();
    /*
     * Canvas shadow blur on a transparent sprite is disproportionately costly
     * on mobile GPUs. Spirit Wolf keeps its readable aura with two cheap,
     * unblurred shapes behind the sprite instead of re-filtering the PNG every
     * frame for the full seven-second frenzy.
     */
    if (odin.spiritTimer > 0) {
      var spiritPulse = settings.reducedMotion ? 0 : Math.sin(nowTime * 7) * 2;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#62c7ff';
      ctx.beginPath();
      ctx.ellipse(renderX, renderY + 11, 25 + spiritPulse, 31 + spiritPulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.52;
      ctx.strokeStyle = '#9de8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(renderX, renderY + 12, 21 + spiritPulse, 27 + spiritPulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    var odinAnimation = odin.activity || (attacking ? 'attack' : odin.animState || 'idle');
    var odinSpriteId = ODIN_EXPANDED_ACTIONS.has(odinAnimation) ? 'odin-expanded-actions' : 'odin';
    if (odinSpriteId === 'odin' && (odinAnimation === 'idle' || odinAnimation === 'walk' || odinAnimation === 'run')) {
      odinAnimation += '_' + spriteDirection(odin.facing);
    }
    var odinDrawn = drawProductionSprite(
      odinSpriteId, odinAnimation, odin.animTime, renderX, renderY + 33.5,
      odinSpriteId === 'odin' ? 76 : 78,
      ODIN_DRAW_OPTIONS
    );
    if (!odinDrawn) drawOdinSpriteCell(row, col, renderX, renderY + 33.5 + bob, 70);
    ctx.fillStyle = '#62c7ff'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('ODIN · ' + odin.command.toUpperCase(), odin.x, odin.y - 31);
    ctx.restore();
  }
  function drawStagePortals() {
    stagePortals.forEach(function (p) {
      if (!isVisible(p.x, p.y, 90)) return;
      var unlocked = portalUnlocked(p);
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.strokeStyle = unlocked ? '#62c7ff' : '#47545c';
      ctx.lineWidth = 5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = unlocked ? 14 : 0;
      ctx.beginPath();
      ctx.arc(0,0,28,0,Math.PI*2);
      ctx.stroke();
      ctx.fillStyle = unlocked ? '#dff8ff' : '#7d8589';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(unlocked ? 'ENTER' : 'LOCKED',0,4);
      ctx.font = 'bold 10px monospace';
      ctx.fillText(p.name.toUpperCase(),0,-39);
      ctx.restore();
    });
  }

  function drawHealthPickups() {
    healthPickups.forEach(function(h){var y=h.y+(settings.reducedMotion?0:Math.sin(nowTime*4+h.bob)*4);ctx.save();ctx.translate(h.x,y);ctx.shadowColor='#ff7892';ctx.shadowBlur=14;ctx.fillStyle='#ff7892';ctx.beginPath();ctx.arc(-5,-2,6,0,Math.PI*2);ctx.arc(5,-2,6,0,Math.PI*2);ctx.lineTo(0,11);ctx.closePath();ctx.fill();ctx.restore();});
  }

  function drawAttacks() {
    attacks.forEach(function (a) {
      var alpha = clamp(a.life / a.maxLife, 0, 1);
      var instrument=instrumentById(a.instrument);
      var profile=a.profile||instrumentProfile(a.instrument);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = instrument.color;
      ctx.lineWidth = a.charged ? 9 : instrument.id==='violin'?3:instrument.id==='bass'?9:6;
      ctx.shadowColor = instrument.color;
      ctx.shadowBlur = 9;
      ctx.beginPath();
      if (a.charged) {
        var chargedRadius=Math.max(58,profile.range*.7)+a.progress*24;
        ctx.arc(0,0,chargedRadius,0,Math.PI*2);
      } else if(instrument.id==='synth'){
        ctx.rotate(a.angle);
        ctx.moveTo(20,0);ctx.lineTo(profile.range,0);
        ctx.moveTo(profile.range-14,-7);ctx.lineTo(profile.range,0);ctx.lineTo(profile.range-14,7);
      } else if(instrument.id==='drums'){
        ctx.arc(0,0,28+a.progress*profile.range*.62,0,Math.PI*2);
        ctx.moveTo(18+a.progress*30,0);ctx.arc(0,0,18+a.progress*30,0,Math.PI*2);
      } else if(instrument.id==='microphone'){
        ctx.arc(0,0,profile.range*.56,a.angle-profile.arc+a.progress*.28,a.angle+profile.arc+a.progress*.28);
        ctx.moveTo(Math.cos(a.angle-profile.arc*.55)*profile.range*.74,Math.sin(a.angle-profile.arc*.55)*profile.range*.74);
        ctx.arc(0,0,profile.range*.74,a.angle-profile.arc*.55,a.angle+profile.arc*.55);
      } else {
        ctx.arc(0,0,Math.min(profile.range,82),a.angle-profile.arc+a.progress*.5,a.angle+profile.arc+a.progress*.5);
      }
      ctx.stroke();
      var attackEffects = {
        guitar:'lightning', bass:'root', synth:'crystal', drums:'resonance',
        microphone:'leaf', violin:'slash'
      };
      drawProductionSprite(
        'combat-effects', attackEffects[instrument.id] || 'slash',
        Math.max(0, a.maxLife - a.life), 0, 0,
        a.charged ? 124 : Math.min(104, profile.range + 24),
        { alpha:0.72, originX:0.5, originY:0.5 }
      );
      ctx.restore();
    });
  }

  function drawPulses() {
    pulses.forEach(function (p) {
      var pulseColor=equippedInstrument().color;
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.strokeStyle = pulseColor;
      ctx.lineWidth = 5;
      ctx.shadowColor = pulseColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawProjectiles() {
    projectiles.forEach(function (p) {
      if (!isVisible(p.x, p.y, 20)) return;
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 0.035, p.y - p.vy * 0.035, p.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawHazards() {
    hazards.forEach(function (h) {
      if (!isVisible(h.x, h.y, h.r + 12)) return;
      ctx.save();
      if (h.timer > 0) {
        ctx.globalAlpha = 0.35 + Math.sin(nowTime * 16) * 0.12;
        ctx.strokeStyle = h.color || '#ff7892';
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = h.fillColor || '#7f2948';
        for (var i = 0; i < 7; i++) {
          var a = i * Math.PI * 2 / 7;
          ctx.beginPath();
          ctx.moveTo(h.x + Math.cos(a - 0.18) * 8, h.y + Math.sin(a - 0.18) * 8);
          ctx.lineTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
          ctx.lineTo(h.x + Math.cos(a + 0.18) * 8, h.y + Math.sin(a + 0.18) * 8);
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }

  function drawBoss() {
    if (!boss || (boss.dead && (typeof boss.deathTimer !== 'number' ||
        boss.deathTimer >= (boss.deathDuration || 1.35)))) return;
    var def = bossDefForStage(boss.stage);
    if (boss.sequenceMode) {
      bossPads().forEach(function (pad) {
        var expected = boss.sequence[boss.sequenceIndex] === pad.note;
        ctx.save();
        ctx.fillStyle = expected ? NOTE_COLORS[pad.note] : '#273044';
        ctx.globalAlpha = expected ? 0.82 : 0.7;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, 30 + (expected && !settings.reducedMotion ? Math.sin(nowTime * 5) * 3 : 0), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = NOTE_COLORS[pad.note];
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = expected ? '#132028' : NOTE_COLORS[pad.note];
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pad.note, pad.x, pad.y + 1);
        ctx.restore();
      });
    }
    if (boss.challengeMode && (def.mechanic === 'root-knots' || def.mechanic === 'prism-shards')) {
      boss.weakPoints.forEach(function (point, index) {
        if (point.broken) return;
        ctx.save();
        ctx.translate(point.x, point.y);
        var pulse = settings.reducedMotion ? 0 : Math.sin(nowTime * 5 + index) * 3;
        ctx.shadowColor = def.shieldColor;
        ctx.shadowBlur = 16;
        ctx.fillStyle = def.mechanic === 'root-knots' ? '#776230' : '#263c70';
        ctx.strokeStyle = def.shieldColor;
        ctx.lineWidth = 4;
        if (def.mechanic === 'root-knots') {
          ctx.beginPath();
          for (var root = 0; root < 8; root++) {
            var rootAngle = root / 8 * Math.PI * 2;
            var rootRadius = root % 2 ? 16 + pulse : 25 + pulse;
            var rootX = Math.cos(rootAngle) * rootRadius;
            var rootY = Math.sin(rootAngle) * rootRadius;
            if (root === 0) ctx.moveTo(rootX, rootY); else ctx.lineTo(rootX, rootY);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.rotate(nowTime * 1.6 + index);
          ctx.beginPath();
          ctx.moveTo(0, -27 - pulse);
          ctx.lineTo(17 + pulse, 0);
          ctx.lineTo(0, 27 + pulse);
          ctx.lineTo(-17 - pulse, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      });
    }
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.rotate(Math.sin(boss.angle * 0.6) * 0.04);
    ctx.fillStyle = 'rgba(2, 5, 10, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 48, 62, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    var bossColumn = boss.flash > 0 ? 3 : boss.shielded ? 2 :
      (!settings.reducedMotion && boss.projectileCooldown < 0.38 ? 1 : 0);
    var bossAnimation = boss.dead ? 'death' : (boss.animState || 'idle');
    if (bossAnimation === 'idle' || bossAnimation === 'walk' || bossAnimation === 'run') {
      bossAnimation += '_' + spriteDirection(boss.facing);
    }
    var bossDrawn = drawProductionSprite(
      def.assetId, bossAnimation, boss.dead ? boss.deathTimer : boss.animTime,
      0, 60, boss.stage === 3 ? 208 : 198,
      { alpha:boss.flash > 0 ? 0.9 : 1, glow:boss.shielded ? def.shieldColor : null, glowBlur:18 }
    );
    if (bossDrawn || drawSpriteCell('chapter-boss', def.spriteRow, bossColumn, 0, 58, boss.stage === 3 ? 202 : 194, 0.74, boss.flash > 0 ? 0.9 : 1)) {
      if (boss.shielded) {
        ctx.strokeStyle = def.shieldColor;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, 77 + (settings.reducedMotion ? 0 : Math.sin(nowTime * 5) * 4), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    ctx.fillStyle = boss.flash > 0 ? '#ffe0f8' : '#201425';
    roundedRect(ctx, -52, -62, 104, 116, 14);
    ctx.fill();
    ctx.strokeStyle = boss.shielded ? def.shieldColor : def.color;
    ctx.lineWidth = boss.shielded ? 7 : 4;
    ctx.stroke();
    ctx.fillStyle = '#4d274a';
    ctx.beginPath();
    ctx.arc(0, 8, 34 + Math.sin(nowTime * 4) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f05ad7';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#120d19';
    ctx.beginPath();
    ctx.arc(0, 8, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.color;
    ctx.fillRect(-28, -43, 56, 10);
    ctx.fillStyle = '#1a1020';
    ctx.fillRect(-22, -40, 7, 4);
    ctx.fillRect(-7, -40, 7, 4);
    ctx.fillRect(8, -40, 7, 4);
    ctx.fillRect(21, -40, 4, 4);
    for (var r = 0; r < 6; r++) {
      ctx.save();
      ctx.rotate(r * Math.PI / 3 + boss.angle * 0.18);
      ctx.fillStyle = '#322039';
      ctx.beginPath();
      ctx.moveTo(28, 35);
      ctx.quadraticCurveTo(68, 48, 74, 78);
      ctx.lineTo(62, 74);
      ctx.quadraticCurveTo(53, 49, 22, 45);
      ctx.fill();
      ctx.restore();
    }
    if (boss.shielded) {
      ctx.strokeStyle = def.shieldColor;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 72 + Math.sin(nowTime * 5) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(function (p) {
      if (!isVisible(p.x, p.y, 25)) return;
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      if (p.text) {
        ctx.fillStyle = p.color;
        ctx.font = 'bold ' + p.size + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.restore();
    });
  }

  function drawWorldLabels() {
    var labels = currentLevel.labels;
    labels.forEach(function (l) {
      if (!isVisible(l[0], l[1], 140)) return;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#e0eedc';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(l[2], l[0], l[1]);
      ctx.restore();
    });
  }

  function drawInteractionPrompt() {
    if (!started || paused || dialogue || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen) return;
    var near = nearestInteractable();
    if (!near) return;
    var item = near.item;
    var label = near.type === 'npc' ? (touchCapable ? 'TALK' : 'E  TALK') : near.type === 'portal' ? (touchCapable ? 'ENTER' : 'E  ENTER') :
      near.type === 'world-event' ? (touchCapable ? 'JOIN' : 'E  JOIN') : (touchCapable ? 'LISTEN' : 'E  LISTEN');
    var sx = item.x - camera.x + W / 2;
    var sy = item.y - camera.y + H / 2 - 55;
    ctx.save();
    ctx.font = 'bold ' + (touchCapable ? 21 : 11) + 'px monospace';
    var width = ctx.measureText(label).width + (touchCapable ? 24 : 18);
    ctx.fillStyle = 'rgba(5, 15, 18, 0.9)';
    roundedRect(ctx, sx - width / 2, sy - (touchCapable ? 21 : 13), width, touchCapable ? 38 : 24, 8);
    ctx.fill();
    ctx.strokeStyle = '#e8f6dd';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8f6dd';
    ctx.textAlign = 'center';
    ctx.fillText(label, sx, sy + (touchCapable ? 7 : 3));
    ctx.restore();
  }

  function drawObjectiveArrow() {
    if (!started || !settings.objectiveArrow || mapOpen || composerOpen || inventoryOpen || shopOpen || skillsOpen || statisticsOpen || instrumentsOpen || homeOpen || dialogue) return;
    var target = getObjective();
    var sx = target.x - camera.x + W / 2;
    var sy = target.y - camera.y + H / 2;
    if (sx > 50 && sx < W - 50 && sy > 70 && sy < H - 50) return;
    var dx = sx - W / 2;
    var dy = sy - H / 2;
    var n = normalize(dx, dy);
    var radiusX = W / 2 - 45;
    var radiusY = H / 2 - 62;
    var scale = Math.min(Math.abs(radiusX / (n.x || 0.001)), Math.abs(radiusY / (n.y || 0.001)));
    var x = W / 2 + n.x * scale;
    var y = H / 2 + n.y * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(n.y, n.x));
    ctx.fillStyle = '#ffc857';
    ctx.shadowColor = '#ffc857';
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 8);
    ctx.fill();
    ctx.restore();
  }

  function drawBossHud() {
    if (!boss || boss.dead) return;
    var def = bossDefForStage(boss.stage);
    var width = 360;
    var x = (W - width) / 2;
    var y = 76;
    ctx.save();
    ctx.fillStyle = 'rgba(9, 8, 15, 0.9)';
    roundedRect(ctx, x - 10, y - 22, width + 20, 46, 10);
    ctx.fill();
    ctx.fillStyle = '#eadff0';
    ctx.font = 'bold ' + (touchCapable ? 20 : 11) + 'px monospace';
    ctx.textAlign = 'center';
    var challengeLabel = def.name;
    if (boss.sequenceMode) challengeLabel = def.shortName.toUpperCase() + ' · PLAY ' + boss.sequence.join(' › ');
    else if (boss.challengeMode && def.mechanic === 'root-knots') {
      challengeLabel = def.shortName.toUpperCase() + ' · PULSE ' + boss.weakPoints.filter(function (point) { return !point.broken; }).length + ' KNOTS';
    } else if (boss.challengeMode && def.mechanic === 'prism-shards') {
      challengeLabel = def.shortName.toUpperCase() + ' · BREAK ' + boss.weakPoints.filter(function (point) { return !point.broken; }).length + ' PRISMS';
    } else if (boss.challengeMode && def.mechanic === 'tide-surges') {
      challengeLabel = def.shortName.toUpperCase() + ' · ' + boss.surgesRemaining + ' SURGES';
    }
    ctx.fillText(challengeLabel, W / 2, y - 7, width - 16);
    ctx.fillStyle = '#29152b';
    ctx.fillRect(x, y, width, 11);
    ctx.fillStyle = boss.shielded ? def.shieldColor : def.color;
    ctx.fillRect(x, y, width * clamp(boss.hp / boss.maxHp, 0, 1), 11);
    ctx.strokeStyle = '#f1c9ea';
    ctx.strokeRect(x, y, width, 11);
    ctx.restore();
  }

  function drawWeatherLayer() {
    var weather=state.weather;
    ctx.save();
    if(weather==='rain'){
      ctx.strokeStyle='rgba(140,210,235,.28)';ctx.lineWidth=1.4;
      for(var rain=0;rain<48;rain++){
        var rx=(rain*97+nowTime*260)%W,ry=(rain*53+nowTime*420)%H;
        ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx-9,ry+18);ctx.stroke();
      }
      ctx.fillStyle='rgba(16,39,58,.12)';ctx.fillRect(0,0,W,H);
    }else if(weather==='fog'){
      for(var fog=0;fog<5;fog++){
        var fx=((fog*240+nowTime*12)%(W+300))-150,fy=90+fog*95;
        var fogGradient=ctx.createRadialGradient(fx,fy,10,fx,fy,170);
        fogGradient.addColorStop(0,'rgba(220,214,188,.16)');fogGradient.addColorStop(1,'rgba(220,214,188,0)');
        ctx.fillStyle=fogGradient;ctx.fillRect(fx-180,fy-100,360,200);
      }
    }else if(weather==='wind'){
      ctx.strokeStyle='rgba(180,232,255,.22)';ctx.lineWidth=2;
      for(var gust=0;gust<9;gust++){
        var gx=((gust*143+nowTime*190)%(W+160))-80,gy=55+gust*54;
        ctx.beginPath();ctx.moveTo(gx,gy);ctx.quadraticCurveTo(gx+34,gy-8,gx+68,gy);ctx.stroke();
      }
    }else if(weather==='crystal-storm'){
      ctx.fillStyle='rgba(71,81,168,.15)';ctx.fillRect(0,0,W,H);
      for(var shard=0;shard<35;shard++){
        var sx=(shard*113+nowTime*330)%W,sy=(shard*67+nowTime*270)%H;
        ctx.fillStyle=shard%2?'rgba(157,232,255,.55)':'rgba(215,124,255,.45)';
        ctx.save();ctx.translate(sx,sy);ctx.rotate(-.5);ctx.fillRect(-1,-7,2,14);ctx.restore();
      }
    }else if(weather==='blood-moon'){
      var red=ctx.createRadialGradient(W*.82,H*.14,10,W*.82,H*.14,H*.9);
      red.addColorStop(0,'rgba(255,92,102,.19)');red.addColorStop(1,'rgba(61,0,24,.08)');
      ctx.fillStyle=red;ctx.fillRect(0,0,W,H);
    }else if(weather==='forest-bloom'){
      for(var bloom=0;bloom<28;bloom++){
        var bx=(bloom*109+Math.sin(nowTime+bloom)*22)%W,by=(bloom*61-nowTime*18+H*3)%H;
        ctx.fillStyle=bloom%2?'rgba(125,247,161,.55)':'rgba(246,227,109,.5)';
        ctx.beginPath();ctx.arc(bx,by,1.5+(bloom%3),0,Math.PI*2);ctx.fill();
      }
    }
    var stageTint=state.stage===2?'rgba(255,145,72,.035)':state.stage===3?'rgba(93,163,255,.035)':state.stage===4?'rgba(108,113,255,.05)':'rgba(80,255,155,.025)';
    ctx.fillStyle=stageTint;ctx.fillRect(0,0,W,H);
    ctx.restore();
  }

  function drawVignette() {
    var grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.78);
    grad.addColorStop(0, 'rgba(3, 10, 15, 0)');
    grad.addColorStop(0.78, 'rgba(3, 8, 14, 0.04)');
    grad.addColorStop(1, 'rgba(3, 8, 14, 0.48)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawFirstStageSafeZone() {
    if (state.stage !== 1 || (state.firstStageOnboarding.graceConsumed && firstStageRuntime.respawnGrace <= 0)) return;
    var spawn = firstStageSpawnPoint();
    ctx.save();
    ctx.globalAlpha = settings.reducedMotion ? 0.18 : 0.14 + Math.sin(state.playSeconds * 2) * 0.025;
    ctx.strokeStyle = '#7df7a1';
    ctx.lineWidth = 3;
    ctx.setLineDash([12,18]);
    ctx.beginPath();
    ctx.arc(spawn.x,spawn.y,FIRST_STAGE_BALANCE.safeZoneRadius,0,Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#d8ffe4';
    ctx.font = '700 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MOSSVALE REST AREA',spawn.x,spawn.y-FIRST_STAGE_BALANCE.safeZoneRadius+22);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var amount = settings.screenShake && !settings.reducedMotion ? shake : 0;
    var shakeX = amount ? (Math.random() - 0.5) * amount : 0;
    var shakeY = amount ? (Math.random() - 0.5) * amount : 0;
    shake *= 0.88;
    ctx.save();
    ctx.translate(Math.round(W / 2 - camera.x + shakeX), Math.round(H / 2 - camera.y + shakeY));
    drawGround();
    drawFirstStageSafeZone();
    drawWater();
    drawDecorations();
    drawAmbientWildlife();
    drawWorldLabels();
    shrines.forEach(drawShrine);
    drawPuzzleObjects();
    weeds.forEach(drawWeed);
    stageTokens.forEach(drawStageToken);
    collectibles.forEach(drawCollectible);
    drawStagePortals();
    npcs.forEach(drawNpc);
    drawWorldEvent();
    drawMiniBossArenas();
    enemies.forEach(drawEnemy);
    drawHealthPickups();
    drawHazards();
    drawProjectiles();
    drawBoss();
    drawOdin();
    drawOnlineWorldPings();
    drawOnlineRemotePlayers();
    drawPlayer();
    drawAttacks();
    drawPulses();
    drawParticles();
    drawObstacles();
    ctx.restore();
    drawWeatherLayer();
    drawVignette();
    drawInteractionPrompt();
    drawObjectiveArrow();
    drawBossHud();
  }

  var lastFrame = performance.now();
  function shouldAnimateCanvas() {
    var ending = byId('endingScreen');
    return !document.hidden && !orientationBlocked && started && !paused && !mapOpen && !composerOpen && !inventoryOpen && !shopOpen && !skillsOpen && !statisticsOpen && !instrumentsOpen && !homeOpen &&
      !dialogue && (!ending || ending.hidden);
  }

  function frame(time) {
    var dt = clamp((time - lastFrame) / 1000, 0, 0.034);
    lastFrame = time;
    nowTime = time / 1000;
    update(dt);
    if (mapOpen && (settings.reducedMotion ? mapAnimationTime === 0 : nowTime - mapAnimationTime >= 0.033)) drawMap();
    if (shouldAnimateCanvas() || canvasDirty) {
      draw();
      canvasDirty = false;
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    syncViewport();
    activateLevel(1);
    resetEnemies();
    bindControls();
    applySettings();
    refreshContinue();
    updateHUD();
    setHidden(byId('pauseScreen'), true);
    setHidden(byId('dialogueBox'), true);
    setHidden(byId('composerScreen'), true);
    setHidden(byId('mapScreen'), true);
    setHidden(byId('inventoryScreen'), true);
    setHidden(byId('shopScreen'), true); setHidden(byId('skillsScreen'), true); setHidden(byId('statisticsScreen'), true);
    setHidden(byId('instrumentsScreen'), true); setHidden(byId('homeScreen'), true);
    setHidden(byId('endingScreen'), true);
    setHidden(byId('howPanel'), true);
    setHidden(byId('settingsPanel'), true);
    canvas.setAttribute('tabindex', '0');
    requestAnimationFrame(frame);
  }

  function acceptProductionContract(id) {
    if (!/^contract-[a-z0-9-]{2,70}$/.test(String(id || ''))) return {ok:false,reason:'invalid_contract'};
    if (state.completedContracts.indexOf(id) >= 0) return {ok:false,reason:'already_completed'};
    if (state.activeContracts.indexOf(id) >= 0) return {ok:true,reason:'already_active'};
    if (state.activeContracts.length >= 3) return {ok:false,reason:'contract_limit'};
    state.activeContracts.push(id);
    saveGame(true);
    return {ok:true};
  }

  function claimProductionContract(id,reward) {
    var activeIndex = state.activeContracts.indexOf(id);
    if (activeIndex < 0 || state.completedContracts.indexOf(id) >= 0) {
      return {ok:false,reason:'contract_not_active'};
    }
    reward = reward && typeof reward === 'object' ? reward : {};
    var beatcoins = clamp(Math.floor(Number(reward.beatcoins) || 0),0,100);
    var skillPoints = clamp(Math.floor(Number(reward.skillPoints) || 0),0,2);
    var reputation = clamp(Math.floor(Number(reward.reputation) || 0),0,10);
    state.beatcoins += beatcoins;
    state.skillPoints = clamp(state.skillPoints + skillPoints,0,99);
    state.statistics.beatcoinsEarned += beatcoins;
    state.regionalReputation[regionIdForStage(reward.stage)] =
      clamp(state.regionalReputation[regionIdForStage(reward.stage)] + reputation,0,100);
    if (PROFESSION_IDS.indexOf(reward.profession) >= 0) {
      gainProfessionXp(reward.profession,clamp(Math.floor(Number(reward.xp) || 12),1,40),'Guild contract');
    }
    if (Object.prototype.hasOwnProperty.call(state.craftingMaterials,reward.material)) {
      addCraftingMaterial(reward.material,clamp(Math.floor(Number(reward.materialAmount) || 1),1,5));
    }
    state.activeContracts.splice(activeIndex,1);
    state.completedContracts.push(id);
    showToast('GUILD CONTRACT COMPLETE',
      '+' + beatcoins + ' Beatcoins' + (skillPoints ? ' · +' + skillPoints + ' Skill Point' : ''),
      '#ffc857',3.2);
    audioCall('sfx','quest');
    saveGame(true);
    updateHUD(true);
    return {ok:true};
  }

  function updateOnlineProfile(profile) {
    profile = profile && typeof profile === 'object' ? profile : {};
    if (typeof profile.displayName === 'string') {
      state.onlineProfile.displayName = profile.displayName.replace(/[^\w \-']/g,'').trim().slice(0,20) || 'Mossvale Player';
    }
    if (['grove','rootsong','skyglass','moonwake'].indexOf(profile.cosmetic) >= 0) {
      state.onlineProfile.cosmetic = profile.cosmetic;
    }
    saveGame(true);
    return JSON.parse(JSON.stringify(state.onlineProfile));
  }

  function updatePvpV2Preferences(preferences) {
    preferences = preferences && typeof preferences === 'object' ? preferences : {};
    if (['guitar','bass'].indexOf(preferences.preferredInstrument) >= 0) {
      state.pvpV2.preferredInstrument = preferences.preferredInstrument;
    }
    saveGame(true);
    return JSON.parse(JSON.stringify(state.pvpV2));
  }

  function recordPvpV2Result(result) {
    result = result && typeof result === 'object' ? result : {};
    var entry = {
      won:!!result.won,
      online:!!result.online,
      mode:'stock',
      instrument:['guitar','bass'].indexOf(result.instrument) >= 0 ? result.instrument : 'guitar',
      knockouts:clamp(Math.floor(Number(result.knockouts) || 0),0,99),
      falls:clamp(Math.floor(Number(result.falls) || 0),0,99),
      duration:clamp(Number(result.duration) || 0,0,3600),
      at:Date.now()
    };
    state.pvpV2.matches++;
    if (entry.won) state.pvpV2.wins++;
    else state.pvpV2.losses++;
    state.pvpV2.knockouts += entry.knockouts;
    state.pvpV2.falls += entry.falls;
    state.pvpV2.playSeconds += entry.duration;
    if (entry.online) state.pvpV2.onlineMatches++;
    else state.pvpV2.localMatches++;
    state.pvpV2.preferredInstrument = entry.instrument;
    state.pvpV2.matchHistory.push(entry);
    if (state.pvpV2.matchHistory.length > 12) state.pvpV2.matchHistory.splice(0,state.pvpV2.matchHistory.length-12);
    if (state.pvpV2.wins >= 1 && state.pvpV2.cosmetics.indexOf('amphitheatre-banner') < 0) {
      state.pvpV2.cosmetics.push('amphitheatre-banner');
    }
    if (state.pvpV2.wins >= 10 && state.pvpV2.cosmetics.indexOf('golden-headliner') < 0) {
      state.pvpV2.cosmetics.push('golden-headliner');
    }
    // Competitive results remain local statistics only. The static client never
    // awards trusted rating, currency, or progression from an unverified packet.
    saveGame(true);
    return JSON.parse(JSON.stringify(state.pvpV2));
  }

  var ONLINE_EQUIPMENT_ANIMATION_STATES = [
    'idle','walk','run','attack','charged','special','block','dash',
    'dodge','hurt','stun','death','respawn','switch','victory','defeat'
  ];
  var ONLINE_EQUIPMENT_DIRECTIONS = ['north','south','east','west'];

  function onlineInstrumentId(value,fallback) {
    if (INSTRUMENTS.some(function (instrument) { return instrument.id === value; })) return value;
    return INSTRUMENTS.some(function (instrument) { return instrument.id === fallback; }) ? fallback : 'guitar';
  }

  function onlineEquipmentDirection(value,facing) {
    if (ONLINE_EQUIPMENT_DIRECTIONS.indexOf(value) >= 0) return value;
    var angle = Number.isFinite(Number(facing)) ? Number(facing) : 0;
    var x = Math.cos(angle);
    var y = Math.sin(angle);
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'west' : 'east';
    return y < 0 ? 'north' : 'south';
  }

  function sanitizeOnlineEquipment(remote,instrument,facing,moving,attacking) {
    var raw = remote.equipment && typeof remote.equipment === 'object' && !Array.isArray(remote.equipment) ?
      remote.equipment : remote;
    var equipmentId = onlineInstrumentId(raw.equipmentId,instrument);
    var fallbackState = attacking ? 'attack' : (moving ? 'walk' : 'idle');
    var animationState = ONLINE_EQUIPMENT_ANIMATION_STATES.indexOf(raw.animationState) >= 0 ?
      raw.animationState : fallbackState;
    var switchFrom = onlineInstrumentId(raw.switchFrom,equipmentId);
    var switchTo = onlineInstrumentId(raw.switchTo,instrument);
    var switchProgress = clamp(Number(raw.switchProgress) || 0,0,1);
    var claimedSwitch = raw.switching === true;
    var switching = claimedSwitch && switchProgress < 1;
    if (switching) {
      animationState = 'switch';
      equipmentId = switchProgress < 0.5 ? switchFrom : switchTo;
    } else {
      if (claimedSwitch) equipmentId = switchTo;
      if (animationState === 'switch') animationState = 'idle';
      switchFrom = equipmentId;
      switchTo = equipmentId;
      switchProgress = 1;
    }
    return {
      equipmentId:equipmentId,
      animationState:animationState,
      animationFrame:clamp(Math.floor(Number(raw.animationFrame) || 0),0,15),
      animationElapsed:clamp(Number(raw.animationElapsed) || 0,0,86400),
      animationTimestamp:clamp(Math.floor(Number(raw.animationTimestamp) || Date.now()),0,9999999999999),
      facingDirection:onlineEquipmentDirection(raw.facingDirection,facing),
      networkStateId:clamp(Math.floor(Number(raw.networkStateId) || 0),0,15),
      cosmeticVariant:raw.cosmeticVariant === 'standard' ? 'standard' : 'standard',
      schemaVersion:clamp(Math.floor(Number(raw.schemaVersion) || 0),0,1),
      legendary:raw.legendary === true,
      switching:switching,
      switchFrom:switchFrom,
      switchTo:switchTo,
      switchProgress:switchProgress,
      switchDuration:clamp(Number(raw.switchDuration) || 0.58,0.2,2)
    };
  }

  function setOnlineRemotePlayers(remotes) {
    if (!Array.isArray(remotes)) remotes = [];
    onlineRemotePlayers = remotes.slice(0,3).map(function (remote,index) {
      remote = remote && typeof remote === 'object' ? remote : {};
      var facingValue = Number(remote.facing);
      var facing = Number.isFinite(facingValue) ? clamp(facingValue,-7,7) : 0;
      var instrument = onlineInstrumentId(remote.instrument,'guitar');
      var moving = !!remote.moving;
      var attacking = !!remote.attacking;
      var equipment = sanitizeOnlineEquipment(remote,instrument,facing,moving,attacking);
      return {
        id:String(remote.id || ('remote-' + index)).replace(/[^a-zA-Z0-9-]/g,'').slice(0,40),
        name:String(remote.name || 'Guest').replace(/[^\w \-']/g,'').trim().slice(0,20) || 'Guest',
        x:clamp(Number(remote.x) || HUB.x,20,WORLD.w-20),
        y:clamp(Number(remote.y) || HUB.y,20,WORLD.h-20),
        facing:facing,
        moving:moving,
        attacking:attacking,
        odin:!!remote.odin,
        stage:clamp(Math.floor(Number(remote.stage) || 1),1,4),
        instrument:instrument,
        equipmentId:equipment.equipmentId,
        animationState:equipment.animationState,
        animationFrame:equipment.animationFrame,
        animationElapsed:equipment.animationElapsed,
        animationTimestamp:equipment.animationTimestamp,
        facingDirection:equipment.facingDirection,
        networkStateId:equipment.networkStateId,
        equipmentSchemaVersion:equipment.schemaVersion,
        equipmentCosmeticVariant:equipment.cosmeticVariant,
        legendary:equipment.legendary,
        switching:equipment.switching,
        switchFrom:equipment.switchFrom,
        switchTo:equipment.switchTo,
        switchProgress:equipment.switchProgress,
        switchDuration:equipment.switchDuration,
        cosmetic:['grove','rootsong','skyglass','moonwake'].indexOf(remote.cosmetic) >= 0 ? remote.cosmetic : 'grove',
        ping:clamp(Math.floor(Number(remote.ping) || 0),0,999)
      };
    });
    canvasDirty = true;
    return onlineRemotePlayers.length;
  }

  function setOnlineWorldPings(pings) {
    if (!Array.isArray(pings)) pings = [];
    onlineWorldPings = pings.slice(0,8).map(function (ping) {
      ping = ping && typeof ping === 'object' ? ping : {};
      return {
        x:clamp(Number(ping.x) || HUB.x,20,WORLD.w-20),
        y:clamp(Number(ping.y) || HUB.y,20,WORLD.h-20),
        stage:clamp(Math.floor(Number(ping.stage) || 1),1,4),
        label:String(ping.label || 'PLAYER PING').replace(/[^\w \-!]/g,'').trim().slice(0,24) || 'PLAYER PING',
        color:/^#[0-9a-f]{6}$/i.test(ping.color || '') ? ping.color : '#ffc857'
      };
    });
    canvasDirty = true;
    return onlineWorldPings.length;
  }

  window.__HIGH_NOTES__ = {
    version: SAVE_SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    startNew: newGame,
    continueGame: continueGame,
    snapshot: function () {
      var currentEquipmentNetworkSnapshot = equipmentNetworkSnapshot(currentEquipmentPose());
      return JSON.parse(JSON.stringify({
        state: state,
        player: {
          x: player.x, y: player.y, facing: player.facing,
          health: player.health, maxHealth: player.maxHealth,
          equipment: currentEquipmentNetworkSnapshot
        },
        boss: boss && {
          stage: boss.stage,
          defId: boss.defId,
          hp: boss.hp,
          maxHp: boss.maxHp,
          challengeMode: boss.challengeMode,
          sequenceMode: boss.sequenceMode,
          sequence: boss.sequence,
          sequenceIndex: boss.sequenceIndex,
          weakPoints: boss.weakPoints,
          surgesRemaining: boss.surgesRemaining,
          shielded: boss.shielded,
          dead: boss.dead
        },
        runtime: {
          levelName: currentLevel && currentLevel.name,
          world: { w:WORLD.w, h:WORLD.h },
          started: started,
          paused: paused,
          mapOpen: mapOpen,
          inventoryOpen: inventoryOpen,
          composerOpen: composerOpen,
          shopOpen: shopOpen,
          skillsOpen: skillsOpen,
          statisticsOpen: statisticsOpen,
          instrumentsOpen: instrumentsOpen,
          homeOpen: homeOpen,
          equippedInstrument: state.equippedInstrument,
          ultimateCharge: instrumentUltimateCharge,
          weather: state.weather,
          activeWorldEvent: encounterDirector.activeEvent && encounterDirector.activeEvent.id,
          dialogueOpen: !!dialogue,
          attacks: attacks.length,
          activeEnemies: activeEnemyCount(),
          totalEnemyRecords: enemies.length,
          floatingText: floatingTextCount,
          projectiles: projectiles.length,
          healthPickups: healthPickups.length,
          firstStageZone: firstStageRuntime.zone,
          firstStageSafe: firstStageRuntime.safe,
          firstStageGrace: firstStageRuntime.graceRemaining,
          firstStageAttackers: firstStageRuntime.attackSlots.size,
          nearFishableWater: nearFishableWater(),
          fishingCooldown: Math.max(0,14-(state.playSeconds-fishingLastCast))
        }
      }));
    },
    production: {
      catalog: function () {
        updateProductionRecipeUnlocks();
        return JSON.parse(JSON.stringify({
          recipes:PRODUCTION_RECIPES,
          professionIds:PROFESSION_IDS,
          recipeIds:PRODUCTION_RECIPE_IDS
        }));
      },
      craft: craftProductionRecipe,
      acceptContract: acceptProductionContract,
      claimContract: claimProductionContract,
      setProfile: updateOnlineProfile,
      updatePvpV2: updatePvpV2Preferences,
      recordPvpV2Result: recordPvpV2Result,
      setRemotePlayers: setOnlineRemotePlayers,
      setWorldPings: setOnlineWorldPings,
      fish: tryFishing,
      setHubOpen: function (open) {
        var productionPanel = byId('productionHub');
        if (!productionPanel || !paused) return false;
        if (open) {
          setOverlayIsolation('pause','pauseScreen',false);
          setOverlayIsolation('production','productionHub',true);
        } else {
          setOverlayIsolation('production','productionHub',false);
          setOverlayIsolation('pause','pauseScreen',true);
        }
        return true;
      },
      startDreamEncore: startDreamEncore,
      endDreamEncore: function () { finishDreamEncore(false); return true; },
      recordArenaResult: function (won) {
        if (won) {
          state.onlineProfile.wins++;
          state.onlineProfile.rating = clamp(state.onlineProfile.rating + 18,100,3000);
          state.onlineProfile.seasonalTokens = clamp(state.onlineProfile.seasonalTokens + 3,0,9999);
        } else {
          state.onlineProfile.losses++;
          state.onlineProfile.rating = clamp(state.onlineProfile.rating - 12,100,3000);
          state.onlineProfile.seasonalTokens = clamp(state.onlineProfile.seasonalTokens + 1,0,9999);
        }
        saveGame(true);
        return JSON.parse(JSON.stringify(state.onlineProfile));
      },
      save: function () { saveGame(true); return true; }
    },
    debug: {
      teleport: function (x, y) {
        player.x = clamp(Number(x), 30, WORLD.w - 30);
        player.y = clamp(Number(y), 30, WORLD.h - 30);
        camera.x = player.x;
        camera.y = player.y;
      },
      grantAll: function () {
        state.weeds = LEVELS[1].weeds.map(function (w) { return w.id; });
        state.notes = NOTE_ORDER.slice();
        state.drums = allLevelItems('drums').map(function (d) { return d.id; });
        state.speakers = allLevelItems('speakers').map(function (s) { return s.id; });
        state.stageTokens = allLevelItems('tokens').map(function(token){return token.id;});
        state.metEems = state.metJimbo = state.metBlu = state.metMara = state.metPip = state.metZephra = state.metNix = state.metTavi = state.metLuma = true;
        state.odinRecruited=true;
        state.home.unlocked=true;
        state.unlockedInstruments=INSTRUMENTS.map(function(instrument){return instrument.id;});
        INSTRUMENTS.forEach(function(instrument){state.instrumentMastery[instrument.id]={xp:0,level:10};});
        state.skillPoints=20;
        state.pruner = state.pulse = state.extraHeart = state.charged = state.perfectHarvest = true;
        player.maxHealth = 6;
        player.health = 6;
        updateHUD();
        saveGame(true);
      },
      compose: function () {
        state.notes = NOTE_ORDER.slice();
        state.melody = ['C', 'E', 'G', 'B', 'C', 'G', 'E', 'B'];
        state.composed = true;
        updateHUD();
        saveGame(true);
      },
      setInvulnerable: function (seconds) {
        player.invuln = clamp(Number(seconds) || 0, 0, 120);
      },
      damage: function (amount) {
        player.health = clamp(player.health - Math.max(0, Number(amount) || 1), 1, player.maxHealth);
        updateHUD(true);
      },
      grantBeatcoins: function (amount) {
        var granted = Math.max(0, Math.floor(Number(amount) || 0));
        state.beatcoins = clamp(state.beatcoins + granted, 0, 99999);
        state.statistics.beatcoinsEarned += granted;
        saveGame(true);
        return state.beatcoins;
      },
      grantSkillPoint: function () {
        state.skillPoints = clamp(state.skillPoints + 1, 0, 99);
        saveGame(true);
        return state.skillPoints;
      },
      grantHeartblooms: function (amount) {
        var granted = clamp(Math.floor(Number(amount) || 1), 0, HEARTBLOOM_CAPACITY - state.heartblooms);
        state.heartblooms += granted;
        state.statistics.healingItemsCollected += granted;
        updateHUD(true);
        saveGame(true);
        return state.heartblooms;
      },
      collectHeartbloom: function () {
        if (!healthPickups.length) spawnStageHeartblooms(state.stage);
        var pickup = healthPickups[0];
        if (!pickup) return false;
        player.x = pickup.x;
        player.y = pickup.y;
        var stored = storeHeartbloom(pickup);
        healthPickups = healthPickups.filter(function (heartbloom) { return heartbloom.life > 0; });
        return stored;
      },
      useHeartbloom: function () {
        return useStoredHeartbloom();
      },
      enterStage: function (stage) {
        var target = clamp(Math.floor(Number(stage) || 1),1,4);
        if (target >= 2) {
          state.bossDefeated = true;
          if (state.stageBosses.indexOf('nullspeaker') < 0) state.stageBosses.push('nullspeaker');
        }
        if (target >= 3) {
          LEVELS[2].drums.forEach(function (d) { if (state.drums.indexOf(d.id) < 0) state.drums.push(d.id); });
          if (state.chapterRelics.indexOf('rootsong') < 0) state.chapterRelics.push('rootsong');
          if (state.stageBosses.indexOf('rootbound') < 0) state.stageBosses.push('rootbound');
        }
        if (target >= 4) {
          LEVELS[3].speakers.forEach(function (s) { if (state.speakers.indexOf(s.id) < 0) state.speakers.push(s.id); });
          if (state.chapterRelics.indexOf('skyglass') < 0) state.chapterRelics.push('skyglass');
          if (state.stageBosses.indexOf('prism-choir') < 0) state.stageBosses.push('prism-choir');
        }
        enterStage({target:target,name:STAGE_NAMES[target],back:true});
      },
      startBoss: function () {
        if (state.stage === 1) {
          state.notes = NOTE_ORDER.slice();
          state.melody = ['C','E','G','B','C','E','G','B'];
          state.composed = true;
        } else {
          var relic = state.stage === 2 ? 'rootsong' : state.stage === 3 ? 'skyglass' : 'moonwake';
          if (state.chapterRelics.indexOf(relic) < 0) state.chapterRelics.push(relic);
        }
        var def = bossDefForStage(state.stage);
        var defeatedIndex = state.stageBosses.indexOf(def.id);
        if (defeatedIndex >= 0) state.stageBosses.splice(defeatedIndex, 1);
        if (state.stage === 1) state.bossDefeated = false;
        player.x = BOSS_CENTER.x - 180;
        player.y = BOSS_CENTER.y;
        camera.x = player.x;
        camera.y = player.y;
        beginBoss();
        return window.__HIGH_NOTES__.snapshot().boss;
      },
      defeatBoss: function () {
        if (!boss || boss.dead) this.startBoss();
        boss.shielded = false;
        boss.challengeMode = false;
        boss.sequenceMode = false;
        boss.flash = 0;
        hitBoss(boss.hp);
        return window.__HIGH_NOTES__.snapshot();
      },
      defeatEnemies: function (group) {
        enemies.forEach(function (e) { if (!group || e.group === group) killEnemy(e); });
      },
      openMap: openMap,
      openInstruments: openInstruments,
      openSkills: openSkills,
      openHome: openHome,
      triggerWorldEvent: function(id){triggerWorldEvent(id);return encounterDirector.activeEvent||state.weather;},
      equipInstrument: function(id){
        if(!instrumentById(id)||state.unlockedInstruments.indexOf(id)<0)return false;
        state.equippedInstrument=id;updateHUD(true);return id;
      },
      chargeUltimate: function(){instrumentUltimateCharge=100;updateHUD(true);return instrumentUltimateCharge;},
      setWeather: function(weather){
        if(['clear','rain','fog','wind','crystal-storm','blood-moon','forest-bloom'].indexOf(weather)<0)return false;
        state.weather=weather;encounterDirector.weatherTimer=60;updateHUD(true);return weather;
      }
    }
  };
  canvas.dataset.runtimeReady = 'true';
  canvas.dataset.runtimeErrors = '0';

  boot();
})();
