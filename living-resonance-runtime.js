(function (root, factory) {
  'use strict';
  var rhythm = root && root.MossResonanceGate;
  if (!rhythm && typeof require === 'function') {
    try { rhythm = require('./resonance-gate-runtime.js'); } catch (_error) { rhythm = null; }
  }
  var runtime = factory(rhythm);
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root) root.MossLivingResonance = runtime;
})(typeof window !== 'undefined' ? window : globalThis, function (RHYTHM) {
  'use strict';

  if (!RHYTHM) throw new Error('Living Resonance requires the Resonance Gate timing runtime.');

  var CLASS_IDS = Object.freeze(['riffblade','groveguard','echo-weaver','tempo-runner']);
  var INSTRUMENT_IDS = Object.freeze(['guitar','bass','synth','drums','microphone','violin']);
  var REGION_IDS = Object.freeze(['mossvale','rootsong','skyglass','moonwake']);
  var BOSS_IDS = Object.freeze(['nullspeaker','rootbound','prism-choir','tidebreaker']);
  var CHALLENGE_IDS = Object.freeze(['standard','no-healing','perfect-guard','time-trial','instrument-locked']);
  var RESONANCE_IDS = Object.freeze(['','nature','psychedelic','heavy','conductor']);
  var CONSUMABLE_IDS = Object.freeze(['field-tonic','tempo-tea','spore-tonic','thorn-ward','melody-map','grove-blessing','echo-amplifier','weed-whisperer','revival-seed']);
  var EQUIPMENT_IDS = Object.freeze(['grooveguard-vest','ironbark-plate','trailstep-boots','moss-boots','tempo-ring','crystal-lens','collector-compass','resonance-pin','fortune-charm','heartbloom-pouch']);
  var COSMETIC_VARIANTS = Object.freeze(['standard']);

  function freezeNodes(pathId, nodes) {
    return Object.freeze(nodes.map(function (node, index) {
      return Object.freeze(Object.assign({id:pathId + '-' + (index + 1),pathId:pathId,tier:index + 1,cost:1,capstone:index === nodes.length - 1},node));
    }));
  }

  var MASTERY = Object.freeze({
    'riffblade':Object.freeze({classId:'riffblade',paths:Object.freeze({
      'lead-line':Object.freeze({id:'lead-line',name:'Lead Line',color:'#56f0c4',emblem:'assets/ui/living-resonance/mastery-lead-line.webp',summary:'Reliable rhythm chains and a bounded follow-up phrase.',nodes:freezeNodes('riffblade-lead-line',[
        {name:'Pickup Measure',effect:'combo-grace',description:'Rhythm-chain grace lasts 18% longer after an accurate alternating attack.'},
        {name:'Carried Phrase',effect:'cleave-extend',description:'A three-hit alternating phrase extends Resonant Cleave by a compact follow-up.'},
        {name:'Second Voice',effect:'lead-capstone',description:'Capstone: a perfect phrase creates one controlled echo slash. It cannot repeat itself.'}
      ])}),
      'power-chord':Object.freeze({id:'power-chord',name:'Power Chord',color:'#ffc857',emblem:'assets/ui/living-resonance/mastery-power-chord.webp',summary:'Charge retention and measured close-range stagger.',nodes:freezeNodes('riffblade-power-chord',[
        {name:'Held Note',effect:'charge-retain',description:'Retain 35% of a charged attack wind-up while moving or beginning a dodge.'},
        {name:'Open Voicing',effect:'cleave-width',description:'Resonant Cleave gains a modestly wider arc without extra raw damage.'},
        {name:'Final Cadence',effect:'power-capstone',description:'Capstone: a fully charged Cleave adds one capped stagger beat; bosses receive a reduced effect.'}
      ])})
    })}),
    'groveguard':Object.freeze({classId:'groveguard',paths:Object.freeze({
      'deep-roots':Object.freeze({id:'deep-roots',name:'Deep Roots',color:'#8fcf65',emblem:'assets/ui/living-resonance/mastery-deep-roots.webp',summary:'Guard stability and a carefully bounded shared barrier.',nodes:freezeNodes('groveguard-deep-roots',[
        {name:'Rooted Stance',effect:'guard-stability',description:'Guard stamina drains 10% more slowly while standing your ground.'},
        {name:'Sheltering Chorus',effect:'barrier-duration',description:'Successful blocks modestly extend Root Resonance, up to a strict duration cap.'},
        {name:'Heartwood Circle',effect:'roots-capstone',description:'Capstone: Root Resonance shows a brief protective ring around Odin and nearby guests without granting invulnerability.'}
      ])}),
      'counterpoint':Object.freeze({id:'counterpoint',name:'Counterpoint',color:'#ffb857',emblem:'assets/ui/living-resonance/mastery-counterpoint.webp',summary:'Perfect-guard timing, stamina return, and one restrained counter pulse.',nodes:freezeNodes('groveguard-counterpoint',[
        {name:'Answering Beat',effect:'perfect-stamina',description:'A perfect guard restores 12 guard stamina.'},
        {name:'Measured Reply',effect:'counter-window',description:'The counterattack window lasts slightly longer after a perfect guard.'},
        {name:'Golden Rebuttal',effect:'counter-capstone',description:'Capstone: a perfect guard creates one small counter pulse. Boss damage is tightly capped.'}
      ])})
    })}),
    'echo-weaver':Object.freeze({classId:'echo-weaver',paths:Object.freeze({
      'harmonic-field':Object.freeze({id:'harmonic-field',name:'Harmonic Field',color:'#62dff5',emblem:'assets/ui/living-resonance/mastery-harmonic-field.webp',summary:'Larger, longer fields with a strict two-field ceiling.',nodes:freezeNodes('echo-weaver-harmonic-field',[
        {name:'Wide Spectrum',effect:'field-radius',description:'Echo Marker radius increases by 12%.'},
        {name:'Sustained Tone',effect:'field-duration',description:'Fields persist for one additional bounded pulse.'},
        {name:'Twin Resonance',effect:'field-capstone',description:'Capstone: maintain at most two fields; placing a third removes the oldest safely.'}
      ])}),
      'returning-echo':Object.freeze({id:'returning-echo',name:'Returning Echo',color:'#b879ff',emblem:'assets/ui/living-resonance/mastery-returning-echo.webp',summary:'One readable returning note that rewards positioning.',nodes:freezeNodes('echo-weaver-returning-echo',[
        {name:'Recall Point',effect:'echo-return',description:'The class field sends one harmless return cue toward its origin.'},
        {name:'Pulse Alignment',effect:'return-pulse',description:'Using Echo Pulse during the cue turns it into one eligible returning projectile.'},
        {name:'There and Back',effect:'echo-capstone',description:'Capstone: the return may strike once on each leg, then it is destroyed. Loops are impossible.'}
      ])})
    })}),
    'tempo-runner':Object.freeze({classId:'tempo-runner',paths:Object.freeze({
      'breakbeat':Object.freeze({id:'breakbeat',name:'Breakbeat',color:'#ff8fad',emblem:'assets/ui/living-resonance/mastery-breakbeat.webp',summary:'Timing-led dodge recovery rather than passive speed.',nodes:freezeNodes('tempo-runner-breakbeat',[
        {name:'Downbeat Landing',effect:'dodge-recovery',description:'A dodge begun near the beat recovers 10% faster.'},
        {name:'Step Sequence',effect:'tempo-chain',description:'Two well-timed dodges prime a brief utility cadence without adding invulnerability.'},
        {name:'Breakbeat Finish',effect:'breakbeat-capstone',description:'Capstone: the next accurate attack consumes the cadence for a compact afterbeat.'}
      ])}),
      'afterimage':Object.freeze({id:'afterimage',name:'Afterimage',color:'#66b8ff',emblem:'assets/ui/living-resonance/mastery-afterimage.webp',summary:'One controlled follow-up image and collision-safe repositioning.',nodes:freezeNodes('tempo-runner-afterimage',[
        {name:'Light Trail',effect:'dash-trail',description:'Tempo Break leaves a clearer, short-lived visual trail.'},
        {name:'Measured Step',effect:'dash-reposition',description:'A valid Tempo Break ending gains a small collision-tested repositioning benefit.'},
        {name:'One More Step',effect:'afterimage-capstone',description:'Capstone: Tempo Break creates one follow-up image strike. It cannot trigger another image.'}
      ])})
    })})
  });

  function synergy(id, classId, instrumentId, name, summary, effect, color, cue) {
    return Object.freeze({id:id,classId:classId,instrumentId:instrumentId,name:name,summary:summary,effect:effect,color:color,audioCue:cue || 'synergy'});
  }

  var synergyList = [
    synergy('riffblade-guitar','riffblade','guitar','Lead Guitar','Accurate rhythm chains extend one Cleave phrase.','phrase-extension','#56f0c4','synergy-bright'),
    synergy('riffblade-bass','riffblade','bass','Held Foundation','Charged attacks retain a little more charge through movement.','charge-retention','#ffc857','synergy-low'),
    synergy('riffblade-synth','riffblade','synth','Pocket Oscillator','Resonant Cleave releases one bounded short-range note.','short-note','#62dff5','synergy-glass'),
    synergy('riffblade-drums','riffblade','drums','Backbeat Edge','Cleave lands with a compact non-looping stagger beat.','stagger-beat','#ff9d57','synergy-beat'),
    synergy('riffblade-microphone','riffblade','microphone','Chorus Blade','A strong rhythm completion grants one small self-support pulse.','support-pulse','#ff8fad','synergy-voice'),
    synergy('riffblade-violin','riffblade','violin','Fine Bow Edge','Accurate attacks narrow Cleave for precision and clearer spacing.','precision-cleave','#b879ff','synergy-string'),
    synergy('groveguard-guitar','groveguard','guitar','Guard Riff','A perfect guard creates one short counter riff.','counter-riff','#8fcf65','synergy-bright'),
    synergy('groveguard-bass','groveguard','bass','Root Note','Blocking a heavy hit produces a defensive ground pulse.','ground-pulse','#d8c35e','synergy-low'),
    synergy('groveguard-synth','groveguard','synth','Prism Bark','Root Resonance can refract one eligible projectile.','refract-projectile','#62dff5','synergy-glass'),
    synergy('groveguard-drums','groveguard','drums','Guard Groove','Guarding on beat briefly improves stamina recovery.','guard-rhythm','#ff9d57','synergy-beat'),
    synergy('groveguard-microphone','groveguard','microphone','Shelter Chorus','Root Resonance provides a small capped recovery pulse.','barrier-recovery','#ff8fad','synergy-voice'),
    synergy('groveguard-violin','groveguard','violin','Parry String','A perfect guard draws a precise counter line.','counter-line','#b879ff','synergy-string'),
    synergy('echo-weaver-guitar','echo-weaver','guitar','Marked Riff','An attack may mark one nearby target for the next field pulse.','field-mark','#56f0c4','synergy-bright'),
    synergy('echo-weaver-bass','echo-weaver','bass','Subharmonic Field','Fields pulse slower with a stronger capped stagger.','slow-stagger','#d8c35e','synergy-low'),
    synergy('echo-weaver-synth','echo-weaver','synth','Mirror Patch','One eligible projectile may echo once.','projectile-echo','#62dff5','synergy-glass'),
    synergy('echo-weaver-drums','echo-weaver','drums','Clocked Field','Field pulses lock to a readable rhythm.','rhythm-field','#ff9d57','synergy-beat'),
    synergy('echo-weaver-microphone','echo-weaver','microphone','Support Loop','Fields add modest ally utility instead of raw damage.','field-support','#ff8fad','synergy-voice'),
    synergy('echo-weaver-violin','echo-weaver','violin','Guided Return','Returning echoes follow a narrow, precise path.','guided-return','#b879ff','synergy-string'),
    synergy('tempo-runner-guitar','tempo-runner','guitar','Dash Riff','Tempo Break may end with one quick riff strike.','dash-strike','#56f0c4','synergy-bright'),
    synergy('tempo-runner-bass','tempo-runner','bass','Heavy Stop','The dash ends in a short heavy stop, never extra distance.','heavy-stop','#d8c35e','synergy-low'),
    synergy('tempo-runner-synth','tempo-runner','synth','Prism Slip','The dash leaves one short-lived prism echo.','prism-echo','#62dff5','synergy-glass'),
    synergy('tempo-runner-drums','tempo-runner','drums','Afterbeat','Dodging on beat produces one compact afterbeat.','afterbeat','#ff9d57','synergy-beat'),
    synergy('tempo-runner-microphone','tempo-runner','microphone','Moving Chorus','A successful movement chain grants a short utility buff.','movement-utility','#ff8fad','synergy-voice'),
    synergy('tempo-runner-violin','tempo-runner','violin','Needle Step','Afterimage attacks become narrower and more precise.','precision-image','#b879ff','synergy-string')
  ];
  var SYNERGIES = Object.freeze(synergyList.reduce(function (map, entry) { map[entry.id] = entry; return map; },{}));

  var REGIONS = Object.freeze({
    mossvale:Object.freeze({id:'mossvale',stage:1,name:'Mossvale Grove',tiers:Object.freeze(['Disturbed','Returning Rhythm','Shared Harmony','Fully Resonant']),color:'#7df7a1',layers:Object.freeze(['leaf-percussion','warm-pad','grove-melody']),props:Object.freeze(['fireflies','heart-flowers','repaired-stage'])}),
    rootsong:Object.freeze({id:'rootsong',stage:2,name:'Rootsong Hollows',tiers:Object.freeze(['Disturbed','Returning Rhythm','Shared Harmony','Fully Resonant']),color:'#d8c35e',layers:Object.freeze(['root-bass','low-percussion','root-response']),props:Object.freeze(['glowing-roots','wildlife','active-resonators'])}),
    skyglass:Object.freeze({id:'skyglass',stage:3,name:'Skyglass Reach',tiers:Object.freeze(['Disturbed','Returning Rhythm','Shared Harmony','Fully Resonant']),color:'#9de8ff',layers:Object.freeze(['glass-harmony','bell-pattern','sky-melody']),props:Object.freeze(['clear-prisms','bridge-lights','restored-chimes'])}),
    moonwake:Object.freeze({id:'moonwake',stage:4,name:'Moonwake Coast',tiers:Object.freeze(['Disturbed','Returning Rhythm','Shared Harmony','Fully Resonant']),color:'#86eff1',layers:Object.freeze(['wave-rhythm','seventh-pad','memory-voice']),props:Object.freeze(['calm-tide','lanterns','peaceful-echoes'])})
  });

  var CHALLENGES = Object.freeze({
    standard:Object.freeze({id:'standard',name:'Standard Rehearsal',description:'Replay the original arrangement with campaign balance intact.'}),
    'no-healing':Object.freeze({id:'no-healing',name:'No Healing',description:'Healing and consumable recovery are disabled for this rehearsal.'}),
    'perfect-guard':Object.freeze({id:'perfect-guard',name:'Perfect Guard Study',description:'Visible guard timing; earn the arrangement rank through precise guards.'}),
    'time-trial':Object.freeze({id:'time-trial',name:'Time Trial',description:'A clear rehearsal timer highlights efficient play.'}),
    'instrument-locked':Object.freeze({id:'instrument-locked',name:'Instrument-Locked Arrangement',description:'The selected instrument is fixed until the rehearsal ends.'})
  });

  var XP_THRESHOLDS = Object.freeze([0,60,150,280,450,680]);

  function clamp(value, min, max) { return Math.max(min,Math.min(max,value)); }
  function known(value, values, fallback) { return values.indexOf(value) >= 0 ? value : fallback; }
  function uniqueKnown(values, valid, limit) {
    var seen = Object.create(null), result = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      if (result.length >= limit || valid.indexOf(value) < 0 || seen[value]) return;
      seen[value] = true; result.push(value);
    });
    return result;
  }
  function cleanName(value, fallback) {
    var text = typeof value === 'string' ? value.replace(/[^a-zA-Z0-9 '\-_]/g,'').trim().slice(0,18) : '';
    return text || fallback;
  }
  function allNodes(classId) {
    var def = MASTERY[classId], result = [];
    if (!def) return result;
    Object.keys(def.paths).forEach(function (pathId) { result = result.concat(def.paths[pathId].nodes); });
    return result;
  }
  function nodeById(classId, nodeId) { return allNodes(classId).filter(function (node) { return node.id === nodeId; })[0] || null; }
  function pathForNode(classId, nodeId) {
    var def = MASTERY[classId]; if (!def) return '';
    return Object.keys(def.paths).filter(function (id) { return def.paths[id].nodes.some(function (node) { return node.id === nodeId; }); })[0] || '';
  }
  function levelForXp(xp) {
    var value = clamp(Math.floor(Number(xp) || 0),0,999999), level = 1;
    XP_THRESHOLDS.forEach(function (threshold,index) { if (value >= threshold) level = index + 1; });
    return clamp(level,1,XP_THRESHOLDS.length);
  }
  function masteryPoints(record) { return Math.max(0,levelForXp(record && record.xp) - 1 - ((record && record.unlockedNodes) || []).length); }
  function synergyFor(classId, instrumentId) { return SYNERGIES[known(classId,CLASS_IDS,'riffblade') + '-' + known(instrumentId,INSTRUMENT_IDS,'guitar')]; }
  function restorationTier(points) { var p=clamp(Math.floor(Number(points)||0),0,8); return p >= 6 ? 3 : p >= 4 ? 2 : p >= 2 ? 1 : 0; }

  function freshMasteryRecord() { return {xp:0,level:1,selectedPath:'',unlockedNodes:[],respecs:0}; }
  function freshLoadout(index) { return {id:'loadout-' + (index + 1),name:'Set ' + (index + 1),instrument:'',equipment:{armour:'',footwear:'',ring:'',lens:'',compass:'',charm:'',pouch:''},resonance:'',quickConsumables:[],cosmeticVariant:'standard',saved:false}; }
  function freshState() {
    var mastery = {}, restoration = {};
    CLASS_IDS.forEach(function (id) { mastery[id] = freshMasteryRecord(); });
    REGION_IDS.forEach(function (id) { restoration[id] = {points:0,tier:0,claimedTiers:[]}; });
    return {
      classMastery:mastery,
      restoration:restoration,
      rehearsal:{records:{},claimedRewards:[]},
      rhythmTrials:RHYTHM.freshProgress(),
      loadouts:[freshLoadout(0),freshLoadout(1),freshLoadout(2)],
      quickWheel:['consumable:field-tonic','consumable:tempo-tea','loadout:loadout-1','screen:backpack','screen:map','screen:class','screen:instruments','utility:odin'],
      encoreAdventure:{unlocked:false,active:false,completed:false,cycle:0,stage:1,stageProgress:{mossvale:0,rootsong:0,skyglass:0,moonwake:0},claimedRewards:[],cosmetics:[],normalSnapshot:null,encoreSnapshot:null,runId:'',introSeen:false},
      rewardClaims:[]
    };
  }

  function sanitizeMastery(raw) {
    var clean = {};
    CLASS_IDS.forEach(function (classId) {
      var source = raw && raw[classId] && typeof raw[classId] === 'object' ? raw[classId] : {};
      var validNodes = allNodes(classId).map(function (node) { return node.id; });
      var selectedPath = MASTERY[classId].paths[source.selectedPath] ? source.selectedPath : '';
      var nodes = uniqueKnown(source.unlockedNodes,validNodes,3).filter(function (nodeId) {
        return !selectedPath || pathForNode(classId,nodeId) === selectedPath;
      });
      if (!selectedPath && nodes.length) selectedPath = pathForNode(classId,nodes[0]);
      nodes = nodes.filter(function (nodeId) { return pathForNode(classId,nodeId) === selectedPath; });
      var path = selectedPath && MASTERY[classId].paths[selectedPath];
      if (path) {
        var contiguous = [];
        path.nodes.forEach(function (node) { if (nodes.indexOf(node.id) >= 0 && contiguous.length === node.tier - 1) contiguous.push(node.id); });
        nodes = contiguous;
      }
      var xp = clamp(Math.floor(Number(source.xp)||0),0,999999);
      var level = levelForXp(xp);
      nodes = nodes.slice(0,Math.max(0,level - 1));
      clean[classId] = {xp:xp,level:level,selectedPath:selectedPath,unlockedNodes:nodes,respecs:clamp(Math.floor(Number(source.respecs)||0),0,999)};
    });
    return clean;
  }

  function validWheelAssignment(value) {
    if (typeof value !== 'string' || value.length > 40) return false;
    var parts = value.split(':');
    if (parts.length !== 2) return false;
    if (parts[0] === 'consumable') return CONSUMABLE_IDS.indexOf(parts[1]) >= 0;
    if (parts[0] === 'loadout') return /^loadout-[123]$/.test(parts[1]);
    if (parts[0] === 'screen') return ['backpack','map','class','instruments'].indexOf(parts[1]) >= 0;
    return parts[0] === 'utility' && ['odin','context'].indexOf(parts[1]) >= 0;
  }

  function sanitizeLoadout(raw,index) {
    var clean = freshLoadout(index), source = raw && typeof raw === 'object' ? raw : {};
    clean.name = cleanName(source.name,clean.name);
    clean.instrument = known(source.instrument,INSTRUMENT_IDS,'');
    clean.resonance = known(source.resonance,RESONANCE_IDS,'');
    clean.cosmeticVariant = known(source.cosmeticVariant,COSMETIC_VARIANTS,'standard');
    clean.saved = !!source.saved;
    clean.quickConsumables = uniqueKnown(source.quickConsumables,CONSUMABLE_IDS,4);
    var equipment = source.equipment && typeof source.equipment === 'object' ? source.equipment : {};
    Object.keys(clean.equipment).forEach(function (slot) { clean.equipment[slot] = known(equipment[slot],EQUIPMENT_IDS,''); });
    return clean;
  }

  function sanitizeRehearsal(raw) {
    var clean={records:{},claimedRewards:[]}, source=raw&&typeof raw==='object'?raw:{};
    var validClaimPattern=/^(nullspeaker|rootbound|prism-choir|tidebreaker):(standard|no-healing|perfect-guard|time-trial|instrument-locked):[1-5]$/;
    clean.claimedRewards=uniqueKnown(source.claimedRewards,(Array.isArray(source.claimedRewards)?source.claimedRewards:[]).filter(function(id){return validClaimPattern.test(id);}),80);
    if (source.records && typeof source.records==='object') Object.keys(source.records).slice(0,100).forEach(function(key){
      if(!validClaimPattern.test(key))return;var record=source.records[key]&&typeof source.records[key]==='object'?source.records[key]:{};
      clean.records[key]={bestTime:clamp(Number(record.bestTime)||0,0,99999),bestDamageTaken:clamp(Math.floor(Number(record.bestDamageTaken)||0),0,9999),bestPerfectGuards:clamp(Math.floor(Number(record.bestPerfectGuards)||0),0,9999),rank:known(record.rank,['','C','B','A','S'],''),completions:clamp(Math.floor(Number(record.completions)||0),0,9999)};
    });
    return clean;
  }

  function sanitizeEncore(raw) {
    var clean=freshState().encoreAdventure, source=raw&&typeof raw==='object'?raw:{};
    clean.unlocked=!!source.unlocked;clean.active=!!source.active;clean.completed=!!source.completed;
    clean.cycle=clamp(Math.floor(Number(source.cycle)||0),0,1);clean.stage=clamp(Math.floor(Number(source.stage)||1),1,4);
    REGION_IDS.forEach(function(id){clean.stageProgress[id]=clamp(Math.floor(Number(source.stageProgress&&source.stageProgress[id])||0),0,99);});
    clean.claimedRewards=(Array.isArray(source.claimedRewards)?source.claimedRewards:[]).filter(function(id){return typeof id==='string'&&/^encore-(mossvale|rootsong|skyglass|moonwake|complete)$/.test(id);}).filter(function(id,index,list){return list.indexOf(id)===index;}).slice(0,5);
    clean.cosmetics=(Array.isArray(source.cosmetics)?source.cosmetics:[]).filter(function(id){return ['encore-aura','encore-cape','encore-instrument'].indexOf(id)>=0;}).filter(function(id,index,list){return list.indexOf(id)===index;});
    clean.runId=typeof source.runId==='string'&&/^encore-[a-z0-9-]{1,32}$/.test(source.runId)?source.runId:'';
    clean.introSeen=!!source.introSeen;
    clean.normalSnapshot=source.normalSnapshot&&typeof source.normalSnapshot==='object'&&!Array.isArray(source.normalSnapshot)?source.normalSnapshot:null;
    clean.encoreSnapshot=source.encoreSnapshot&&typeof source.encoreSnapshot==='object'&&!Array.isArray(source.encoreSnapshot)?source.encoreSnapshot:null;
    return clean;
  }

  function sanitizeState(raw) {
    var clean=freshState(), source=raw&&typeof raw==='object'?raw:{};
    clean.classMastery=sanitizeMastery(source.classMastery);
    REGION_IDS.forEach(function(id){var record=source.restoration&&source.restoration[id]&&typeof source.restoration[id]==='object'?source.restoration[id]:{};var points=clamp(Math.floor(Number(record.points)||0),0,8);clean.restoration[id]={points:points,tier:restorationTier(points),claimedTiers:uniqueKnown(record.claimedTiers,[1,2,3],3)};});
    clean.rehearsal=sanitizeRehearsal(source.rehearsal);
    clean.rhythmTrials=RHYTHM.sanitizeProgress(source.rhythmTrials);
    clean.loadouts=[0,1,2].map(function(index){return sanitizeLoadout(source.loadouts&&source.loadouts[index],index);});
    var wheel=(Array.isArray(source.quickWheel)?source.quickWheel:[]).filter(validWheelAssignment).slice(0,8);clean.quickWheel=freshState().quickWheel.map(function(fallback,index){return wheel[index]||fallback;});
    clean.encoreAdventure=sanitizeEncore(source.encoreAdventure);
    clean.rewardClaims=(Array.isArray(source.rewardClaims)?source.rewardClaims:[]).filter(function(id){return typeof id==='string'&&/^(mastery|restoration|rehearsal|rhythm|encore):[a-z0-9:-]{1,64}$/.test(id);}).filter(function(id,index,list){return list.indexOf(id)===index;}).slice(0,200);
    return clean;
  }

  function rehearsalKey(bossId,challengeId,feedback) { return known(bossId,BOSS_IDS,'nullspeaker')+':'+known(challengeId,CHALLENGE_IDS,'standard')+':'+clamp(Math.floor(Number(feedback)||1),1,5); }

  return Object.freeze({
    schemaVersion:2,classIds:CLASS_IDS,instrumentIds:INSTRUMENT_IDS,regionIds:REGION_IDS,bossIds:BOSS_IDS,challengeIds:CHALLENGE_IDS,
    mastery:MASTERY,synergies:SYNERGIES,regions:REGIONS,challenges:CHALLENGES,xpThresholds:XP_THRESHOLDS,
    freshState:freshState,sanitizeState:sanitizeState,levelForXp:levelForXp,masteryPoints:masteryPoints,nodeById:nodeById,pathForNode:pathForNode,
    synergyFor:synergyFor,restorationTier:restorationTier,rehearsalKey:rehearsalKey,validWheelAssignment:validWheelAssignment,rhythm:RHYTHM
  });
});
