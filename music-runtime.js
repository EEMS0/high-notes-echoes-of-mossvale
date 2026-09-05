(function (root, factory) {
  'use strict';
  var runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root) root.MossMusic = runtime;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var NOTE_ORDER = Object.freeze(['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C5']);
  var ANCHOR_NOTES = Object.freeze(['C', 'E', 'G', 'B']);
  var MAX_STEPS = 16;
  var MAX_NOTES_PER_STEP = 4;
  var NOTE_DEFS = Object.freeze({
    C: Object.freeze({ id: 'C', label: 'C', spoken: 'C', pitchClass: 'C', midi: 72, color: '#56f0c4', shape: 'circle', symbol: '●', key: '1' }),
    D: Object.freeze({ id: 'D', label: 'D', spoken: 'D', pitchClass: 'D', midi: 74, color: '#ff8f8f', shape: 'hexagon', symbol: '⬢', key: '2' }),
    E: Object.freeze({ id: 'E', label: 'E', spoken: 'E', pitchClass: 'E', midi: 76, color: '#ffc857', shape: 'triangle', symbol: '▲', key: '3' }),
    F: Object.freeze({ id: 'F', label: 'F', spoken: 'F', pitchClass: 'F', midi: 77, color: '#ff91c8', shape: 'star', symbol: '✦', key: '4' }),
    G: Object.freeze({ id: 'G', label: 'G', spoken: 'G', pitchClass: 'G', midi: 79, color: '#66b8ff', shape: 'diamond', symbol: '◆', key: '5' }),
    A: Object.freeze({ id: 'A', label: 'A', spoken: 'A', pitchClass: 'A', midi: 81, color: '#a9dc76', shape: 'pentagon', symbol: '⬟', key: '6' }),
    B: Object.freeze({ id: 'B', label: 'B', spoken: 'B', pitchClass: 'B', midi: 83, color: '#db80ff', shape: 'square', symbol: '■', key: '7' }),
    C5: Object.freeze({ id: 'C5', label: 'C↑', spoken: 'high C', pitchClass: 'C', midi: 84, color: '#a8ffe7', shape: 'ring', symbol: '◎', key: '8' })
  });

  var CHORD_PRESETS = Object.freeze([
    Object.freeze({ id: 'c-major', label: 'C', name: 'C major', notes: Object.freeze(['C', 'E', 'G']) }),
    Object.freeze({ id: 'd-minor', label: 'Dm', name: 'D minor', notes: Object.freeze(['D', 'F', 'A']) }),
    Object.freeze({ id: 'e-minor', label: 'Em', name: 'E minor', notes: Object.freeze(['E', 'G', 'B']) }),
    Object.freeze({ id: 'f-major', label: 'F', name: 'F major', notes: Object.freeze(['F', 'A', 'C5']) }),
    Object.freeze({ id: 'g-major', label: 'G', name: 'G major', notes: Object.freeze(['G', 'B', 'D']) }),
    Object.freeze({ id: 'a-minor', label: 'Am', name: 'A minor', notes: Object.freeze(['A', 'C5', 'E']) }),
    Object.freeze({ id: 'c-major-7', label: 'Cmaj7', name: 'C major seventh', notes: Object.freeze(['C', 'E', 'G', 'B']) }),
    Object.freeze({ id: 'd-minor-7', label: 'Dm7', name: 'D minor seventh', notes: Object.freeze(['D', 'F', 'A', 'C5']) }),
    Object.freeze({ id: 'g-dominant-7', label: 'G7', name: 'G dominant seventh', notes: Object.freeze(['G', 'B', 'D', 'F']) }),
    Object.freeze({ id: 'a-minor-7', label: 'Am7', name: 'A minor seventh', notes: Object.freeze(['A', 'C5', 'E', 'G']) })
  ]);

  function normalizeNote(value) {
    var clean = String(value == null ? '' : value).trim().toUpperCase().replace(/♯/g, '#').replace(/↑/g, '5');
    if (clean === '-' || clean === '—' || clean === 'REST') return '';
    if (clean === 'C4') clean = 'C';
    if (clean === 'HIGHC' || clean === 'HIGH C' || clean === 'C6') clean = 'C5';
    return Object.prototype.hasOwnProperty.call(NOTE_DEFS, clean) ? clean : '';
  }

  function normalizeStep(step) {
    var values;
    if (Array.isArray(step)) values = step;
    else if (typeof step === 'string' && /[+|/,\s]/.test(step.trim())) values = step.split(/[+|/,\s]+/);
    else values = [step];
    var unique = [];
    values.forEach(function (value) {
      var note = normalizeNote(value);
      if (note && unique.indexOf(note) < 0) unique.push(note);
    });
    return unique.slice(0, MAX_NOTES_PER_STEP);
  }

  function emptySteps() {
    return Array.from({ length: MAX_STEPS }, function () { return []; });
  }

  function legacyMelodyToSteps(melody) {
    var source = Array.isArray(melody) ? melody.slice(0, 8) : [];
    while (source.length < 8) source.push('-');
    var phrase = source.map(function (note) { return normalizeStep(note); });
    return phrase.concat(phrase.map(function (step) { return step.slice(); }));
  }

  function defaultComposition() {
    return {
      version: 1,
      steps: legacyMelodyToSteps(['C', '-', 'E', '-', 'G', '-', 'B', '-'])
    };
  }

  function emptyComposition() {
    return { version: 1, steps: emptySteps() };
  }

  function sanitizeComposition(raw, legacyMelody) {
    var source = raw && typeof raw === 'object' && Array.isArray(raw.steps) ? raw.steps :
      (Array.isArray(raw) ? raw : null);
    var steps = source ? source.slice(0, MAX_STEPS).map(normalizeStep) : legacyMelodyToSteps(legacyMelody);
    while (steps.length < MAX_STEPS) steps.push([]);
    return { version: 1, steps: steps };
  }

  function pitchClasses(step) {
    var classes = [];
    normalizeStep(step).forEach(function (note) {
      var pitchClass = NOTE_DEFS[note].pitchClass;
      if (classes.indexOf(pitchClass) < 0) classes.push(pitchClass);
    });
    return classes.sort(function (a, b) {
      return ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(a) - ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(b);
    });
  }

  function chordSignature(step) {
    return pitchClasses(step).join('-');
  }

  var CHORD_NAMES = Object.freeze({
    'C-E-G': 'C major',
    'D-F-A': 'D minor',
    'E-G-B': 'E minor',
    'C-F-A': 'F major',
    'D-G-B': 'G major',
    'C-E-A': 'A minor',
    'C-E-G-B': 'C major seventh',
    'C-D-F-A': 'D minor seventh',
    'D-F-G-B': 'G dominant seventh',
    'C-E-G-A': 'A minor seventh',
    'D-F-A-B': 'B half-diminished seventh'
  });

  function chordName(step) {
    var normalized = normalizeStep(step);
    if (!normalized.length) return 'Rest';
    if (normalized.length === 1) return NOTE_DEFS[normalized[0]].spoken;
    return CHORD_NAMES[chordSignature(normalized)] || normalized.map(function (note) { return NOTE_DEFS[note].label; }).join(' + ');
  }

  function compositionSummary(composition) {
    var clean = sanitizeComposition(composition, []);
    var unique = [];
    var occupied = 0;
    var chords = 0;
    var maxVoicing = 0;
    clean.steps.forEach(function (step) {
      if (step.length) occupied += 1;
      if (step.length > 1) chords += 1;
      maxVoicing = Math.max(maxVoicing, step.length);
      step.forEach(function (note) {
        var pitchClass = NOTE_DEFS[note].pitchClass;
        if (unique.indexOf(pitchClass) < 0) unique.push(pitchClass);
      });
    });
    return { occupiedSteps: occupied, distinctTones: unique.length, chordSteps: chords, maxVoicing: maxVoicing };
  }

  function isReady(composition) {
    var summary = compositionSummary(composition);
    return summary.occupiedSteps >= 4 && summary.distinctTones >= 3;
  }

  function toggleNote(composition, stepIndex, note) {
    var clean = sanitizeComposition(composition, []);
    var index = Math.max(0, Math.min(MAX_STEPS - 1, Math.floor(Number(stepIndex) || 0)));
    var normalized = normalizeNote(note);
    if (!normalized) return { composition: clean, changed: false, reason: 'invalid-note' };
    var step = clean.steps[index].slice();
    var at = step.indexOf(normalized);
    if (at >= 0) step.splice(at, 1);
    else if (step.length >= MAX_NOTES_PER_STEP) return { composition: clean, changed: false, reason: 'voicing-full' };
    else step.push(normalized);
    clean.steps[index] = normalizeStep(step);
    return { composition: clean, changed: true, reason: at >= 0 ? 'removed' : 'added' };
  }

  function setStep(composition, stepIndex, notes) {
    var clean = sanitizeComposition(composition, []);
    var index = Math.max(0, Math.min(MAX_STEPS - 1, Math.floor(Number(stepIndex) || 0)));
    clean.steps[index] = normalizeStep(notes);
    return clean;
  }

  function toLegacyMelody(composition) {
    var clean = sanitizeComposition(composition, []);
    return clean.steps.slice(0, 8).map(function (step) {
      if (!step.length) return '-';
      return step[0] === 'C5' ? 'C' : step[0];
    });
  }

  function bossAnchorSequence(composition) {
    var clean = sanitizeComposition(composition, []);
    var sequence = [];
    clean.steps.forEach(function (step) {
      step.forEach(function (note) {
        var anchor = note === 'C5' ? 'C' : note;
        if (ANCHOR_NOTES.indexOf(anchor) >= 0 && sequence.indexOf(anchor) < 0) sequence.push(anchor);
      });
    });
    ANCHOR_NOTES.forEach(function (note) { if (sequence.length < 4 && sequence.indexOf(note) < 0) sequence.push(note); });
    return sequence.slice(0, 4);
  }

  function findPreset(id) {
    return CHORD_PRESETS.find(function (preset) { return preset.id === id; }) || null;
  }

  return Object.freeze({
    schemaVersion: 1,
    maxSteps: MAX_STEPS,
    maxNotesPerStep: MAX_NOTES_PER_STEP,
    noteOrder: NOTE_ORDER,
    anchorNotes: ANCHOR_NOTES,
    notes: NOTE_DEFS,
    chordPresets: CHORD_PRESETS,
    normalizeNote: normalizeNote,
    normalizeStep: normalizeStep,
    defaultComposition: defaultComposition,
    emptyComposition: emptyComposition,
    sanitizeComposition: sanitizeComposition,
    chordName: chordName,
    compositionSummary: compositionSummary,
    isReady: isReady,
    toggleNote: toggleNote,
    setStep: setStep,
    toLegacyMelody: toLegacyMelody,
    bossAnchorSequence: bossAnchorSequence,
    findPreset: findPreset
  });
});
