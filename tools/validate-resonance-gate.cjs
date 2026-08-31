#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const rhythm = require(path.join(root, 'resonance-gate-runtime.js'));
const living = require(path.join(root, 'living-resonance-runtime.js'));
const clone = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
const checked = (fn) => { fn(); checks += 1; };

checked(() => {
  assert.equal(rhythm.schemaVersion, 1);
  assert.equal(rhythm.bpm, 104);
  assert.deepEqual(Array.from(rhythm.regionIds), ['mossvale', 'rootsong', 'skyglass', 'moonwake']);
  assert.deepEqual(Array.from(rhythm.lanes, (lane) => lane.id), ['C', 'E', 'G', 'B']);
  assert.ok(Math.abs(rhythm.beatToSeconds(1, 104) - 60 / 104) < 1e-12);
  assert.ok(Math.abs(rhythm.secondsToBeat(60 / 104, 104) - 1) < 1e-12);
});

checked(() => {
  for (const [region, chart] of Object.entries(rhythm.charts)) {
    const validation = rhythm.validateChart(chart, { campaign: true });
    assert.equal(validation.valid, true, `${region}: ${validation.errors.join(' ')}`);
    const seconds = rhythm.beatToSeconds(chart.lengthBeats, chart.bpm);
    assert.ok(seconds >= 30 && seconds <= 45, `${region} campaign duration`);
    assert.equal(chart.region, region);
    assert.ok(chart.notes.some((note) => note.type === 'hold'), `${region} hold coverage`);
    assert.ok(chart.notes.some((note) => note.type === 'chord'), `${region} chord coverage`);
  }
});

checked(() => {
  const w = rhythm.windows;
  assert.equal(rhythm.judgementForOffset(w.perfect), 'perfect');
  assert.equal(rhythm.judgementForOffset(-w.perfect), 'perfect');
  assert.equal(rhythm.judgementForOffset(w.perfect + 1e-6), 'great');
  assert.equal(rhythm.judgementForOffset(-w.great), 'great');
  assert.equal(rhythm.judgementForOffset(w.great + 1e-6), 'good');
  assert.equal(rhythm.judgementForOffset(-w.good), 'good');
  assert.equal(rhythm.judgementForOffset(w.good + 1e-6), 'miss');
});

checked(() => {
  const chart = rhythm.charts.mossvale;
  const note = chart.notes[0];
  const time = rhythm.beatToSeconds(note.beat, chart.bpm);
  const positive = rhythm.createSession(chart, { latencyOffsetMs: 100 });
  assert.equal(positive.pressLane(note.lane, time + 0.1).judgement, 'perfect');
  const negative = rhythm.createSession(chart, { latencyOffsetMs: -100 });
  assert.equal(negative.pressLane(note.lane, time - 0.1).judgement, 'perfect');
});

checked(() => {
  const chart = rhythm.charts.mossvale;
  const note = chart.notes.find((entry) => entry.type === 'tap' && !entry.optional);
  const session = rhythm.createSession(chart);
  const event = session.pressLane(note.lane, rhythm.beatToSeconds(note.beat, chart.bpm));
  assert.equal(event.type, 'hit');
  assert.equal(event.judgement, 'perfect');
  assert.equal(event.score, 1000);
});

checked(() => {
  const chart = rhythm.charts.mossvale;
  const note = chart.notes.find((entry) => entry.type === 'chord');
  const time = rhythm.beatToSeconds(note.beat, chart.bpm);
  const session = rhythm.createSession(chart);
  assert.equal(session.pressLane(note.lanes[0], time).type, 'chord-part');
  const complete = session.pressLane(note.lanes[1], time);
  assert.equal(complete.type, 'hit');
  assert.equal(complete.judgement, 'perfect');
  assert.equal(complete.combo, 1, 'a chord advances combo once');
});

checked(() => {
  const chart = rhythm.charts.mossvale;
  const note = chart.notes.find((entry) => entry.type === 'hold');
  const start = rhythm.beatToSeconds(note.beat, chart.bpm);
  const end = rhythm.beatToSeconds(note.beat + note.durationBeats, chart.bpm);
  const broken = rhythm.createSession(chart);
  assert.equal(broken.pressLane(note.lane, start).type, 'hold-start');
  assert.equal(broken.releaseLane(note.lane, end - 0.5).type, 'hold-break');
  assert.equal(broken.snapshot(end).miss, 1);
  const completed = rhythm.createSession(chart);
  completed.pressLane(note.lane, start);
  const finish = completed.releaseLane(note.lane, end - 0.05);
  assert.equal(finish.type, 'hold-complete');
  assert.equal(finish.judgement, 'perfect');
  assert.ok(finish.score > 1000, 'hold ticks add bounded score');
  const assisted = rhythm.createSession(chart, { holdAssist: true });
  assisted.pressLane(note.lane, start);
  assert.equal(assisted.releaseLane(note.lane, start + 0.01), null);
  assert.equal(assisted.update(end).some((event) => event.type === 'hold-complete'), true);
});

checked(() => {
  const chart = rhythm.charts.mossvale;
  const session = rhythm.createSession(chart);
  for (const note of chart.notes.slice(0, 2)) {
    session.pressLane(note.lane, rhythm.beatToSeconds(note.beat, chart.bpm));
  }
  assert.equal(session.snapshot(0).combo, 2);
  const third = chart.notes[2];
  session.update(rhythm.beatToSeconds(third.beat, chart.bpm) + rhythm.windows.good + 0.001);
  assert.equal(session.snapshot(0).combo, 0);
  assert.equal(session.snapshot(0).miss, 1);
});

checked(() => {
  assert.equal(rhythm.multiplierForCombo(0), 1);
  assert.equal(rhythm.multiplierForCombo(10), 1.5);
  assert.equal(rhythm.multiplierForCombo(20), 2);
  assert.equal(rhythm.multiplierForCombo(60), 4);
  assert.equal(rhythm.multiplierForCombo(9999), 4);
});

checked(() => {
  const chart = rhythm.charts.mossvale;
  const session = rhythm.createSession(chart);
  const offsets = [0, 0.08, 0.14];
  chart.notes.slice(0, 3).forEach((note, index) => {
    session.pressLane(note.lane, rhythm.beatToSeconds(note.beat, chart.bpm) + offsets[index]);
  });
  assert.equal(session.snapshot(0).accuracy, 76.67);
  assert.deepEqual(rhythm.accuracyWeights, { perfect: 1, great: 0.8, good: 0.5, miss: 0 });
});

checked(() => {
  assert.equal(rhythm.rankForAccuracy(95, true, {}), 'S');
  assert.equal(rhythm.rankForAccuracy(88, true, {}), 'A');
  assert.equal(rhythm.rankForAccuracy(78, true, {}), 'B');
  assert.equal(rhythm.rankForAccuracy(50, true, {}), 'C');
  assert.equal(rhythm.rankForAccuracy(100, false, {}), '');
  assert.equal(rhythm.rankForAccuracy(100, true, { strong: true }), 'Practice');
});

function autoplayAtFrameRate(frameRate) {
  const chart = rhythm.charts.mossvale;
  const session = rhythm.createSession(chart);
  const actions = [];
  chart.notes.forEach((note) => {
    const time = rhythm.beatToSeconds(note.beat, chart.bpm);
    note.lanes.forEach((lane) => actions.push({ time, type: 'press', lane }));
    if (note.type === 'hold') actions.push({
      time: rhythm.beatToSeconds(note.beat + note.durationBeats, chart.bpm), type: 'release', lane: note.lane
    });
  });
  actions.sort((a, b) => a.time - b.time || (a.type === 'press' ? -1 : 1));
  const frameStep = 1 / frameRate;
  const end = rhythm.beatToSeconds(chart.lengthBeats, chart.bpm) + 0.1;
  let frame = 0;
  let cursor = 0;
  while (frame <= end) {
    while (cursor < actions.length && actions[cursor].time <= frame + 1e-12) {
      const action = actions[cursor++];
      if (action.type === 'press') session.pressLane(action.lane, action.time);
      else session.releaseLane(action.lane, action.time);
    }
    session.update(frame);
    frame += frameStep;
  }
  session.update(end);
  return session.result();
}

checked(() => {
  const at30 = autoplayAtFrameRate(30);
  const at144 = autoplayAtFrameRate(144);
  assert.deepEqual(at30, at144, 'audio-time input must be frame-rate deterministic');
  assert.equal(at30.rank, 'S');
  assert.equal(at30.miss, 0);
});

checked(() => {
  const base = clone(rhythm.charts.mossvale);
  const invalidCases = [
    (() => { const c = clone(base); c.notes[0].lanes = [9]; c.notes[0].lane = 9; return c; })(),
    (() => { const c = clone(base); c.notes[0].beat = -1; return c; })(),
    (() => { const c = clone(base); c.notes[c.notes.length - 1].beat = c.lengthBeats; return c; })(),
    (() => { const c = clone(base); const h = c.notes.find((note) => note.type === 'hold'); h.durationBeats = 0; return c; })(),
    (() => { const c = clone(base); c.notes[0].type = 'future'; return c; })(),
    (() => { const c = clone(base); const chord = c.notes.find((note) => note.type === 'chord'); chord.lanes = [0, 0]; return c; })(),
    (() => { const c = clone(base); c.notes[0].beat = 1; return c; })(),
    (() => { const c = clone(base); c.notes[c.notes.length - 1].beat = c.lengthBeats - 1; return c; })()
  ];
  invalidCases.forEach((chart, index) => assert.equal(rhythm.validateChart(chart, { campaign: true }).valid, false, `invalid chart ${index}`));
  const overlap = clone(base);
  const firstHold = overlap.notes.find((note) => note.type === 'hold');
  overlap.notes.splice(overlap.notes.indexOf(firstHold) + 1, 0, { beat: firstHold.beat + 0.5, lane: firstHold.lane, lanes: [firstHold.lane], type: 'hold', durationBeats: 1 });
  assert.equal(rhythm.validateChart(overlap, { campaign: true }).valid, false, 'overlapping holds');
});

checked(() => {
  const simplified = rhythm.chartForRegion('mossvale', true);
  assert.equal(simplified.simplified, true);
  assert.ok(simplified.notes.length < rhythm.charts.mossvale.notes.length);
  assert.ok(simplified.notes.some((note) => note.type === 'hold'));
  assert.ok(simplified.notes.some((note) => note.type === 'chord'));
  assert.equal(rhythm.validateChart(simplified, { campaign: true }).valid, true);
});

checked(() => {
  const dirty = { mossvale: { unlocked: 1, cleared: 1, attempts: 1e9, bestScore: -4,
    bestAccuracy: 800, bestRank: 'Z', maxCombo: Infinity, rewardClaimed: 1 } };
  const clean = rhythm.sanitizeProgress(dirty);
  assert.equal(clean.mossvale.unlocked, true);
  assert.equal(clean.mossvale.cleared, true);
  assert.equal(clean.mossvale.attempts, 99999);
  assert.equal(clean.mossvale.bestScore, 0);
  assert.equal(clean.mossvale.bestAccuracy, 100);
  assert.equal(clean.mossvale.bestRank, '');
  assert.equal(clean.mossvale.maxCombo, 0);
  assert.deepEqual(Object.keys(clean), Array.from(rhythm.regionIds));
});

const clearResult = { score: 50000, accuracy: 90, maxCombo: 40, rank: 'A',
  progressionEligible: true, cleared: true, assistanceUsed: false };

checked(() => {
  const first = rhythm.applyResult(rhythm.freshProgress(), 'mossvale', clearResult);
  assert.equal(first.firstClear, true);
  assert.equal(first.rewardAvailable, true);
  assert.equal(first.record.cleared, true);
  const replay = rhythm.applyResult(first.progress, 'mossvale', { ...clearResult, score: 100 });
  assert.equal(replay.firstClear, false);
  assert.equal(replay.record.cleared, true, 'replays never relock a gate');
  assert.equal(replay.record.bestScore, 50000);
});

checked(() => {
  const first = rhythm.applyResult(rhythm.freshProgress(), 'mossvale', clearResult);
  const claimed = rhythm.markRewardClaimed(first.progress, 'mossvale');
  assert.equal(claimed.mossvale.rewardClaimed, true);
  const replay = rhythm.applyResult(claimed, 'mossvale', { ...clearResult, score: 60000, rank: 'S', accuracy: 96 });
  assert.equal(replay.rewardAvailable, false, 'first-clear rewards remain one-time');
  assert.equal(replay.record.bestScore, 60000);
  assert.equal(replay.record.bestRank, 'S');
});

checked(() => {
  const assisted = rhythm.applyResult(rhythm.freshProgress(), 'rootsong', {
    ...clearResult, rank: 'Practice', assistanceUsed: true
  });
  assert.equal(assisted.record.cleared, true);
  assert.equal(assisted.record.assistedClear, true);
  const practiceOnly = rhythm.applyResult(rhythm.freshProgress(), 'rootsong', {
    ...clearResult, progressionEligible: false
  });
  assert.equal(practiceOnly.record.cleared, false, 'practice cannot open the campaign gate');
});

checked(() => {
  let progress = rhythm.freshProgress();
  progress = rhythm.recordAttempt(progress, 'skyglass');
  progress = rhythm.recordAttempt(progress, 'skyglass');
  assert.equal(progress.skyglass.attempts, 2);
  assert.equal(progress.skyglass.unlocked, true);
});

checked(() => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = rhythm.createSession(rhythm.charts.mossvale);
    const snapshot = session.snapshot(0);
    assert.equal(snapshot.score, 0);
    assert.equal(snapshot.combo, 0);
    assert.equal(snapshot.states.every((note) => note.status === 'pending'), true);
  }
});

checked(() => {
  const freshLiving = living.freshState();
  assert.deepEqual(Object.keys(freshLiving.rhythmTrials), Array.from(rhythm.regionIds));
  const migrated = living.sanitizeState({ rhythmTrials: {
    moonwake: { unlocked: true, cleared: true, attempts: 3, bestScore: 82450,
      bestAccuracy: 91.4, bestRank: 'A', maxCombo: 54 }
  } });
  assert.equal(migrated.rhythmTrials.moonwake.cleared, true);
  assert.equal(migrated.rhythmTrials.moonwake.bestScore, 82450);
  assert.equal(migrated.rhythmTrials.mossvale.cleared, false);
});

checked(() => {
  const input = read('input-manager.js');
  assert.match(input, /rhythmC:\s*\['d',\s*'arrowleft'\]/);
  assert.match(input, /rhythmE:\s*\['f',\s*'arrowdown'\]/);
  assert.match(input, /rhythmG:\s*\['j',\s*'arrowup'\]/);
  assert.match(input, /rhythmB:\s*\['k',\s*'arrowright'\]/);
  assert.match(input, /onActionEvent/);
  assert.match(input, /dispatchVirtualAction/);
  const index = read('index.html');
  assert.equal((index.match(/data-resonance-lane=/g) || []).length, 4, 'four touch lanes');
  assert.match(read('controller-ui.js'), /'resonanceGateOverlay'/, 'gamepad menu navigation includes Gate intro, pause, and results');
});

checked(() => {
  const game = read('game.js');
  assert.match(game, /function pauseResonanceGate\b/);
  assert.match(game, /function resumeResonanceGate\b/);
  assert.match(game, /window\.addEventListener\('blur', pauseForInterruption\)/);
  assert.match(game, /visibilitychange/);
  assert.match(game, /cancelAnimationFrame\(runtime\.animationFrame\)/);
  assert.match(game, /runtime\.session=null/);
  assert.match(game, /function bossPrerequisiteMet\(stage\)[\s\S]*rhythmGateCleared\(stage\)/);
  const pollGamepad = game.match(/function pollGamepad\(menuHandled, dt\) \{[\s\S]*?\n  \}/);
  assert.ok(pollGamepad, 'pollGamepad function is present');
  assert.match(pollGamepad[0], /if \(resonanceGateRuntime\.open\) \{[\s\S]*?releaseGamepadHolds\(\);[\s\S]*?return;[\s\S]*?\}/,
    'rhythm input ownership is enforced inside pollGamepad');
  assert.ok(pollGamepad[0].indexOf('if (resonanceGateRuntime.open)') < pollGamepad[0].indexOf("if (input.padPressed('pause'))"),
    'rhythm ownership guard precedes normal adventure pad actions');
  const keydownHandler = game.match(/window\.addEventListener\('keydown'[\s\S]*?\n  \}\);/);
  assert.ok(keydownHandler, 'keyboard listener is present');
  assert.doesNotMatch(keydownHandler[0], /releaseGamepadHolds\(\)/,
    'gamepad ownership guard is not misplaced in the keyboard listener');
  assert.match(game, /Losing the boss fight will never relock it/);
  assert.match(game, /SAVE_SCHEMA_VERSION\s*=\s*25\b/);
  assert.match(game, /savedVersion\s*<\s*25\s*&&\s*stateHasBoss/);
  for (const helper of ['openRhythmTrial', 'startRhythmTrial', 'setRhythmAssist', 'getRhythmSnapshot',
    'injectRhythmInput', 'completeRhythmTrial', 'resetRhythmTrial']) {
    assert.match(game, new RegExp(`${helper}\\s*:`), `missing QA helper ${helper}`);
  }
});

checked(() => {
  const audio = read('audio.js');
  assert.match(audio, /getTransportSnapshot\(fallbackTimeSeconds\)/);
  assert.match(audio, /rhythmHit\(noteName, judgement/);
  assert.match(audio, /case "resonance-clear"/);
  const index = read('index.html');
  assert.ok(index.indexOf('resonance-gate-runtime.js') < index.indexOf('living-resonance-runtime.js'));
  assert.ok(index.indexOf('living-resonance-runtime.js') < index.indexOf('game.js'));
  const sandbox = { window: { performance: { now: () => 9999000 } }, console };
  vm.createContext(sandbox);
  vm.runInContext(audio, sandbox, { filename: 'audio.js' });
  sandbox.window.MossAudio.context = { currentTime: 12.5, state: 'suspended' };
  sandbox.window.MossAudio._running = false;
  const clock = sandbox.window.MossAudio.getTransportSnapshot(9999);
  assert.equal(clock.audioTime, 12.5, 'audio clock epoch remains stable while the scheduler is paused');
});

console.log(`Resonance Gate validation passed: ${checks} groups covering 104 BPM timing, four charts, ` +
  'judgement boundaries, latency, taps, chords, holds, scoring, frame determinism, validation, ' +
  'save sanitation, permanent unlocks, one-time rewards, assists, repeated restart, input, pause, and cleanup.');
