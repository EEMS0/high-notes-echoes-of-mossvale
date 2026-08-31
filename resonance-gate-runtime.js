(function (root, factory) {
  'use strict';
  var runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root) root.MossResonanceGate = runtime;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var DEFAULT_BPM = 104;
  var LANES = Object.freeze([
    Object.freeze({id:'C',index:0,label:'C',shape:'leaf',color:'#56f0c4',frequency:261.63}),
    Object.freeze({id:'E',index:1,label:'E',shape:'diamond',color:'#ffc857',frequency:329.63}),
    Object.freeze({id:'G',index:2,label:'G',shape:'wave',color:'#62dff5',frequency:392.00}),
    Object.freeze({id:'B',index:3,label:'B',shape:'star',color:'#d77cff',frequency:493.88})
  ]);
  var REGION_IDS = Object.freeze(['mossvale','rootsong','skyglass','moonwake']);
  var STAGE_BY_REGION = Object.freeze({mossvale:1,rootsong:2,skyglass:3,moonwake:4});
  var REGION_BY_STAGE = Object.freeze({1:'mossvale',2:'rootsong',3:'skyglass',4:'moonwake'});
  var BOSS_BY_REGION = Object.freeze({mossvale:'nullspeaker',rootsong:'rootbound',skyglass:'prism-choir',moonwake:'tidebreaker'});
  var JUDGEMENT_WINDOWS = Object.freeze({perfect:0.055,great:0.105,good:0.160});
  var CHORD_SPREAD_WINDOW = 0.120;
  var STRAY_PENALTY = 0.4;
  var STRAY_DEBOUNCE = 0.09;
  var ACCURACY_WEIGHTS = Object.freeze({perfect:1,great:0.8,good:0.5,miss:0});
  var BASE_SCORES = Object.freeze({perfect:1000,great:750,good:450,miss:0});
  var RANK_ORDER = Object.freeze(['','Practice','C','B','A','S']);
  var COMPLETION_THRESHOLDS = Object.freeze({story:50,standard:65,hard:72});

  function clamp(value, min, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = min;
    return Math.max(min,Math.min(max,number));
  }

  function round(value, places) {
    var scale = Math.pow(10,places || 0);
    return Math.round((Number(value) || 0) * scale) / scale;
  }

  function beatToSeconds(beat, bpm) {
    var tempo = clamp(bpm || DEFAULT_BPM,30,300);
    return Number(beat) * 60 / tempo;
  }

  function secondsToBeat(seconds, bpm) {
    var tempo = clamp(bpm || DEFAULT_BPM,30,300);
    return Number(seconds) * tempo / 60;
  }

  function authoredNote(beat, laneOrLanes, type, durationBeats, flags) {
    var lanes = Array.isArray(laneOrLanes) ? laneOrLanes.slice() : [laneOrLanes];
    var note = {
      beat:Number(beat),
      lanes:lanes,
      lane:lanes.length === 1 ? lanes[0] : undefined,
      type:type || (lanes.length > 1 ? 'chord' : 'tap')
    };
    if (note.type === 'hold') note.durationBeats = Number(durationBeats);
    if (flags && flags.optional) note.optional = true;
    if (flags && flags.tutorial) note.tutorial = flags.tutorial;
    if (flags && flags.accent) note.accent = true;
    return note;
  }

  function buildNotes(entries) {
    return entries.map(function (entry) {
      return authoredNote(entry[0],entry[1],entry[2],entry[3],entry[4]);
    });
  }

  /*
   * Campaign charts are deliberately authored as musical phrases. The data is
   * expanded only to normalize the note shape; no campaign-critical pattern is
   * random or generated at runtime.
   */
  var CHARTS = Object.freeze({
    mossvale:Object.freeze({
      id:'mossvale-resonance-gate',region:'mossvale',stage:1,bossId:'nullspeaker',
      name:'Nullspeaker Gate',subtitle:'Wake the firefly chorus',bpm:104,countInBeats:4,lengthBeats:68,
      palette:Object.freeze({primary:'#56f0c4',secondary:'#ffc857',background:'#071f1d'}),
      arrangement:'Warm guitar, leaf percussion, and answering fireflies',
      notes:Object.freeze(buildNotes([
        [4,0,'tap',0,{tutorial:'C'}],[7,1,'tap',0,{tutorial:'E'}],[10,2,'tap',0,{tutorial:'G'}],[13,3,'tap',0,{tutorial:'B'}],
        [16,0],[17,1],[18,2],[19,3],[20,1,'hold',2,{tutorial:'hold'}],[22,2],[23,3],[24,0],[25,1],[26,2],[27,3],
        [28,[0,2],'chord',0,{tutorial:'chord'}],[30,1],[31,3],
        [32,0,'hold',2],[34,1],[35,2],[36,3],[37,2],[38,1],[39,0],
        [40,0],[41,1],[42,2],[43,3],[44,[1,3],'chord'],[46,0],[47,2],
        [48,0],[49,1],[50,2],[51,3],[52,1,'tap',0,{optional:true,accent:true}],[53,2,'tap',0,{optional:true,accent:true}],
        [54,[0,2],'chord'],[56,3,'hold',2],[58,0],[59,1],[60,2],[61,3],[62,[0,2],'chord'],[64,[1,3],'chord']
      ]))
    }),
    rootsong:Object.freeze({
      id:'rootsong-resonance-gate',region:'rootsong',stage:2,bossId:'rootbound',
      name:'Rootbound Gate',subtitle:'Answer the buried downbeat',bpm:104,countInBeats:4,lengthBeats:68,
      palette:Object.freeze({primary:'#d8c35e',secondary:'#ff9d57',background:'#211b0c'}),
      arrangement:'Bass-led roots, deliberate chords, and grounded drums',
      notes:Object.freeze(buildNotes([
        [4,0],[5,0],[6,1],[7,2],[8,0,'hold',2],[10,3],[11,2],
        [12,0],[13.5,1],[15,2],[16,[0,2],'chord'],[18,3],[19,1],
        [20,0,'hold',3],[23,2],[24,[1,3],'chord'],[26,0],[27.5,2],
        [28,3],[29,2],[30,1],[31,0],[32,1,'hold',4],[36,[0,3],'chord'],
        [38,2],[39,1],[40,0],[41.5,2],[43,3],[44,[0,2],'chord'],
        [46,1],[47,3],[48,0,'hold',3],[51,2],[52,0],[53,1],[54,2],[55,3],
        [56,[0,3],'chord'],[58,1,'tap',0,{optional:true,accent:true}],[59,2],[60,[1,3],'chord'],
        [62,0],[63,2],[64,[0,2],'chord']
      ]))
    }),
    skyglass:Object.freeze({
      id:'skyglass-resonance-gate',region:'skyglass',stage:3,bossId:'prism-choir',
      name:'Prism Choir Gate',subtitle:'Align the mirrored voices',bpm:104,countInBeats:4,lengthBeats:68,
      palette:Object.freeze({primary:'#62dff5',secondary:'#d77cff',background:'#09182a'}),
      arrangement:'Crystalline arpeggios and measured call-and-response',
      notes:Object.freeze(buildNotes([
        [4,0],[5,1],[6,2],[7,3],[8,3],[9,2],[10,1],[11,0],
        [12,[0,3],'chord'],[14,1],[15,2],[16,0],[16.5,1],[17,2],[17.5,3],
        [19,3],[20,2],[21,1],[22,0],[23,[1,2],'chord'],[25,0,'hold',2],
        [28,0],[29,2],[30,1],[31,3],[32,3],[33,1],[34,2],[35,0],
        [36,[0,2],'chord'],[38,[1,3],'chord'],[40,0],[40.5,1],[41,2],[41.5,3],
        [43,3],[43.5,2],[44,1],[44.5,0],[46,2,'hold',2],[48,1],
        [49,3],[50,0],[51,2],[52,1,'tap',0,{optional:true,accent:true}],[53,3,'tap',0,{optional:true,accent:true}],
        [54,[0,3],'chord'],[56,0],[57,1],[58,2],[59,3],[60,3],[61,2],[62,1],[63,0],[64,[1,2],'chord']
      ]))
    }),
    moonwake:Object.freeze({
      id:'moonwake-resonance-gate',region:'moonwake',stage:4,bossId:'tidebreaker',
      name:'Tidebreaker Gate',subtitle:'Carry the moon-tide home',bpm:104,countInBeats:4,lengthBeats:68,
      palette:Object.freeze({primary:'#86eff1',secondary:'#b879ff',background:'#071625'}),
      arrangement:'Tidewood violin, wave rhythm, and a final C–E–G–B resolution',
      notes:Object.freeze(buildNotes([
        [4,0,'hold',2],[6,1],[7,2],[8,3,'hold',2],[10,2],[11,1],
        [12,0],[13,1],[14,2],[15,3],[16,[0,2],'chord'],[18,1],[19,3],
        [20,0],[20.5,1],[21,2],[21.5,3],[23,2],[24,1,'hold',3],[27,0],
        [28,[0,3],'chord'],[30,1],[31,2],[32,3],[33,2],[34,1],[35,0],
        [36,0,'hold',2],[38,[1,3],'chord'],[40,0],[41,1],[42,2],[43,3],
        [44,3],[45,2],[46,1],[47,0],[48,[0,2],'chord'],[50,[1,3],'chord'],
        [52,0,'tap',0,{optional:true,accent:true}],[52.5,1,'tap',0,{optional:true,accent:true}],[53,2],[54,3],
        [56,0,'hold',2],[58,1,'hold',2],[60,2,'hold',2],[62,3,'hold',2],
        [64,0],[64.5,1],[65,2],[65.5,3]
      ]))
    })
  });

  function normalizedLanes(note) {
    if (Array.isArray(note && note.lanes)) return note.lanes.slice();
    if (Number.isInteger(note && note.lane)) return [note.lane];
    return [];
  }

  function validateChart(chart, options) {
    var errors = [];
    var campaign = !options || options.campaign !== false;
    if (!chart || typeof chart !== 'object') return {valid:false,errors:['Chart must be an object.']};
    if (typeof chart.id !== 'string' || !/^[a-z0-9-]+$/.test(chart.id)) errors.push('Chart id is missing or unsafe.');
    if (REGION_IDS.indexOf(chart.region) < 0) errors.push('Unknown chart region.');
    if (!Number.isFinite(chart.bpm) || chart.bpm < 30 || chart.bpm > 300) errors.push('BPM must be between 30 and 300.');
    if (!Number.isFinite(chart.countInBeats) || chart.countInBeats < 1) errors.push('Count-in must contain at least one beat.');
    if (!Number.isFinite(chart.lengthBeats) || chart.lengthBeats <= chart.countInBeats) errors.push('Chart length is invalid.');
    var duration = beatToSeconds(chart.lengthBeats,chart.bpm);
    if (campaign && (duration < 30 || duration > 45)) errors.push('Campaign chart must last 30–45 seconds.');
    var notes = Array.isArray(chart.notes) ? chart.notes : [];
    if (!notes.length) errors.push('Chart has no notes.');
    var lastBeat = -Infinity;
    var holdsByLane = [[],[],[],[]];
    var density = [];
    notes.forEach(function (note,index) {
      var prefix = 'Note ' + index + ': ';
      var beat = Number(note && note.beat);
      var type = note && note.type || 'tap';
      var lanes = normalizedLanes(note);
      if (!Number.isFinite(beat) || beat < 0) errors.push(prefix + 'beat must be non-negative.');
      if (Number.isFinite(beat) && beat < lastBeat) errors.push(prefix + 'notes are not sorted.');
      if (Number.isFinite(beat)) lastBeat = Math.max(lastBeat,beat);
      if (Number.isFinite(beat) && beat < Number(chart.countInBeats)) errors.push(prefix + 'appears before the count-in completes.');
      if (Number.isFinite(beat) && beat >= Number(chart.lengthBeats)) errors.push(prefix + 'appears after chart end.');
      if (['tap','chord','hold'].indexOf(type) < 0) errors.push(prefix + 'unsupported note type.');
      if (!lanes.length || lanes.some(function (lane) { return !Number.isInteger(lane) || lane < 0 || lane >= LANES.length; })) errors.push(prefix + 'contains an unknown lane.');
      if (new Set(lanes).size !== lanes.length) errors.push(prefix + 'chord contains duplicate lanes.');
      if (lanes.length > 2) errors.push(prefix + 'campaign chords may use at most two lanes.');
      if (type === 'chord' && lanes.length < 2) errors.push(prefix + 'chord needs two lanes.');
      if (type !== 'chord' && lanes.length !== 1) errors.push(prefix + 'tap/hold needs one lane.');
      if (type === 'hold') {
        var durationBeats = Number(note.durationBeats);
        if (!Number.isFinite(durationBeats) || durationBeats <= 0) errors.push(prefix + 'hold duration must be positive.');
        if (Number.isFinite(beat) && Number.isFinite(durationBeats) && beat + durationBeats > Number(chart.lengthBeats)) errors.push(prefix + 'hold extends beyond chart end.');
        if (lanes.length === 1 && Number.isInteger(lanes[0]) && lanes[0] >= 0 && lanes[0] < LANES.length && Number.isFinite(beat) && Number.isFinite(durationBeats) && durationBeats > 0) {
          holdsByLane[lanes[0]].forEach(function (range) {
            if (beat < range.end && beat + durationBeats > range.start) errors.push(prefix + 'hold overlaps another hold on its lane.');
          });
          holdsByLane[lanes[0]].push({start:beat,end:beat + durationBeats});
        }
      }
      if (Number.isFinite(beat)) density.push(beat);
    });
    if (notes.length) {
      var finalNote = notes[notes.length - 1];
      var finalEnd = Number(finalNote && finalNote.beat) + (finalNote && finalNote.type === 'hold' ? Number(finalNote.durationBeats) || 0 : 0);
      if (Number.isFinite(finalEnd) && chart.lengthBeats - finalEnd < 2) errors.push('Chart needs an ending buffer of at least two beats.');
    }
    if (campaign) density.forEach(function (beat,index) {
      var count = 0;
      for (var cursor = index; cursor < density.length && density[cursor] < beat + 4; cursor++) count++;
      if (count > 12) errors.push('Campaign chart exceeds safe four-beat density near beat ' + beat + '.');
    });
    return {valid:errors.length === 0,errors:errors};
  }

  function cloneChart(chart, simplified) {
    var source = chart || CHARTS.mossvale;
    var keptChord = false;
    var notes = source.notes.filter(function (note,index) {
      if (!simplified) return true;
      if (note.optional) return false;
      if (note.tutorial) return true;
      if (note.type === 'hold') return true;
      if (note.type === 'chord') {
        if (!keptChord || note.beat >= source.lengthBeats - 8) { keptChord = true; return true; }
        return index % 2 === 0;
      }
      return Number.isInteger(note.beat) && (Math.floor(note.beat) % 2 === 0 || index % 3 === 0);
    }).map(function (note) {
      var copy = Object.assign({},note,{lanes:normalizedLanes(note)});
      copy.lane = copy.lanes.length === 1 ? copy.lanes[0] : undefined;
      return copy;
    });
    return Object.freeze(Object.assign({},source,{notes:Object.freeze(notes),simplified:!!simplified}));
  }

  function judgementForOffset(offsetSeconds, windows) {
    var absolute = Math.abs(Number(offsetSeconds) || 0);
    var active = windows || JUDGEMENT_WINDOWS;
    if (absolute <= active.perfect) return 'perfect';
    if (absolute <= active.great) return 'great';
    if (absolute <= active.good) return 'good';
    return 'miss';
  }

  function windowsForOptions(options) {
    var scale = options && options.widerTiming ? 1.45 : 1;
    if (options && Number.isFinite(options.windowScale)) scale = clamp(options.windowScale,0.75,2);
    return Object.freeze({
      perfect:JUDGEMENT_WINDOWS.perfect * scale,
      great:JUDGEMENT_WINDOWS.great * scale,
      good:JUDGEMENT_WINDOWS.good * scale,
      chord:CHORD_SPREAD_WINDOW * scale
    });
  }

  function multiplierForCombo(combo) {
    return Math.min(4,1 + Math.floor(Math.max(0,Number(combo) || 0) / 10) * 0.5);
  }

  function rankForAccuracy(accuracy, cleared, assistance) {
    if (!cleared) return '';
    if (assistance && assistance.strong) return 'Practice';
    var value = clamp(accuracy,0,100);
    if (value >= 95) return 'S';
    if (value >= 88) return 'A';
    if (value >= 78) return 'B';
    return 'C';
  }

  function rankValue(rank) {
    var index = RANK_ORDER.indexOf(rank);
    return index < 0 ? 0 : index;
  }

  function freshTrialRecord() {
    return {
      unlocked:false,cleared:false,assistedClear:false,attempts:0,
      bestScore:0,bestAccuracy:0,bestRank:'',maxCombo:0,rewardClaimed:false
    };
  }

  function freshProgress() {
    var result = {};
    REGION_IDS.forEach(function (region) { result[region] = freshTrialRecord(); });
    return result;
  }

  function sanitizeTrialRecord(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      unlocked:!!source.unlocked,
      cleared:!!source.cleared,
      assistedClear:!!source.assistedClear,
      attempts:Math.floor(clamp(source.attempts,0,99999)),
      bestScore:Math.floor(clamp(source.bestScore,0,999999999)),
      bestAccuracy:round(clamp(source.bestAccuracy,0,100),2),
      bestRank:RANK_ORDER.indexOf(source.bestRank) >= 0 ? source.bestRank : '',
      maxCombo:Math.floor(clamp(source.maxCombo,0,99999)),
      rewardClaimed:!!source.rewardClaimed
    };
  }

  function sanitizeProgress(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var result = {};
    REGION_IDS.forEach(function (region) { result[region] = sanitizeTrialRecord(source[region]); });
    return result;
  }

  function recordAttempt(progress, region) {
    var clean = sanitizeProgress(progress);
    var id = REGION_IDS.indexOf(region) >= 0 ? region : 'mossvale';
    clean[id].unlocked = true;
    clean[id].attempts = Math.min(99999,clean[id].attempts + 1);
    return clean;
  }

  function applyResult(progress, region, result) {
    var clean = sanitizeProgress(progress);
    var id = REGION_IDS.indexOf(region) >= 0 ? region : 'mossvale';
    var record = clean[id];
    var outcome = result && typeof result === 'object' ? result : {};
    var previousClear = record.cleared;
    record.unlocked = true;
    record.bestScore = Math.max(record.bestScore,Math.floor(clamp(outcome.score,0,999999999)));
    record.bestAccuracy = Math.max(record.bestAccuracy,round(clamp(outcome.accuracy,0,100),2));
    record.maxCombo = Math.max(record.maxCombo,Math.floor(clamp(outcome.maxCombo,0,99999)));
    if (rankValue(outcome.rank) > rankValue(record.bestRank)) record.bestRank = outcome.rank;
    if (outcome.progressionEligible && outcome.cleared) {
      record.cleared = true;
      if (!previousClear) record.assistedClear = !!outcome.assistanceUsed;
    }
    var firstClear = !previousClear && record.cleared;
    return {progress:clean,record:record,firstClear:firstClear,rewardAvailable:firstClear && !record.rewardClaimed};
  }

  function markRewardClaimed(progress, region) {
    var clean = sanitizeProgress(progress);
    var id = REGION_IDS.indexOf(region) >= 0 ? region : 'mossvale';
    if (clean[id].cleared) clean[id].rewardClaimed = true;
    return clean;
  }

  function createSession(chart, options) {
    var config = Object.assign({
      difficulty:'standard',mode:'scored',widerTiming:false,simplified:false,
      holdAssist:false,noFail:false,latencyOffsetMs:0
    },options || {});
    var source = cloneChart(chart || CHARTS.mossvale,!!config.simplified);
    var validation = validateChart(source,{campaign:true});
    if (!validation.valid) throw new Error('Invalid Resonance Gate chart: ' + validation.errors.join(' '));
    var windows = windowsForOptions(config);
    var requiredTotal = source.notes.filter(function (note) { return !note.optional; }).length;
    var states = source.notes.map(function (note,index) {
      var lanes = normalizedLanes(note);
      return {
        id:source.id + '-note-' + index,index:index,note:note,lanes:lanes,
        time:beatToSeconds(note.beat,source.bpm),
        endTime:beatToSeconds(note.beat + (note.type === 'hold' ? note.durationBeats : 0),source.bpm),
        status:'pending',laneHits:Object.create(null),startJudgement:'',startOffset:0,
        judgement:'',score:0,holdTicks:0
      };
    });
    var score = 0;
    var combo = 0;
    var maxCombo = 0;
    var counts = {perfect:0,great:0,good:0,miss:0};
    var weighted = 0;
    var requiredResolved = 0;
    var strayPenalty = 0;
    var strayCount = 0;
    var lastStrayAt = -Infinity;
    var completed = false;
    var lastEvent = null;

    function adjustedTime(songTime) {
      return Number(songTime) - clamp(config.latencyOffsetMs,-300,300) / 1000;
    }

    function effectiveWeighted() {
      return Math.max(0,weighted - strayPenalty);
    }

    function resonance() {
      return requiredTotal ? clamp(effectiveWeighted() / requiredTotal * 100,0,100) : 0;
    }

    function currentAccuracy() {
      return requiredResolved ? clamp(effectiveWeighted() / requiredResolved * 100,0,100) : strayPenalty ? 0 : 100;
    }

    function noteScore(judgement, state) {
      var multiplier = multiplierForCombo(combo);
      var base = BASE_SCORES[judgement] || 0;
      var accent = state.note.accent && judgement === 'perfect' ? 200 : 0;
      var hold = state.note.type === 'hold' ? Math.min(600,Math.floor(state.note.durationBeats * 4) * 75) : 0;
      return Math.round((base + accent) * multiplier + hold);
    }

    function finalize(state, judgement, eventType, offset) {
      if (state.status === 'hit' || state.status === 'missed' || state.status === 'skipped') return null;
      var optional = !!state.note.optional;
      state.judgement = judgement;
      state.startOffset = Number(offset) || state.startOffset || 0;
      if (judgement === 'miss') {
        state.status = optional ? 'skipped' : 'missed';
        if (!optional) {
          counts.miss++;
          requiredResolved++;
          combo = 0;
        }
      } else {
        state.status = 'hit';
        counts[judgement]++;
        if (!optional) {
          requiredResolved++;
          weighted += ACCURACY_WEIGHTS[judgement] || 0;
        }
        combo++;
        maxCombo = Math.max(maxCombo,combo);
        state.holdTicks = state.note.type === 'hold' ? Math.floor(state.note.durationBeats * 4) : 0;
        state.score = noteScore(judgement,state);
        score += state.score;
      }
      lastEvent = {
        type:eventType || (judgement === 'miss' ? 'miss' : 'hit'),noteId:state.id,noteIndex:state.index,
        lanes:state.lanes.slice(),judgement:judgement,offsetSeconds:Number(offset) || 0,
        score:state.score,combo:combo,multiplier:multiplierForCombo(combo),optional:optional
      };
      return Object.assign({},lastEvent);
    }

    function candidateForLane(lane, time) {
      var best = null;
      states.forEach(function (state) {
        if (state.status !== 'pending' || state.lanes.indexOf(lane) < 0 || state.laneHits[lane] !== undefined) return;
        var delta = time - state.time;
        if (Math.abs(delta) > windows.good) return;
        if (!best || Math.abs(delta) < Math.abs(best.delta) || (Math.abs(delta) === Math.abs(best.delta) && state.time < best.state.time)) {
          best = {state:state,delta:delta};
        }
      });
      return best;
    }

    function pressLane(lane, songTime) {
      var laneIndex = Number(lane);
      var time = adjustedTime(songTime);
      if (!Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex >= LANES.length || completed) return null;
      var candidate = candidateForLane(laneIndex,time);
      if (!candidate) {
        var penalized = time - lastStrayAt >= STRAY_DEBOUNCE;
        if (penalized) {
          lastStrayAt = time;
          strayPenalty += STRAY_PENALTY;
          strayCount++;
          counts.miss++;
          combo = 0;
        }
        lastEvent = {type:'stray',lanes:[laneIndex],judgement:penalized?'miss':'',offsetSeconds:0,score:0,combo:combo,multiplier:multiplierForCombo(combo),optional:false,penalized:penalized};
        return Object.assign({},lastEvent);
      }
      var state = candidate.state;
      state.laneHits[laneIndex] = time;
      if (state.lanes.some(function (requiredLane) { return state.laneHits[requiredLane] === undefined; })) {
        lastEvent = {type:'chord-part',noteId:state.id,noteIndex:state.index,lanes:[laneIndex],judgement:'',offsetSeconds:candidate.delta,score:0,combo:combo,multiplier:multiplierForCombo(combo),optional:!!state.note.optional};
        return Object.assign({},lastEvent);
      }
      var worstOffset = 0;
      state.lanes.forEach(function (requiredLane) {
        var delta = state.laneHits[requiredLane] - state.time;
        if (Math.abs(delta) > Math.abs(worstOffset)) worstOffset = delta;
      });
      if (state.lanes.length > 1) {
        var hitTimes = state.lanes.map(function (requiredLane) { return state.laneHits[requiredLane]; });
        var spread = Math.max.apply(Math,hitTimes) - Math.min.apply(Math,hitTimes);
        if (spread > windows.chord) return finalize(state,'miss','chord-break',worstOffset);
      }
      var judgement = judgementForOffset(worstOffset,windows);
      if (state.note.type === 'hold' && judgement !== 'miss') {
        state.status = 'holding';
        state.startJudgement = judgement;
        state.startOffset = worstOffset;
        lastEvent = {type:'hold-start',noteId:state.id,noteIndex:state.index,lanes:state.lanes.slice(),judgement:judgement,offsetSeconds:worstOffset,score:0,combo:combo,multiplier:multiplierForCombo(combo),optional:false};
        return Object.assign({},lastEvent);
      }
      return finalize(state,judgement,'hit',worstOffset);
    }

    function releaseLane(lane, songTime) {
      var laneIndex = Number(lane);
      var time = adjustedTime(songTime);
      var state = states.find(function (item) { return item.status === 'holding' && item.lanes[0] === laneIndex; });
      if (!state || config.holdAssist) return null;
      var grace = Math.max(windows.good,0.12);
      if (time < state.endTime - grace) return finalize(state,'miss','hold-break',time - state.endTime);
      return finalize(state,state.startJudgement,'hold-complete',state.startOffset);
    }

    function suspendHolds() {
      var lanes = [];
      states.forEach(function (state) {
        if (state.status !== 'holding') return;
        state.status = 'suspended';
        lanes.push(state.lanes[0]);
      });
      return lanes;
    }

    function resumeHolds(heldLanes, songTime) {
      var held = new Set(Array.isArray(heldLanes) ? heldLanes.map(Number) : []);
      var time = adjustedTime(songTime);
      var events = [];
      states.forEach(function (state) {
        if (state.status !== 'suspended') return;
        var lane = state.lanes[0];
        if (config.holdAssist || held.has(lane)) {
          state.status = 'holding';
          events.push({type:'hold-resume',noteId:state.id,noteIndex:state.index,lanes:[lane],judgement:'',offsetSeconds:0,score:0,combo:combo,multiplier:multiplierForCombo(combo),optional:false});
        } else {
          var miss = finalize(state,'miss','hold-break',time - state.endTime);
          if (miss) events.push(miss);
        }
      });
      return events;
    }

    function update(songTime) {
      var time = adjustedTime(songTime);
      var events = [];
      states.forEach(function (state) {
        if (state.status === 'pending' && time > state.time + windows.good) {
          var miss = finalize(state,'miss',state.note.optional ? 'optional-skip' : 'miss',time - state.time);
          if (miss) events.push(miss);
        } else if (state.status === 'holding' && time >= state.endTime) {
          var complete = finalize(state,state.startJudgement,'hold-complete',state.startOffset);
          if (complete) events.push(complete);
        }
      });
      if (!completed && time >= beatToSeconds(source.lengthBeats,source.bpm) && states.every(function (state) {
        return state.status === 'hit' || state.status === 'missed' || state.status === 'skipped';
      })) completed = true;
      return events;
    }

    function result() {
      var accuracy = requiredTotal ? effectiveWeighted() / requiredTotal * 100 : 100;
      var threshold = COMPLETION_THRESHOLDS[config.difficulty] || COMPLETION_THRESHOLDS.standard;
      var clearedByScore = resonance() >= threshold;
      var cleared = completed && (clearedByScore || !!config.noFail || config.mode === 'demo');
      var assistanceUsed = !!(config.widerTiming || config.simplified || config.holdAssist || config.noFail || config.mode === 'demo');
      var strongAssist = !!(config.noFail || config.mode === 'demo');
      return {
        chartId:source.id,region:source.region,mode:config.mode,completed:completed,cleared:cleared,
        progressionEligible:config.mode === 'scored' && cleared,assistanceUsed:assistanceUsed,
        assistance:{widerTiming:!!config.widerTiming,simplified:!!config.simplified,holdAssist:!!config.holdAssist,noFail:!!config.noFail,demo:config.mode === 'demo',strong:strongAssist},
        score:score,accuracy:round(accuracy,2),resonance:round(resonance(),2),combo:combo,maxCombo:maxCombo,
        perfect:counts.perfect,great:counts.great,good:counts.good,miss:counts.miss,stray:strayCount,
        rank:rankForAccuracy(accuracy,cleared,{strong:strongAssist}),threshold:threshold,
        bestPossibleNotes:requiredTotal,totalNotes:states.length
      };
    }

    function snapshot(songTime) {
      var outcome = result();
      return Object.assign({},outcome,{
        accuracy:round(currentAccuracy(),2),
        songTime:Number(songTime) || 0,chartLength:beatToSeconds(source.lengthBeats,source.bpm),
        countInLength:beatToSeconds(source.countInBeats,source.bpm),windows:windows,lastEvent:lastEvent,
        states:states.map(function (state) { return {id:state.id,index:state.index,status:state.status,beat:state.note.beat,time:state.time,endTime:state.endTime,type:state.note.type,lanes:state.lanes.slice(),optional:!!state.note.optional,judgement:state.judgement || state.startJudgement}; })
      });
    }

    function renderable(songTime, travelSeconds) {
      var time = Number(songTime) || 0;
      var travel = clamp(travelSeconds,0.75,5);
      return states.filter(function (state) {
        return state.status === 'holding' || state.status === 'suspended' || (state.status === 'pending' && state.time >= time - windows.good && state.time <= time + travel);
      }).map(function (state) {
        return {id:state.id,index:state.index,status:state.status,time:state.time,endTime:state.endTime,beat:state.note.beat,type:state.note.type,lanes:state.lanes.slice(),optional:!!state.note.optional,accent:!!state.note.accent,progress:clamp((state.time - time) / travel,0,1)};
      });
    }

    return Object.freeze({
      chart:source,options:Object.freeze(Object.assign({},config)),windows:windows,
      pressLane:pressLane,releaseLane:releaseLane,suspendHolds:suspendHolds,resumeHolds:resumeHolds,update:update,result:result,snapshot:snapshot,
      renderable:renderable,isComplete:function () { return completed; }
    });
  }

  Object.keys(CHARTS).forEach(function (id) {
    var result = validateChart(CHARTS[id],{campaign:true});
    if (!result.valid) throw new Error('Bundled Resonance Gate chart ' + id + ' is invalid: ' + result.errors.join(' '));
  });

  return Object.freeze({
    schemaVersion:SCHEMA_VERSION,bpm:DEFAULT_BPM,lanes:LANES,regionIds:REGION_IDS,
    stageByRegion:STAGE_BY_REGION,regionByStage:REGION_BY_STAGE,bossByRegion:BOSS_BY_REGION,
    windows:JUDGEMENT_WINDOWS,accuracyWeights:ACCURACY_WEIGHTS,baseScores:BASE_SCORES,
    completionThresholds:COMPLETION_THRESHOLDS,charts:CHARTS,
    beatToSeconds:beatToSeconds,secondsToBeat:secondsToBeat,validateChart:validateChart,
    chartForRegion:function (region, simplified) { return cloneChart(CHARTS[REGION_IDS.indexOf(region) >= 0 ? region : 'mossvale'],!!simplified); },
    judgementForOffset:judgementForOffset,windowsForOptions:windowsForOptions,
    multiplierForCombo:multiplierForCombo,rankForAccuracy:rankForAccuracy,rankValue:rankValue,
    freshProgress:freshProgress,sanitizeProgress:sanitizeProgress,recordAttempt:recordAttempt,
    applyResult:applyResult,markRewardClaimed:markRewardClaimed,createSession:createSession
  });
});
