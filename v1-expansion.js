(function () {
  'use strict';

  var PROTOCOL_VERSION = 1;
  var MAX_ROOM_PLAYERS = 4;
  var CONTRACTS_PER_REGION = 21;
  var REGION_DATA = [
    {id:'mossvale',stage:1,name:'Mossvale Grove',accent:'#7df7a1',material:'heartwood',prefix:'Verdant'},
    {id:'rootsong',stage:2,name:'Rootsong Hollows',accent:'#ff9d57',material:'sporeSilk',prefix:'Hollow'},
    {id:'skyglass',stage:3,name:'Skyglass Reach',accent:'#9de8ff',material:'prismDust',prefix:'Prismatic'},
    {id:'moonwake',stage:4,name:'Moonwake Coast',accent:'#86e8ff',material:'tidePearl',prefix:'Moonlit'}
  ];
  var PROFESSION_NAMES = {
    crafting:'Crafting',fishing:'Fishing',cooking:'Cooking',gardening:'Gardening',
    exploration:'Exploration',blocking:'Blocking',dodging:'Dodging',
    bossHunting:'Boss Hunting',questing:'Questing',trading:'Trading'
  };
  var MATERIAL_NAMES = {
    heartwood:'Heartwood',sporeSilk:'Spore Silk',prismDust:'Prism Dust',
    tidePearl:'Tide Pearl',echoCore:'Echo Core',beatcoins:'Beatcoins'
  };
  var ARENA_MODES = {
    duel:{name:'Resonance Duel',players:'2 players',description:'First knockout or highest health when the set ends.',limit:2},
    duos:{name:'Duet Clash',players:'2 vs 2',description:'Paired performers share a score while keeping separate health.',limit:4},
    ffa:{name:'Feedback Free-for-All',players:'2–4 players',description:'Every performer for themselves. Clean hits build the lead.',limit:4},
    king:{name:'King of the Beat',players:'2–4 players',description:'Hold the glowing centre stage to score every second.',limit:4},
    capture:{name:'Capture the Beat',players:'2–4 players',description:'Collect wandering resonance notes while defending your route.',limit:4},
    survival:{name:'Last Note Standing',players:'2–4 players',description:'A shrinking spotlight rewards movement and survival.',limit:4}
  };

  var hub = document.getElementById('productionHub');
  var content = document.getElementById('productionHubContent');
  var tabs = document.getElementById('productionTabs');
  var sidebar = document.getElementById('productionStatusCard');
  var profileSummary = document.getElementById('productionProfileSummary');
  var pauseScreen = document.getElementById('pauseScreen');
  var launchButton = document.getElementById('pauseProductionButton');
  var closeButton = document.getElementById('closeProductionHub');
  if (!hub || !content || !tabs || !launchButton || !window.__HIGH_NOTES__) return;

  var activeTab = 'guild';
  var selectedRegion = 'mossvale';
  var selectedArenaMode = 'duel';
  var hubOpen = false;
  var onlineRenderQueued = false;

  function gameApi() {
    return window.__HIGH_NOTES__;
  }

  function snapshot() {
    try {
      return gameApi().snapshot();
    } catch (error) {
      return null;
    }
  }

  function clamp(value,min,max) {
    return Math.max(min,Math.min(max,value));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function cleanText(value,maxLength) {
    return String(value == null ? '' : value)
      .replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,maxLength || 120);
  }

  function titleCase(value) {
    return String(value).replace(/([A-Z])/g,' $1').replace(/(^|\s)\w/g,function (letter) {
      return letter.toUpperCase();
    });
  }

  function formatNumber(value) {
    return Math.max(0,Math.floor(Number(value) || 0)).toLocaleString('en-GB');
  }

  function professionThreshold(level) {
    return 28 + level * 18;
  }

  var CONTRACT_TEMPLATES = [
    {slug:'quiet-the-road',title:'Road Quieting',goals:[8,18,32,48],objective:function(g){return 'Defeat ' + g + ' hostile echoes.';},metric:function(s){return s.state.totalKills || 0;},profession:'bossHunting'},
    {slug:'sound-check',title:'Sound Check',goals:[20,55,100,160],objective:function(g){return 'Complete ' + g + ' instrument attacks.';},metric:function(s){return s.state.statistics.attacksSwung || 0;},profession:'crafting'},
    {slug:'trail-tempo',title:'Trail Tempo',goals:[8,22,42,70],objective:function(g){return 'Perform ' + g + ' clean dodges.';},metric:function(s){return s.state.statistics.dashes || 0;},profession:'dodging'},
    {slug:'hold-the-line',title:'Hold the Line',goals:[5,16,32,54],objective:function(g){return 'Block ' + g + ' incoming attacks.';},metric:function(s){return s.state.statistics.blocksPerformed || 0;},profession:'blocking'},
    {slug:'perfect-guard',title:'Perfect Guard',goals:[1,5,12,22],objective:function(g){return 'Land ' + g + ' perfect ' + (g===1?'block.':'blocks.');},metric:function(s){return s.state.statistics.perfectBlocks || 0;},profession:'blocking'},
    {slug:'answering-chord',title:'Answering Chord',goals:[1,4,9,16],objective:function(g){return 'Perform ' + g + ' counter ' + (g===1?'attack.':'attacks.');},metric:function(s){return s.state.statistics.counterAttacks || 0;},profession:'blocking'},
    {slug:'combo-study',title:'Combo Study',goals:[8,16,28,40],objective:function(g){return 'Reach a Rhythm Combo of ' + g + '.';},metric:function(s){return s.state.statistics.highestCombo || 0;},profession:'questing'},
    {slug:'metronome-heart',title:'Metronome Heart',goals:[3,10,22,40],objective:function(g){return 'Strike ' + g + ' perfect beats.';},metric:function(s){return s.state.statistics.perfectBeats || 0;},profession:'questing'},
    {slug:'living-world',title:'Living World',goals:[1,4,8,14],objective:function(g){return 'Resolve ' + g + ' dynamic world ' + (g===1?'event.':'events.');},metric:function(s){return s.state.statistics.worldEventsCompleted || 0;},profession:'exploration'},
    {slug:'record-run',title:'Record Run',goals:[2,6,11,17],objective:function(g){return 'Recover ' + g + ' world collectibles.';},metric:function(s){return (s.state.collectibles || []).length;},profession:'exploration'},
    {slug:'promise-keeper',title:'Promise Keeper',goals:[2,6,12,18],objective:function(g){return 'Complete ' + g + ' story or side quests.';},metric:function(s){return s.state.statistics.questsCompleted || 0;},profession:'questing'},
    {slug:'brads-ledger',title:"Brad's Ledger",goals:[1,4,8,13],objective:function(g){return 'Complete ' + g + ' shop ' + (g===1?'purchase.':'purchases.');},metric:function(s){return s.state.statistics.shopPurchases || 0;},profession:'trading'},
    {slug:'local-economy',title:'Local Economy',goals:[8,30,70,130],objective:function(g){return 'Spend ' + g + ' Beatcoins with merchants.';},metric:function(s){return s.state.statistics.beatcoinsSpent || 0;},profession:'trading'},
    {slug:'field-medic',title:'Field Medic',goals:[3,10,22,38],objective:function(g){return 'Recover ' + g + ' hearts during adventures.';},metric:function(s){return s.state.statistics.heartsRecovered || 0;},profession:'cooking'},
    {slug:'small-legends',title:'Small Legends',goals:[1,2,4,7],objective:function(g){return 'Defeat ' + g + ' optional mini ' + (g===1?'boss.':'bosses.');},metric:function(s){return s.state.statistics.miniBossesDefeated || 0;},profession:'bossHunting'},
    {slug:'rare-company',title:'Rare Company',goals:[1,3,7,12],objective:function(g){return 'Defeat ' + g + ' elite ' + (g===1?'enemy.':'enemies.');},metric:function(s){return s.state.statistics.eliteEnemiesDefeated || 0;},profession:'bossHunting'},
    {slug:'unmarked-paths',title:'Unmarked Paths',goals:[1,2,4,7],objective:function(g){return 'Reveal ' + g + ' hidden locations.';},metric:function(s){return (s.state.discoveredSecrets || []).length;},profession:'exploration'},
    {slug:'neighbourly-noise',title:'Neighbourly Noise',goals:[5,15,30,50],objective:function(g,r){return 'Raise ' + r.name + ' reputation to ' + g + '.';},metric:function(s,r){return (s.state.regionalReputation || {})[r.id] || 0;},profession:'questing'},
    {slug:'field-discipline',title:'Field Discipline',goals:[2,3,5,7],objective:function(g){return 'Raise Exploration mastery to level ' + g + '.';},metric:function(s){return ((s.state.professions || {}).exploration || {}).level || 1;},profession:'exploration'},
    {slug:'instrument-voice',title:'Instrument Voice',goals:[2,4,7,10],objective:function(g){return 'Raise any instrument mastery to level ' + g + '.';},metric:function(s){return Math.max.apply(Math,Object.keys(s.state.instrumentMastery || {}).map(function(k){return (s.state.instrumentMastery[k] || {}).level || 1;}).concat([1]));},profession:'crafting'},
    {slug:'greenhouse-cycle',title:'Greenhouse Cycle',goals:[1,2,4,6],objective:function(g){return 'Complete ' + g + ' greenhouse ' + (g===1?'harvest.':'harvests.');},metric:function(s){return ((s.state.home || {}).greenhouseHarvests) || 0;},profession:'gardening'}
  ];

  var CONTRACTS = [];
  REGION_DATA.forEach(function (region,regionIndex) {
    CONTRACT_TEMPLATES.forEach(function (template,templateIndex) {
      var goal = template.goals[regionIndex];
      CONTRACTS.push({
        id:'contract-' + region.id + '-' + template.slug,
        region:region.id,
        stage:region.stage,
        name:region.prefix + ' ' + template.title,
        objective:template.objective(goal,region),
        goal:goal,
        metric:template.metric,
        profession:template.profession,
        beatcoins:8 + regionIndex * 5 + (templateIndex % 4) * 2,
        reputation:2 + regionIndex,
        material:region.material
      });
    });
  });

  function contractProgress(contract,stateSnapshot) {
    try {
      return Math.max(0,Math.floor(contract.metric(stateSnapshot,REGION_DATA[contract.stage-1]) || 0));
    } catch (error) {
      return 0;
    }
  }

  function renderProfileAndSidebar() {
    var current = snapshot();
    if (!current) return;
    var profile = current.state.onlineProfile || {};
    profileSummary.innerHTML =
      '<strong>' + escapeHtml(profile.displayName || 'Mossvale Player') + '</strong>' +
      '<span>Rating ' + formatNumber(profile.rating || 1000) + ' · ' +
      formatNumber(profile.wins) + 'W / ' + formatNumber(profile.losses) + 'L</span>';
    var materials = current.state.craftingMaterials || {};
    sidebar.innerHTML =
      '<p class="panel-kicker">FIELD STATUS</p>' +
      '<h3>' + escapeHtml(current.runtime.levelName || 'Mossvale') + '</h3>' +
      '<dl class="production-status-list">' +
      '<div><dt>Beatcoins</dt><dd>' + formatNumber(current.state.beatcoins) + '</dd></div>' +
      '<div><dt>Guild contracts</dt><dd>' + formatNumber((current.state.completedContracts || []).length) + ' / ' + CONTRACTS.length + '</dd></div>' +
      '<div><dt>Echo rating</dt><dd>' + formatNumber(profile.rating || 1000) + '</dd></div>' +
      '<div><dt>Heartwood</dt><dd>' + formatNumber(materials.heartwood) + '</dd></div>' +
      '<div><dt>Spore Silk</dt><dd>' + formatNumber(materials.sporeSilk) + '</dd></div>' +
      '<div><dt>Prism Dust</dt><dd>' + formatNumber(materials.prismDust) + '</dd></div>' +
      '<div><dt>Tide Pearls</dt><dd>' + formatNumber(materials.tidePearl) + '</dd></div>' +
      '<div><dt>Echo Cores</dt><dd>' + formatNumber(materials.echoCore) + '</dd></div>' +
      '</dl>' +
      '<div class="network-health ' + (network.room ? 'online' : '') + '">' +
      '<i aria-hidden="true"></i><span>' + escapeHtml(network.statusLabel()) + '</span></div>';
  }

  function setActiveTab(tab) {
    if (!/^(guild|crafting|mastery|social|online|arena)$/.test(tab)) return;
    activeTab = tab;
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-production-tab]'),function (button) {
      var active = button.dataset.productionTab === tab;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',active ? 'true' : 'false');
    });
    renderActiveTab();
  }

  function renderGuild() {
    var current = snapshot();
    if (!current) return;
    var active = current.state.activeContracts || [];
    var completed = current.state.completedContracts || [];
    var selected = REGION_DATA.find(function (region) { return region.id === selectedRegion; }) || REGION_DATA[0];
    var regionContracts = CONTRACTS.filter(function (contract) { return contract.region === selected.id; });
    content.innerHTML =
      '<div class="production-section-heading"><div><p class="panel-kicker">102 QUESTS &amp; CONTRACTS</p>' +
      '<h3>Resonance Guild Board</h3><p>18 story and side quests connect to 84 replayable regional commissions.</p></div>' +
      '<label class="production-select">Region<select id="guildRegionSelect">' +
      REGION_DATA.map(function (region) {
        return '<option value="' + region.id + '"' + (region.id === selected.id ? ' selected' : '') + '>' + escapeHtml(region.name) + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="guild-capacity"><strong>' + active.length + ' / 3 active</strong><span>' +
      completed.length + ' completed · progress is measured from your real adventure statistics</span></div>' +
      '<div class="contract-grid">' + regionContracts.map(function (contract) {
        var progress = contractProgress(contract,current);
        var isActive = active.indexOf(contract.id) >= 0;
        var isCompleted = completed.indexOf(contract.id) >= 0;
        var ready = isActive && progress >= contract.goal;
        var stateClass = isCompleted ? ' completed' : isActive ? ' active' : '';
        return '<article class="contract-card' + stateClass + '" style="--contract-accent:' + selected.accent + '">' +
          '<div class="contract-card-top"><span>' + escapeHtml(selected.name) + '</span><strong>' +
          (isCompleted ? 'COMPLETE' : isActive ? 'ACTIVE' : 'AVAILABLE') + '</strong></div>' +
          '<h4>' + escapeHtml(contract.name) + '</h4><p>' + escapeHtml(contract.objective) + '</p>' +
          '<div class="contract-progress"><span style="width:' + clamp(progress / contract.goal * 100,0,100) + '%"></span></div>' +
          '<div class="contract-meta"><span>' + Math.min(progress,contract.goal) + ' / ' + contract.goal + '</span><span>' +
          contract.beatcoins + ' coins · ' + escapeHtml(MATERIAL_NAMES[contract.material]) + '</span></div>' +
          (isCompleted ? '<button type="button" disabled>Filed in archive</button>' :
            ready ? '<button class="game-button button-primary" type="button" data-contract-claim="' + contract.id + '">Claim reward</button>' :
            isActive ? '<button type="button" disabled>In progress</button>' :
            '<button class="game-button button-secondary" type="button" data-contract-accept="' + contract.id + '"' +
            (active.length >= 3 ? ' disabled' : '') + '>Accept contract</button>') +
          '</article>';
      }).join('') + '</div>';
    document.getElementById('guildRegionSelect').addEventListener('change',function () {
      selectedRegion = this.value;
      renderGuild();
    });
    Array.prototype.forEach.call(content.querySelectorAll('[data-contract-accept]'),function (button) {
      button.addEventListener('click',function () {
        gameApi().production.acceptContract(button.dataset.contractAccept);
        renderGuild();
        renderProfileAndSidebar();
      });
    });
    Array.prototype.forEach.call(content.querySelectorAll('[data-contract-claim]'),function (button) {
      button.addEventListener('click',function () {
        var contract = CONTRACTS.find(function (item) { return item.id === button.dataset.contractClaim; });
        if (!contract) return;
        var latest = snapshot();
        if (contractProgress(contract,latest) < contract.goal) return;
        gameApi().production.claimContract(contract.id,{
          beatcoins:contract.beatcoins,reputation:contract.reputation,stage:contract.stage,
          profession:contract.profession,xp:14 + contract.stage * 3,
          material:contract.material,materialAmount:1 + (contract.stage === 4 ? 1 : 0)
        });
        renderGuild();
        renderProfileAndSidebar();
      });
    });
  }

  function recipeCostHtml(recipe,current) {
    return Object.keys(recipe.cost).map(function (key) {
      var owned = key === 'beatcoins' ? current.state.beatcoins : (current.state.craftingMaterials[key] || 0);
      var enough = owned >= recipe.cost[key];
      return '<span class="' + (enough ? '' : 'missing') + '">' + recipe.cost[key] + ' ' +
        escapeHtml(MATERIAL_NAMES[key] || titleCase(key)) + '</span>';
    }).join('');
  }

  function renderCrafting() {
    var current = snapshot();
    var catalog = gameApi().production.catalog();
    var known = current.state.knownRecipes || [];
    content.innerHTML =
      '<div class="production-section-heading"><div><p class="panel-kicker">WORKSHOP &amp; KITCHEN</p>' +
      '<h3>Resonance Crafting</h3><p>Enemy species, bosses, exploration, and the greenhouse feed one shared material loop.</p></div>' +
      '<span class="production-count">' + known.length + ' / ' + catalog.recipes.length + ' recipes</span></div>' +
      '<div class="recipe-grid">' + catalog.recipes.map(function (recipe) {
        var unlocked = known.indexOf(recipe.id) >= 0;
        var profession = (current.state.professions || {})[recipe.profession] || {level:1};
        var levelReady = profession.level >= recipe.level;
        var affordable = Object.keys(recipe.cost).every(function (key) {
          return (key === 'beatcoins' ? current.state.beatcoins : current.state.craftingMaterials[key] || 0) >= recipe.cost[key];
        });
        return '<article class="recipe-card' + (unlocked ? '' : ' locked') + '">' +
          '<div class="recipe-heading"><span aria-hidden="true">' + (recipe.profession === 'cooking' ? '♨' : '⚒') + '</span>' +
          '<div><small>' + escapeHtml(PROFESSION_NAMES[recipe.profession]) + ' · LV ' + recipe.level + '</small>' +
          '<h4>' + escapeHtml(unlocked ? recipe.name : 'Undiscovered Recipe') + '</h4></div></div>' +
          '<p>' + escapeHtml(unlocked ? recipe.effect : 'Raise mastery and progress through the connected region to reveal this design.') + '</p>' +
          '<div class="recipe-cost">' + (unlocked ? recipeCostHtml(recipe,current) : '<span>Recipe locked</span>') + '</div>' +
          '<button class="game-button button-primary" data-craft-recipe="' + recipe.id + '" type="button"' +
          (!unlocked || !levelReady || !affordable ? ' disabled' : '') + '>' +
          (!unlocked ? 'Locked' : !levelReady ? 'Mastery too low' : !affordable ? 'Missing materials' : 'Craft') + '</button></article>';
      }).join('') + '</div>';
    Array.prototype.forEach.call(content.querySelectorAll('[data-craft-recipe]'),function (button) {
      button.addEventListener('click',function () {
        gameApi().production.craft(button.dataset.craftRecipe);
        renderCrafting();
        renderProfileAndSidebar();
      });
    });
  }

  function renderMastery() {
    var current = snapshot();
    var professions = current.state.professions || {};
    content.innerHTML =
      '<div class="production-section-heading"><div><p class="panel-kicker">TEN CONNECTED DISCIPLINES</p>' +
      '<h3>Life &amp; Field Mastery</h3><p>Every level is earned by using the matching system, not by spending a disconnected currency.</p></div></div>' +
      '<div class="profession-grid">' + Object.keys(PROFESSION_NAMES).map(function (id) {
        var record = professions[id] || {xp:0,level:1};
        var threshold = professionThreshold(record.level);
        var percent = record.level >= 25 ? 100 : clamp(record.xp / threshold * 100,0,100);
        return '<article class="profession-card"><div><span class="profession-icon" aria-hidden="true">' +
          ({crafting:'⚒',fishing:'≈',cooking:'♨',gardening:'✿',exploration:'◇',blocking:'◈',dodging:'↝',bossHunting:'♛',questing:'!',trading:'◆'}[id] || '♪') +
          '</span><div><small>LEVEL ' + record.level + ' / 25</small><h4>' + escapeHtml(PROFESSION_NAMES[id]) + '</h4></div></div>' +
          '<div class="mastery-track"><span style="width:' + percent + '%"></span></div><p>' +
          (record.level >= 25 ? 'Mastered' : formatNumber(record.xp) + ' / ' + threshold + ' XP') + '</p></article>';
      }).join('') + '</div>' +
      '<section class="field-practice"><div><p class="panel-kicker">WORLD-SIDE PRACTICE</p><h3>Cast a Resonance Line</h3><p>' +
      (current.runtime.nearFishableWater ?
        'The water is in reach. Cast after returning to the field to earn Fishing XP and a regional material.' :
        'Stand beside a pond, river, or tidal pool to make fishing available here.') +
      '</p></div><button id="tryFishing" class="game-button button-secondary" type="button"' +
      (!current.runtime.nearFishableWater || current.runtime.fishingCooldown > 0 ? ' disabled' : '') + '>' +
      (current.runtime.fishingCooldown > 0 ? 'Line resting · ' + Math.ceil(current.runtime.fishingCooldown) + 's' :
        current.runtime.nearFishableWater ? 'Return & cast' : 'Find water') + '</button></section>' +
      '<section class="encore-panel"><div><p class="panel-kicker">POST-CAMPAIGN ENDGAME</p><h3>Dream Encore</h3><p>' +
      (current.state.dreamEncore.unlocked ?
        'Five escalating handcrafted waves suppress random encounters and reward Echo Cores, mastery, and rank.' :
        'Defeat each region boss to unlock the Dream Encore set.') +
      '</p></div><div class="encore-record"><strong>WAVE ' + formatNumber(current.state.dreamEncore.bestWave) +
      '</strong><span>Best · Rank ' + formatNumber(current.state.dreamEncore.rank) + '</span>' +
      '<button id="startDreamEncore" class="game-button button-primary" type="button"' +
      (!current.state.dreamEncore.unlocked ? ' disabled' : '') + '>Start five-wave set</button></div></section>';
    var fishing = document.getElementById('tryFishing');
    if (fishing && !fishing.disabled) {
      fishing.addEventListener('click',function () {
        closeHub();
        var resume = document.getElementById('resumeButton');
        if (resume) resume.click();
        window.setTimeout(function () { gameApi().production.fish(); },80);
      });
    }
    var start = document.getElementById('startDreamEncore');
    if (start && !start.disabled) {
      start.addEventListener('click',function () {
        closeHub();
        var resume = document.getElementById('resumeButton');
        if (resume) resume.click();
        window.setTimeout(function () {
          gameApi().production.startDreamEncore();
        },80);
      });
    }
  }

  function renderSocial() {
    var current = snapshot();
    var relationships = current.state.relationships || {};
    var people = Object.keys(relationships).map(function (id) {
      return {id:id,value:relationships[id]};
    }).sort(function (a,b) { return b.value-a.value; });
    var reputation = current.state.regionalReputation || {};
    content.innerHTML =
      '<div class="production-section-heading"><div><p class="panel-kicker">PEOPLE REMEMBER THE MUSIC</p>' +
      '<h3>Relationships &amp; Reputation</h3><p>Conversation, quest outcomes, and regional victories deepen the world without replacing existing dialogue.</p></div></div>' +
      '<div class="reputation-grid">' + REGION_DATA.map(function (region) {
        var value = reputation[region.id] || 0;
        return '<article style="--contract-accent:' + region.accent + '"><small>' + escapeHtml(region.name) + '</small>' +
          '<strong>' + value + ' / 100</strong><div><span style="width:' + value + '%"></span></div>' +
          '<p>' + (value >= 75 ? 'Beloved headliner' : value >= 50 ? 'Trusted local' : value >= 25 ? 'Familiar face' : 'New arrival') + '</p></article>';
      }).join('') + '</div>' +
      '<section class="relationship-list"><div class="production-section-heading compact"><div><p class="panel-kicker">BONDS</p><h3>Known Friends</h3></div>' +
      '<span>' + people.length + ' relationships</span></div>' +
      (people.length ? people.slice(0,24).map(function (person) {
        return '<div class="relationship-row"><strong>' + escapeHtml(titleCase(person.id.replace(/-/g,' '))) + '</strong>' +
          '<div><span style="width:' + person.value + '%"></span></div><small>' + person.value + ' / 100</small></div>';
      }).join('') : '<p class="production-empty">Speak with named characters in the world to begin building relationships.</p>') + '</section>';
  }

  function randomId(length) {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var bytes = new Uint8Array(length);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i=0;i<length;i++) bytes[i] = Math.floor(Math.random()*256);
    var result = '';
    for (var index=0;index<length;index++) result += alphabet[bytes[index] % alphabet.length];
    return result;
  }

  function getClientId() {
    var key = 'highNotesNetworkClientId';
    var id = '';
    try { id = sessionStorage.getItem(key) || ''; } catch (error) {}
    if (!/^[A-Z0-9]{12}$/.test(id)) {
      id = randomId(12);
      try { sessionStorage.setItem(key,id); } catch (error) {}
    }
    return id;
  }

  function NetworkSession() {
    this.id = getClientId();
    this.room = '';
    this.host = '';
    this.isPublic = false;
    this.peers = new Map();
    this.knownRooms = new Map();
    this.chat = [];
    this.remoteSnapshots = new Map();
    this.remoteVisuals = new Map();
    this.worldPings = [];
    this.channel = null;
    this.socket = null;
    this.socketStatus = 'offline';
    this.reconnectTimer = 0;
    this.lastSnapshot = null;
    this.lastSnapshotSent = 0;
    this.lastAdvertised = 0;
    this.lastPingSent = 0;
    this.joinedAt = 0;
    this.lastMaintenance = 0;
    this.lastSidebarRender = 0;
    this.lastRemoteCount = 0;
    this.lastWorldPingCount = 0;
    this.relayUrl = '';
    try {
      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('high-notes-echo-network-v1');
        this.channel.onmessage = this.receive.bind(this);
      }
    } catch (error) {
      this.channel = null;
    }
    try {
      this.relayUrl = cleanText(window.HIGH_NOTES_ONLINE_SERVER || localStorage.getItem('highNotesOnlineServer') || '',240);
    } catch (error) {}
    if (this.relayUrl) this.connectSocket();
    this.loopTimer = window.setInterval(this.tick.bind(this),100);
  }

  NetworkSession.prototype.profile = function () {
    var current = snapshot();
    return current ? current.state.onlineProfile : {displayName:'Mossvale Player',cosmetic:'grove',rating:1000};
  };

  NetworkSession.prototype.statusLabel = function () {
    if (this.room) return 'Room ' + this.room + ' · ' + this.peers.size + '/' + MAX_ROOM_PLAYERS + ' players';
    if (this.socketStatus === 'connected') return 'Internet relay connected';
    if (this.channel) return 'Private local peer transport ready';
    return 'Network transport unavailable';
  };

  NetworkSession.prototype.validRelay = function (url) {
    return /^wss:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(url) ||
      /^ws:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/.*)?$/i.test(url);
  };

  NetworkSession.prototype.configureRelay = function (url) {
    url = cleanText(url,240);
    if (url && !this.validRelay(url)) return false;
    this.relayUrl = url;
    try {
      if (url) localStorage.setItem('highNotesOnlineServer',url);
      else localStorage.removeItem('highNotesOnlineServer');
    } catch (error) {}
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.socketStatus = url ? 'connecting' : 'offline';
    if (url) this.connectSocket();
    queueOnlineRender();
    return true;
  };

  NetworkSession.prototype.connectSocket = function () {
    if (!this.validRelay(this.relayUrl) || this.socketStatus === 'connecting' || this.socketStatus === 'connected') return;
    var self = this;
    try {
      this.socketStatus = 'connecting';
      this.socket = new WebSocket(this.relayUrl);
      this.socket.onopen = function () {
        self.socketStatus = 'connected';
        self.reconnectTimer = 0;
        self.send('hello',{profile:self.profile()},'');
        queueOnlineRender();
      };
      this.socket.onmessage = function (event) {
        if (typeof event.data !== 'string' || event.data.length > 16384) return;
        try { self.receive({data:JSON.parse(event.data)}); } catch (error) {}
      };
      this.socket.onerror = function () {
        self.socketStatus = 'error';
        queueOnlineRender();
      };
      this.socket.onclose = function () {
        self.socket = null;
        self.socketStatus = 'offline';
        self.scheduleReconnect();
        queueOnlineRender();
      };
    } catch (error) {
      this.socket = null;
      this.socketStatus = 'error';
      this.scheduleReconnect();
    }
  };

  NetworkSession.prototype.scheduleReconnect = function () {
    if (!this.relayUrl || this.reconnectTimer) return;
    var self = this;
    var delay = 1500 + Math.floor(Math.random()*750);
    this.reconnectTimer = window.setTimeout(function () {
      self.reconnectTimer = 0;
      self.connectSocket();
    },delay);
  };

  NetworkSession.prototype.message = function (type,payload,room) {
    return {v:PROTOCOL_VERSION,type:type,from:this.id,room:room == null ? this.room : room,
      payload:payload || {},ts:Date.now()};
  };

  NetworkSession.prototype.send = function (type,payload,room) {
    var message = this.message(type,payload,room);
    if (this.channel) {
      try { this.channel.postMessage(message); } catch (error) {}
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify(message)); } catch (error) {}
    }
    return message;
  };

  NetworkSession.prototype.createRoom = function (makePublic) {
    this.leave();
    this.room = randomId(6);
    this.host = this.id;
    this.joinedAt = Date.now();
    this.isPublic = !!makePublic && this.socketStatus === 'connected';
    this.peers.set(this.id,{id:this.id,profile:this.profile(),lastSeen:performance.now(),ping:0});
    this.send('room-create',{public:this.isPublic,profile:this.profile(),limit:MAX_ROOM_PLAYERS});
    this.advertise();
    queueOnlineRender();
    return this.room;
  };

  NetworkSession.prototype.joinRoom = function (code) {
    code = cleanText(code,6).toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (code.length !== 6) return false;
    this.leave();
    this.room = code;
    this.host = '';
    this.joinedAt = Date.now();
    this.peers.set(this.id,{id:this.id,profile:this.profile(),lastSeen:performance.now(),ping:0});
    this.send('room-join',{profile:this.profile()});
    queueOnlineRender();
    return true;
  };

  NetworkSession.prototype.leave = function () {
    if (this.room) this.send('room-leave',{});
    this.room = '';
    this.host = '';
    this.joinedAt = 0;
    this.isPublic = false;
    this.peers.clear();
    this.remoteSnapshots.clear();
    this.remoteVisuals.clear();
    this.worldPings = [];
    this.lastRemoteCount = 0;
    this.lastWorldPingCount = 0;
    gameApi().production.setRemotePlayers([]);
    gameApi().production.setWorldPings([]);
    queueOnlineRender();
  };

  NetworkSession.prototype.advertise = function () {
    if (!this.room || this.host !== this.id) return;
    this.send('room-advertise',{
      public:this.isPublic,profile:this.profile(),players:this.peers.size,limit:MAX_ROOM_PLAYERS,
      mode:selectedArenaMode
    },this.room);
    this.lastAdvertised = Date.now();
  };

  NetworkSession.prototype.migrateHost = function () {
    if (!this.room) return;
    var ids = Array.from(this.peers.keys()).sort();
    var next = ids[0] || this.id;
    if (next !== this.host) {
      this.host = next;
      if (next === this.id) this.send('host-migrate',{host:next});
      this.pushChat('SYSTEM','Host migrated without closing the lobby.','system');
    }
  };

  NetworkSession.prototype.pushChat = function (author,text,kind) {
    this.chat.push({author:cleanText(author,20),text:cleanText(text,120),kind:kind || 'chat',at:Date.now()});
    if (this.chat.length > 40) this.chat.splice(0,this.chat.length-40);
    queueOnlineRender();
  };

  NetworkSession.prototype.chatMessage = function (text) {
    text = cleanText(text,120);
    if (!this.room || !text) return;
    this.pushChat(this.profile().displayName,text,'chat');
    this.send('chat',{text:text,profile:this.profile()});
  };

  NetworkSession.prototype.emote = function (emote) {
    if (['Encore!','Nice block!','Over here!','Ready?'].indexOf(emote) < 0 || !this.room) return;
    this.pushChat(this.profile().displayName,emote,'emote');
    this.send('emote',{emote:emote,profile:this.profile()});
  };

  NetworkSession.prototype.worldPing = function () {
    if (!this.room) return false;
    var current = snapshot();
    if (!current || !current.runtime.started) return false;
    var profile = this.profile();
    var ping = {
      id:this.id + '-' + Date.now(),x:current.player.x,y:current.player.y,stage:current.state.stage,
      label:cleanText(profile.displayName || 'Player',20) + ' · OVER HERE',
      color:profile.cosmetic === 'rootsong' ? '#ff9d57' : profile.cosmetic === 'skyglass' ? '#9de8ff' :
        profile.cosmetic === 'moonwake' ? '#86e8ff' : '#7df7a1',
      created:performance.now()
    };
    this.worldPings.push(ping);
    this.send('world-ping',ping);
    return true;
  };

  NetworkSession.prototype.receive = function (event) {
    var message = event && event.data;
    if (!message || typeof message !== 'object' || message.v !== PROTOCOL_VERSION ||
        message.from === this.id || typeof message.type !== 'string') return;
    if (!/^[A-Z0-9]{12}$/.test(String(message.from || ''))) return;
    var allowedTypes = ['room-advertise','room-join','room-welcome','room-reject','room-leave','host-migrate',
      'profile','snapshot','world-ping','chat','emote','ping','pong','arena-state','arena-hit'];
    if (allowedTypes.indexOf(message.type) < 0) return;
    if (message.type === 'room-advertise') {
      if (message.payload && message.payload.public && /^[A-Z0-9]{6}$/.test(message.room || '')) {
        this.knownRooms.set(message.room,{
          code:message.room,profile:message.payload.profile || {},players:clamp(Number(message.payload.players)||1,1,4),
          limit:4,mode:message.payload.mode || 'duel',lastSeen:performance.now()
        });
        queueOnlineRender();
      }
      return;
    }
    if (!this.room || message.room !== this.room) return;
    var payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    var knownPeer = this.peers.get(message.from);
    if (!knownPeer && ['room-join','room-welcome','room-reject'].indexOf(message.type) < 0) return;
    var peer = knownPeer || {id:message.from,profile:payload.profile || {},ping:0};
    peer.lastSeen = performance.now();
    peer.ping = clamp(Date.now() - (Number(message.ts) || Date.now()),0,999);
    if (payload.profile) peer.profile = payload.profile;
    this.peers.set(message.from,peer);
    if (message.type === 'room-join') {
      if (this.peers.size > MAX_ROOM_PLAYERS) {
        this.peers.delete(message.from);
        this.send('room-reject',{target:message.from,reason:'full'});
        return;
      }
      if (this.host === this.id) {
        this.send('room-welcome',{
          target:message.from,host:this.host,public:this.isPublic,
          peers:Array.from(this.peers.values()).map(function (item) { return {id:item.id,profile:item.profile}; })
        });
      }
      this.pushChat('SYSTEM',cleanText((peer.profile || {}).displayName || 'A player',20) + ' joined the lobby.','system');
    } else if (message.type === 'room-welcome') {
      if (payload.target && payload.target !== this.id) return;
      this.host = /^[A-Z0-9]{12}$/.test(payload.host || '') ? payload.host : message.from;
      this.joinedAt = 0;
      this.isPublic = !!payload.public;
      (Array.isArray(payload.peers) ? payload.peers : []).slice(0,4).forEach(function (item) {
        if (item && /^[A-Z0-9]{12}$/.test(item.id || '')) {
          network.peers.set(item.id,{id:item.id,profile:item.profile || {},lastSeen:performance.now(),ping:0});
        }
      });
    } else if (message.type === 'room-reject') {
      if (payload.target === this.id) {
        this.pushChat('SYSTEM','That lobby is full.','system');
        this.leave();
      }
    } else if (message.type === 'room-leave') {
      this.peers.delete(message.from);
      this.remoteSnapshots.delete(message.from);
      this.remoteVisuals.delete(message.from);
      this.migrateHost();
    } else if (message.type === 'host-migrate') {
      if (/^[A-Z0-9]{12}$/.test(payload.host || '')) this.host = payload.host;
    } else if (message.type === 'snapshot') {
      var previousRemote = this.remoteSnapshots.get(message.from);
      var receivedAt = performance.now();
      var remoteX = Number(payload.x) || 0;
      var remoteY = Number(payload.y) || 0;
      var remoteDelta = previousRemote ? Math.max(0.016,(receivedAt-previousRemote.updated)/1000) : 0.1;
      this.remoteSnapshots.set(message.from,{
        id:message.from,name:cleanText((peer.profile || {}).displayName || 'Guest',20),
        cosmetic:['grove','rootsong','skyglass','moonwake'].indexOf((peer.profile || {}).cosmetic) >= 0 ? peer.profile.cosmetic : 'grove',
        x:remoteX,y:remoteY,
        vx:previousRemote ? (remoteX-previousRemote.x)/remoteDelta : 0,
        vy:previousRemote ? (remoteY-previousRemote.y)/remoteDelta : 0,
        facing:Number(payload.facing) || 0,
        moving:!!payload.moving,attacking:!!payload.attacking,
        odin:!!payload.odin,
        stage:clamp(Math.floor(Number(payload.stage)||1),1,4),
        instrument:cleanText(payload.instrument,16),resonance:cleanText(payload.resonance,16),
        quests:clamp(Math.floor(Number(payload.quests)||0),0,999),
        bosses:clamp(Math.floor(Number(payload.bosses)||0),0,99),
        ping:peer.ping,updated:receivedAt
      });
    } else if (message.type === 'world-ping') {
      if (peer.lastWorldPingAt && performance.now()-peer.lastWorldPingAt < 1400) return;
      peer.lastWorldPingAt = performance.now();
      this.worldPings.push({
        id:cleanText(payload.id,64),x:Number(payload.x)||0,y:Number(payload.y)||0,
        stage:clamp(Math.floor(Number(payload.stage)||1),1,4),
        label:cleanText(payload.label,24),color:/^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#ffc857',
        created:performance.now()
      });
      if (this.worldPings.length > 8) this.worldPings.splice(0,this.worldPings.length-8);
    } else if (message.type === 'chat') {
      if (peer.lastChatAt && performance.now()-peer.lastChatAt < 300) return;
      peer.lastChatAt = performance.now();
      this.pushChat((peer.profile || {}).displayName || 'Guest',payload.text,'chat');
    } else if (message.type === 'emote') {
      if (['Encore!','Nice block!','Over here!','Ready?'].indexOf(payload.emote) >= 0) {
        this.pushChat((peer.profile || {}).displayName || 'Guest',payload.emote,'emote');
      }
    } else if (message.type === 'ping') {
      this.send('pong',{target:message.from,stamp:payload.stamp});
    } else if (message.type === 'pong' && payload.target === this.id) {
      peer.ping = clamp(Date.now() - Number(payload.stamp || Date.now()),0,999);
    } else if (message.type === 'arena-state') {
      arena.receiveState(message.from,payload,peer);
    } else if (message.type === 'arena-hit') {
      arena.receiveHit(message.from,payload);
    }
    if (['snapshot','arena-state','ping','pong'].indexOf(message.type) < 0) queueOnlineRender();
  };

  NetworkSession.prototype.sendSnapshot = function () {
    if (!this.room) return;
    var current = snapshot();
    if (!current || !current.runtime.started) return;
    var previous = this.lastSnapshot;
    var moving = !!previous && (Math.abs(previous.x-current.player.x)>0.2 || Math.abs(previous.y-current.player.y)>0.2);
    this.lastSnapshot = {x:current.player.x,y:current.player.y};
    this.send('snapshot',{
      x:Math.round(current.player.x*10)/10,y:Math.round(current.player.y*10)/10,
      facing:current.player.facing,moving:moving,attacking:current.runtime.attacks>0,
      stage:current.state.stage,instrument:current.state.equippedInstrument,
      odin:!!current.state.odinRecruited,resonance:current.state.activeResonance || '',
      quests:(current.state.completedQuests || []).length,bosses:(current.state.stageBosses || []).length
    });
  };

  NetworkSession.prototype.tick = function () {
    var now = performance.now();
    var self = this;
    var maintenanceDue = now-this.lastMaintenance >= 500;
    if (maintenanceDue) {
      this.lastMaintenance = now;
      this.knownRooms.forEach(function (room,code) {
        if (now-room.lastSeen > 6500) self.knownRooms.delete(code);
      });
    }
    if (this.room) {
      if (maintenanceDue) {
        this.peers.forEach(function (peer,id) {
          if (id !== self.id && now-(peer.lastSeen || 0) > 8500) {
            self.peers.delete(id);
            self.remoteSnapshots.delete(id);
            self.remoteVisuals.delete(id);
          }
        });
        if (this.host && !this.peers.has(this.host)) this.migrateHost();
        if (!this.host && this.joinedAt && Date.now()-this.joinedAt > 4500) {
          this.pushChat('SYSTEM','No host answered that room code.','system');
          this.leave();
          return;
        }
        if (this.host === this.id && Date.now()-this.lastAdvertised > 1800) this.advertise();
        if (Date.now()-this.lastPingSent > 2500) {
          this.lastPingSent = Date.now();
          this.send('ping',{stamp:this.lastPingSent});
        }
      }
      if (Date.now()-this.lastSnapshotSent >= 100) {
        this.lastSnapshotSent = Date.now();
        this.sendSnapshot();
      }
    }
    var remotes = [];
    this.remoteSnapshots.forEach(function (remote) {
      if (now-remote.updated >= 3000) return;
      var visual = self.remoteVisuals.get(remote.id);
      if (!visual) visual = Object.assign({},remote);
      var predictionSeconds = clamp((now-remote.updated)/1000,0,0.12);
      var targetX = remote.x + clamp(remote.vx || 0,-260,260)*predictionSeconds;
      var targetY = remote.y + clamp(remote.vy || 0,-260,260)*predictionSeconds;
      visual.x += (targetX-visual.x)*0.42;
      visual.y += (targetY-visual.y)*0.42;
      ['name','cosmetic','facing','moving','attacking','odin','stage','instrument','ping'].forEach(function (key) {
        visual[key] = remote[key];
      });
      self.remoteVisuals.set(remote.id,visual);
      remotes.push(visual);
    });
    this.worldPings = this.worldPings.filter(function (ping) { return now-ping.created < 5500; });
    if (this.room || this.lastRemoteCount) gameApi().production.setRemotePlayers(remotes);
    if (this.room || this.lastWorldPingCount) gameApi().production.setWorldPings(this.worldPings);
    this.lastRemoteCount = remotes.length;
    this.lastWorldPingCount = this.worldPings.length;
    if (hubOpen && now-this.lastSidebarRender >= 1000) {
      this.lastSidebarRender = now;
      renderProfileAndSidebar();
    }
  };

  var network = new NetworkSession();

  function queueOnlineRender() {
    if (onlineRenderQueued) return;
    onlineRenderQueued = true;
    window.requestAnimationFrame(function () {
      onlineRenderQueued = false;
      if (hubOpen && activeTab === 'online') renderOnline();
      else if (hubOpen) renderProfileAndSidebar();
    });
  }

  function renderOnline() {
    var current = snapshot();
    var profile = current.state.onlineProfile || {};
    var rooms = Array.from(network.knownRooms.values());
    var peers = Array.from(network.peers.values());
    var relayConfigured = !!network.relayUrl;
    content.innerHTML =
      '<div class="production-section-heading"><div><p class="panel-kicker">2–4 PLAYER SESSION LAYER</p>' +
      '<h3>Echo Network</h3><p>Private room codes work between tabs now. Internet-wide lobbies activate when a compatible secure relay is configured.</p></div>' +
      '<span class="transport-badge ' + network.socketStatus + '">' + escapeHtml(network.socketStatus === 'connected' ? 'WSS CONNECTED' : 'LOCAL PEER MODE') + '</span></div>' +
      '<div class="online-grid"><section class="online-card"><h4>Performer profile</h4>' +
      '<label>Display name<input id="onlineDisplayName" maxlength="20" value="' + escapeHtml(profile.displayName || '') + '"></label>' +
      '<label>Trail colour<select id="onlineCosmetic">' +
      ['grove','rootsong','skyglass','moonwake'].map(function (id) {
        return '<option value="' + id + '"' + (profile.cosmetic === id ? ' selected' : '') + '>' + titleCase(id) + '</option>';
      }).join('') + '</select></label><button id="saveOnlineProfile" class="game-button button-secondary" type="button">Save profile</button></section>' +
      '<section class="online-card"><h4>Secure internet relay</h4><p class="online-help">' +
      (relayConfigured ? 'The client will reconnect automatically if the relay drops.' :
        'GitHub Pages is static hosting, so public matchmaking is disabled until a WSS relay is supplied.') +
      '</p><label>WSS endpoint<input id="onlineRelayUrl" inputmode="url" placeholder="wss://your-relay.example" value="' +
      escapeHtml(network.relayUrl) + '"></label><button id="saveRelay" class="game-button button-secondary" type="button">' +
      (relayConfigured ? 'Reconnect relay' : 'Configure relay') + '</button></section></div>' +
      (network.room ?
        '<section class="lobby-panel"><div class="lobby-code"><small>ROOM CODE</small><strong>' + network.room + '</strong>' +
        '<span>' + (network.host === network.id ? 'You are host' : 'Host migration ready') + ' · ' + peers.length + '/' + MAX_ROOM_PLAYERS + '</span></div>' +
        '<div class="lobby-actions"><button id="copyRoomCode" class="game-button button-secondary" type="button">Copy code</button>' +
        '<button id="worldPing" class="game-button button-secondary" type="button">Ping location</button>' +
        '<button id="leaveRoom" class="game-button button-danger" type="button">Leave lobby</button></div>' +
        '<div class="peer-grid">' + peers.map(function (peer) {
          var peerProfile = peer.profile || {};
          var presence = network.remoteSnapshots.get(peer.id);
          return '<article><i class="' + escapeHtml(peerProfile.cosmetic || 'grove') + '"></i><div><strong>' +
            escapeHtml(peerProfile.displayName || (peer.id === network.id ? profile.displayName : 'Guest')) + '</strong><small>' +
            (peer.id === network.host ? 'HOST · ' : '') + (peer.id === network.id ? 'YOU' :
              'STAGE ' + (presence ? presence.stage : '?') + ' · ' + formatNumber(peer.ping) + 'ms') +
            '</small></div></article>';
        }).join('') + '</div></section>' :
        '<div class="online-grid"><section class="online-card lobby-create"><h4>Create a lobby</h4>' +
        '<p>Private codes use the local peer channel and any configured relay. Public discovery requires the WSS relay.</p>' +
        '<button id="createPrivateRoom" class="game-button button-primary" type="button">Create private room</button>' +
        '<button id="createPublicRoom" class="game-button button-secondary" type="button"' +
        (network.socketStatus !== 'connected' ? ' disabled' : '') + '>Create public lobby</button></section>' +
        '<section class="online-card"><h4>Join by code</h4><label>Six-character room code<input id="joinRoomCode" maxlength="6" autocomplete="off" spellcheck="false"></label>' +
        '<button id="joinRoom" class="game-button button-primary" type="button">Join room</button></section></div>') +
      '<section class="public-lobbies"><div class="production-section-heading compact"><div><p class="panel-kicker">PUBLIC LOBBIES</p><h3>Now playing</h3></div><span>' +
      rooms.length + ' found</span></div>' +
      (rooms.length ? rooms.map(function (room) {
        return '<button type="button" data-join-public="' + room.code + '"><strong>' +
          escapeHtml((room.profile || {}).displayName || 'Mossvale lobby') + '</strong><span>' +
          room.players + '/' + room.limit + ' · ' + escapeHtml((ARENA_MODES[room.mode] || ARENA_MODES.duel).name) +
          '</span><em>' + room.code + '</em></button>';
      }).join('') : '<p class="production-empty">' +
        (network.socketStatus === 'connected' ? 'No public rooms are advertising right now.' :
          'Connect a secure relay to browse internet-wide rooms. Private room codes remain available locally.') + '</p>') + '</section>' +
      (network.room ? '<section class="network-chat"><div class="chat-log" aria-live="polite">' +
        (network.chat.length ? network.chat.slice(-16).map(function (line) {
          return '<p class="' + escapeHtml(line.kind) + '"><strong>' + escapeHtml(line.author) + '</strong><span>' + escapeHtml(line.text) + '</span></p>';
        }).join('') : '<p class="system"><span>Room chat is ready.</span></p>') + '</div>' +
        '<form id="networkChatForm"><input id="networkChatInput" maxlength="120" autocomplete="off" placeholder="Message the lobby">' +
        '<button class="game-button button-primary" type="submit">Send</button></form>' +
        '<div class="emote-row">' + ['Encore!','Nice block!','Over here!','Ready?'].map(function (emote) {
          return '<button type="button" data-network-emote="' + escapeHtml(emote) + '">' + escapeHtml(emote) + '</button>';
        }).join('') + '</div></section>' : '');

    var saveProfile = document.getElementById('saveOnlineProfile');
    saveProfile.addEventListener('click',function () {
      gameApi().production.setProfile({
        displayName:document.getElementById('onlineDisplayName').value,
        cosmetic:document.getElementById('onlineCosmetic').value
      });
      if (network.room) network.send('profile',{profile:network.profile()});
      renderOnline();
    });
    document.getElementById('saveRelay').addEventListener('click',function () {
      var field = document.getElementById('onlineRelayUrl');
      if (!network.configureRelay(field.value)) {
        field.setCustomValidity('Use a secure wss:// endpoint (or ws://localhost for development).');
        field.reportValidity();
      }
    });
    var createPrivate = document.getElementById('createPrivateRoom');
    if (createPrivate) createPrivate.addEventListener('click',function () { network.createRoom(false); renderOnline(); });
    var createPublic = document.getElementById('createPublicRoom');
    if (createPublic) createPublic.addEventListener('click',function () { network.createRoom(true); renderOnline(); });
    var join = document.getElementById('joinRoom');
    if (join) join.addEventListener('click',function () {
      var field = document.getElementById('joinRoomCode');
      if (!network.joinRoom(field.value)) {
        field.setCustomValidity('Enter the complete six-character room code.');
        field.reportValidity();
      }
    });
    var leave = document.getElementById('leaveRoom');
    if (leave) leave.addEventListener('click',function () { network.leave(); renderOnline(); });
    var copy = document.getElementById('copyRoomCode');
    if (copy) copy.addEventListener('click',function () {
      if (navigator.clipboard) navigator.clipboard.writeText(network.room);
      copy.textContent = 'Copied';
    });
    var worldPing = document.getElementById('worldPing');
    if (worldPing) worldPing.addEventListener('click',function () {
      network.worldPing();
      worldPing.textContent = 'Ping sent';
    });
    Array.prototype.forEach.call(content.querySelectorAll('[data-join-public]'),function (button) {
      button.addEventListener('click',function () { network.joinRoom(button.dataset.joinPublic); });
    });
    var chatForm = document.getElementById('networkChatForm');
    if (chatForm) chatForm.addEventListener('submit',function (event) {
      event.preventDefault();
      var input = document.getElementById('networkChatInput');
      network.chatMessage(input.value);
      input.value = '';
    });
    Array.prototype.forEach.call(content.querySelectorAll('[data-network-emote]'),function (button) {
      button.addEventListener('click',function () { network.emote(button.dataset.networkEmote); });
    });
  }

  function EchoArena() {
    this.active = false;
    this.training = true;
    this.local = null;
    this.bot = null;
    this.remote = new Map();
    this.keys = new Set();
    this.lastTime = performance.now();
    this.lastNetworkSend = 0;
    this.lastAttacks = new Map();
    this.background = new Image();
    this.background.src = 'assets/echo-arena-background.webp';
    this.hero = new Image();
    this.hero.src = 'assets/sprites/runtime/hero-sheet.png';
    this.beat = {x:450,y:250};
    this.animationFrame = window.requestAnimationFrame(this.frame.bind(this));
  }

  EchoArena.prototype.resetPerformer = function (x,y,name,cosmetic) {
    return {x:x,y:y,vx:0,vy:0,facing:0,hp:100,maxHp:100,score:0,cooldown:0,dodge:0,
      attackFlash:0,name:name,cosmetic:cosmetic || 'grove'};
  };

  EchoArena.prototype.start = function (training,remoteStart) {
    var profile = network.profile();
    this.training = !!training || !network.room || network.peers.size < 2;
    this.active = true;
    this.local = this.resetPerformer(190,250,profile.displayName,profile.cosmetic);
    this.bot = this.training ? this.resetPerformer(710,250,'Echo Rival','moonwake') : null;
    this.remote.clear();
    this.time = 90;
    this.beat = {x:450,y:250};
    if (network.room && !remoteStart) network.send('arena-state',this.serialise(true));
    renderArena();
  };

  EchoArena.prototype.stop = function () {
    this.active = false;
    this.remote.clear();
  };

  EchoArena.prototype.serialise = function (starting) {
    if (!this.local) return {};
    return {
      mode:selectedArenaMode,starting:!!starting,x:Math.round(this.local.x*10)/10,
      y:Math.round(this.local.y*10)/10,facing:this.local.facing,hp:this.local.hp,
      score:this.local.score,dodge:this.local.dodge > 0,attack:this.local.attackFlash > 0
    };
  };

  EchoArena.prototype.receiveState = function (id,payload,peer) {
    if (payload.starting && !this.active && hubOpen && activeTab === 'arena') {
      if (ARENA_MODES[payload.mode]) selectedArenaMode = payload.mode;
      this.start(false,true);
    }
    if (!this.active || payload.mode !== selectedArenaMode) return;
    var performer = this.remote.get(id) || this.resetPerformer(710,250,
      cleanText((peer.profile || {}).displayName || 'Guest',20),(peer.profile || {}).cosmetic);
    performer.targetX = clamp(Number(payload.x)||450,25,875);
    performer.targetY = clamp(Number(payload.y)||250,35,465);
    performer.facing = Number(payload.facing)||0;
    performer.hp = clamp(Number(payload.hp)||0,0,100);
    performer.score = clamp(Math.floor(Number(payload.score)||0),0,999);
    performer.dodge = payload.dodge ? 0.12 : 0;
    performer.attackFlash = payload.attack ? 0.12 : 0;
    this.remote.set(id,performer);
  };

  EchoArena.prototype.receiveHit = function (attacker,payload) {
    if (!this.active || !this.local || payload.target !== network.id) return;
    var last = this.lastAttacks.get(attacker) || 0;
    if (performance.now()-last < 310 || this.local.dodge > 0) return;
    var remote = this.remote.get(attacker);
    if (!remote || Math.hypot(remote.x-this.local.x,remote.y-this.local.y) > 88) return;
    this.lastAttacks.set(attacker,performance.now());
    this.local.hp = Math.max(0,this.local.hp-clamp(Math.floor(Number(payload.damage)||12),1,16));
  };

  EchoArena.prototype.action = function (action) {
    if (!this.active || !this.local) return;
    if (action === 'dodge' && this.local.dodge <= 0 && this.local.cooldown <= 0.15) {
      this.local.dodge = 0.32;
      this.local.cooldown = 0.5;
      this.local.x = clamp(this.local.x + Math.cos(this.local.facing)*38,24,876);
      this.local.y = clamp(this.local.y + Math.sin(this.local.facing)*38,34,466);
      return;
    }
    if (action !== 'attack' || this.local.cooldown > 0) return;
    this.local.cooldown = 0.42;
    this.local.attackFlash = 0.22;
    var self = this;
    if (this.bot && Math.hypot(this.bot.x-this.local.x,this.bot.y-this.local.y) < 76 && this.bot.dodge <= 0) {
      this.bot.hp = Math.max(0,this.bot.hp-14);
      this.local.score += 10;
    }
    this.remote.forEach(function (remote,id) {
      if (Math.hypot(remote.x-self.local.x,remote.y-self.local.y) < 76 && remote.dodge <= 0) {
        network.send('arena-hit',{target:id,damage:12,attackId:randomId(6)});
        self.local.score += 8;
      }
    });
  };

  EchoArena.prototype.finish = function (won) {
    if (!this.active) return;
    var rated = !this.training && network.room && network.peers.size > 1;
    this.active = false;
    if (rated) gameApi().production.recordArenaResult(!!won);
    renderArena();
  };

  EchoArena.prototype.update = function (dt) {
    if (!this.active || !this.local) return;
    this.time = Math.max(0,this.time-dt);
    var x = (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0) -
      (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? 1 : 0);
    var y = (this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0) -
      (this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0);
    if (x || y) {
      var length = Math.hypot(x,y) || 1;
      this.local.facing = Math.atan2(y,x);
      var speed = this.local.dodge > 0 ? 280 : 155;
      this.local.x = clamp(this.local.x+x/length*speed*dt,24,876);
      this.local.y = clamp(this.local.y+y/length*speed*dt,34,466);
    }
    this.local.cooldown = Math.max(0,this.local.cooldown-dt);
    this.local.dodge = Math.max(0,this.local.dodge-dt);
    this.local.attackFlash = Math.max(0,this.local.attackFlash-dt);
    var self = this;
    this.remote.forEach(function (performer) {
      performer.x += ((performer.targetX == null ? performer.x : performer.targetX)-performer.x)*Math.min(1,dt*10);
      performer.y += ((performer.targetY == null ? performer.y : performer.targetY)-performer.y)*Math.min(1,dt*10);
      performer.dodge = Math.max(0,performer.dodge-dt);
      performer.attackFlash = Math.max(0,performer.attackFlash-dt);
    });
    if (this.bot) {
      var dx = this.local.x-this.bot.x;
      var dy = this.local.y-this.bot.y;
      var distance = Math.hypot(dx,dy) || 1;
      this.bot.facing = Math.atan2(dy,dx);
      var botSpeed = selectedArenaMode === 'survival' ? 142 : 118;
      if (distance > 58) {
        this.bot.x += dx/distance*botSpeed*dt;
        this.bot.y += dy/distance*botSpeed*dt;
      }
      this.bot.cooldown = Math.max(0,this.bot.cooldown-dt);
      this.bot.dodge = Math.max(0,this.bot.dodge-dt);
      this.bot.attackFlash = Math.max(0,this.bot.attackFlash-dt);
      if (distance < 70 && this.bot.cooldown <= 0) {
        this.bot.cooldown = 0.7;
        this.bot.attackFlash = 0.2;
        if (this.local.dodge <= 0) this.local.hp = Math.max(0,this.local.hp-10);
      }
    }
    if (selectedArenaMode === 'king') {
      if (Math.hypot(this.local.x-450,this.local.y-250) < 78) this.local.score += dt*3;
      if (this.bot && Math.hypot(this.bot.x-450,this.bot.y-250) < 78) this.bot.score += dt*3;
    } else if (selectedArenaMode === 'capture') {
      if (Math.hypot(this.local.x-this.beat.x,this.local.y-this.beat.y) < 34) {
        this.local.score += 15;
        this.beat.x = 100+Math.random()*700;
        this.beat.y = 80+Math.random()*340;
      }
    } else if (selectedArenaMode === 'survival') {
      var radius = 210+Math.sin(this.time*.11)*90;
      if (Math.hypot(this.local.x-450,this.local.y-250) > radius) this.local.hp = Math.max(0,this.local.hp-dt*9);
    }
    if (network.room && performance.now()-this.lastNetworkSend > 100) {
      this.lastNetworkSend = performance.now();
      network.send('arena-state',this.serialise(false));
    }
    if (this.local.hp <= 0) this.finish(false);
    else if (this.bot && this.bot.hp <= 0) this.finish(true);
    else if (this.time <= 0) {
      var opponentScore = this.bot ? this.bot.score : Math.max.apply(Math,Array.from(this.remote.values()).map(function(p){return p.score;}).concat([0]));
      this.finish(this.local.score >= opponentScore);
    }
  };

  EchoArena.prototype.drawPerformer = function (ctx,performer,index) {
    ctx.save();
    ctx.translate(performer.x,performer.y);
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();ctx.ellipse(0,15,19,7,0,0,Math.PI*2);ctx.fill();
    var colours = {grove:'#7df7a1',rootsong:'#ff9d57',skyglass:'#9de8ff',moonwake:'#86e8ff'};
    ctx.strokeStyle = colours[performer.cosmetic] || '#f1f7f4';
    ctx.lineWidth = performer.dodge > 0 ? 5 : 3;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = performer.attackFlash > 0 ? 18 : 8;
    ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.stroke();
    ctx.shadowBlur = 0;
    if (this.hero.complete && this.hero.naturalWidth) {
      var col = Math.abs(Math.cos(performer.facing)) > Math.abs(Math.sin(performer.facing)) ?
        (Math.cos(performer.facing)<0?2:3) : (Math.sin(performer.facing)<0?1:0);
      var row = performer.attackFlash > 0 ? 2 : 1;
      var cellW = this.hero.naturalWidth/4;
      var cellH = this.hero.naturalHeight/4;
      ctx.drawImage(this.hero,col*cellW,row*cellH,cellW,cellH,-32,-48,64,64);
    }
    ctx.fillStyle = '#f1f7f4';
    ctx.font = '700 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(performer.name,0,-38);
    ctx.fillStyle = '#251b25';ctx.fillRect(-28,-30,56,5);
    ctx.fillStyle = performer.hp > 45 ? '#7df7a1' : '#ff7892';
    ctx.fillRect(-28,-30,56*clamp(performer.hp/performer.maxHp,0,1),5);
    ctx.restore();
  };

  EchoArena.prototype.draw = function () {
    var canvas = document.getElementById('echoArenaCanvas');
    if (!canvas || !this.active || !this.local) return;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,900,500);
    if (this.background.complete && this.background.naturalWidth) {
      ctx.drawImage(this.background,0,0,900,500);
    } else {
      ctx.fillStyle = '#071b18';ctx.fillRect(0,0,900,500);
    }
    ctx.fillStyle = 'rgba(3,8,14,.28)';ctx.fillRect(0,0,900,500);
    if (selectedArenaMode === 'king') {
      ctx.strokeStyle = '#ffc857';ctx.lineWidth=4;ctx.setLineDash([10,8]);
      ctx.beginPath();ctx.arc(450,250,78,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    } else if (selectedArenaMode === 'capture') {
      ctx.fillStyle='#ffc857';ctx.shadowColor='#ffc857';ctx.shadowBlur=22;
      ctx.beginPath();ctx.arc(this.beat.x,this.beat.y,12,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    } else if (selectedArenaMode === 'survival') {
      var radius=210+Math.sin(this.time*.11)*90;
      ctx.strokeStyle='#d77cff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(450,250,radius,0,Math.PI*2);ctx.stroke();
    }
    this.drawPerformer(ctx,this.local,0);
    if (this.bot) this.drawPerformer(ctx,this.bot,1);
    var self=this;
    this.remote.forEach(function (performer,index) { self.drawPerformer(ctx,performer,index+1); });
    ctx.fillStyle='rgba(3,8,14,.82)';ctx.fillRect(330,12,240,42);
    ctx.fillStyle='#f1f7f4';ctx.font='800 20px monospace';ctx.textAlign='center';
    ctx.fillText(String(Math.ceil(this.time)).padStart(2,'0') + ' · ' + Math.floor(this.local.score) + ' PTS',450,39);
  };

  EchoArena.prototype.frame = function (time) {
    var dt = clamp((time-this.lastTime)/1000,0,0.034);
    this.lastTime = time;
    this.update(dt);
    this.draw();
    this.animationFrame = window.requestAnimationFrame(this.frame.bind(this));
  };

  var arena = new EchoArena();

  function renderArena() {
    var mode = ARENA_MODES[selectedArenaMode];
    var current = snapshot();
    var profile = current.state.onlineProfile || {};
    content.innerHTML =
      '<div class="production-section-heading"><div><p class="panel-kicker">COMPETITIVE RULESET · SEPARATE PROGRESSION</p>' +
      '<h3>Echo Arena</h3><p>Movement, strike, and dodge fundamentals carry over. PvE equipment stats do not.</p></div>' +
      '<div class="arena-rating"><strong>' + formatNumber(profile.rating || 1000) + '</strong><span>Echo rating · ' +
      formatNumber(profile.seasonalTokens) + ' tokens</span></div></div>' +
      '<div class="arena-mode-grid">' + Object.keys(ARENA_MODES).map(function (id) {
        var item = ARENA_MODES[id];
        return '<button type="button" data-arena-mode="' + id + '" class="' + (id===selectedArenaMode?'active':'') + '">' +
          '<strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.players) + '</span></button>';
      }).join('') + '</div>' +
      '<section class="arena-stage"><div class="arena-stage-copy"><div><h4>' + escapeHtml(mode.name) + '</h4><p>' +
      escapeHtml(mode.description) + '</p></div><div><button id="arenaTraining" class="game-button button-secondary" type="button">Training rival</button>' +
      '<button id="arenaMatch" class="game-button button-primary" type="button"' +
      (!network.room || network.peers.size<2 ? ' disabled' : '') + '>Start lobby match</button></div></div>' +
      '<canvas id="echoArenaCanvas" width="900" height="500" aria-label="Echo Arena match"></canvas>' +
      '<div class="arena-controls"><div class="arena-move-pad" aria-label="Arena movement">' +
      '<button type="button" data-arena-key="ArrowUp">▲</button><button type="button" data-arena-key="ArrowLeft">◀</button>' +
      '<button type="button" data-arena-key="ArrowDown">▼</button><button type="button" data-arena-key="ArrowRight">▶</button></div>' +
      '<div><button type="button" data-arena-action="dodge">DODGE</button><button type="button" data-arena-action="attack">STRIKE</button></div></div>' +
      '<p class="arena-legal">' + (network.room ?
        'Lobby connected. The configured relay transports snapshots at 10 Hz; a production authoritative service should validate rated hits.' :
        'Training works offline. Join an Echo Network room to enable multiplayer arena snapshots.') + '</p></section>';
    Array.prototype.forEach.call(content.querySelectorAll('[data-arena-mode]'),function (button) {
      button.addEventListener('click',function () {
        arena.stop();
        selectedArenaMode = button.dataset.arenaMode;
        if (network.room && network.host === network.id) network.advertise();
        renderArena();
      });
    });
    document.getElementById('arenaTraining').addEventListener('click',function () { arena.start(true); });
    var match = document.getElementById('arenaMatch');
    if (match) match.addEventListener('click',function () { arena.start(false); });
    Array.prototype.forEach.call(content.querySelectorAll('[data-arena-action]'),function (button) {
      button.addEventListener('pointerdown',function (event) {
        event.preventDefault();
        arena.action(button.dataset.arenaAction);
      });
    });
    Array.prototype.forEach.call(content.querySelectorAll('[data-arena-key]'),function (button) {
      function down(event) { event.preventDefault(); arena.keys.add(button.dataset.arenaKey); }
      function up(event) { event.preventDefault(); arena.keys.delete(button.dataset.arenaKey); }
      button.addEventListener('pointerdown',down);
      button.addEventListener('pointerup',up);
      button.addEventListener('pointercancel',up);
      button.addEventListener('pointerleave',up);
    });
  }

  function renderActiveTab() {
    renderProfileAndSidebar();
    if (activeTab === 'guild') renderGuild();
    else if (activeTab === 'crafting') renderCrafting();
    else if (activeTab === 'mastery') renderMastery();
    else if (activeTab === 'social') renderSocial();
    else if (activeTab === 'online') renderOnline();
    else renderArena();
  }

  function openHub() {
    if (hubOpen) return;
    hubOpen = true;
    gameApi().production.setHubOpen(true);
    if (pauseScreen) {
      pauseScreen.hidden = true;
      pauseScreen.inert = true;
    }
    hub.hidden = false;
    hub.inert = false;
    document.body.classList.add('production-hub-open');
    renderActiveTab();
    window.setTimeout(function () {
      var firstTab = tabs.querySelector('.active');
      if (firstTab) firstTab.focus();
    },0);
  }

  function closeHub() {
    if (!hubOpen) return;
    hubOpen = false;
    arena.stop();
    hub.hidden = true;
    hub.inert = true;
    document.body.classList.remove('production-hub-open');
    gameApi().production.setHubOpen(false);
    if (pauseScreen) {
      pauseScreen.hidden = false;
      pauseScreen.inert = false;
    }
    launchButton.focus();
  }

  launchButton.addEventListener('click',openHub);
  closeButton.addEventListener('click',closeHub);
  tabs.addEventListener('click',function (event) {
    var button = event.target.closest('[data-production-tab]');
    if (button) setActiveTab(button.dataset.productionTab);
  });
  window.addEventListener('keydown',function (event) {
    if (hubOpen && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeHub();
      return;
    }
    if (!hubOpen || activeTab !== 'arena') return;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(event.code) >= 0) event.preventDefault();
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].indexOf(event.code) >= 0) {
      arena.keys.add(event.code);
    } else if (event.code === 'Space' || event.code === 'KeyJ') {
      arena.action('attack');
    } else if (event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.code === 'KeyK') {
      arena.action('dodge');
    }
  },true);
  window.addEventListener('keyup',function (event) {
    arena.keys.delete(event.code);
  },true);
  window.addEventListener('beforeunload',function () { network.leave(); });
  window.addEventListener('resize',function () {
    if (hubOpen && navigator.maxTouchPoints > 0 && window.innerHeight > window.innerWidth) closeHub();
  });

  hub.inert = true;
  window.HighNotesV1 = {
    version:'1.0',
    protocolVersion:PROTOCOL_VERSION,
    contractCount:CONTRACTS.length,
    questDefinitionCount:CONTRACTS.length + 18,
    contracts:CONTRACTS.map(function (contract) {
      return {id:contract.id,region:contract.region,name:contract.name,objective:contract.objective,goal:contract.goal};
    }),
    arenaModes:Object.keys(ARENA_MODES),
    network:network
  };
}());
