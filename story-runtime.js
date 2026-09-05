(function (root, factory) {
  'use strict';
  var runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root) root.MossStory = runtime;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var NOTES = Object.freeze({
    C:{id:'C',shape:'circle',symbol:'●',key:'1',color:'#56f0c4'},
    D:{id:'D',shape:'hexagon',symbol:'⬢',key:'2',color:'#ff8f8f'},
    E:{id:'E',shape:'triangle',symbol:'▲',key:'3',color:'#ffc857'},
    F:{id:'F',shape:'star',symbol:'✦',key:'4',color:'#ff91c8'},
    G:{id:'G',shape:'diamond',symbol:'◆',key:'5',color:'#66b8ff'},
    A:{id:'A',shape:'pentagon',symbol:'⬟',key:'6',color:'#a9dc76'},
    B:{id:'B',shape:'square',symbol:'■',key:'7',color:'#db80ff'}
  });
  var TIMING_WINDOWS = Object.freeze({standard:2.4,forgiving:4.2,relaxed:8});
  var CHORDS = Object.freeze({
    'mossvale-major':Object.freeze({id:'mossvale-major',stage:1,name:'Grove Major',concept:'C major triad',notes:Object.freeze(['C','E','G']),ordered:false,hint:'Find C, E and G in any order.'}),
    'rootsong-minor':Object.freeze({id:'rootsong-minor',stage:2,name:'Rootsong Answer',concept:'E minor seventh',notes:Object.freeze(['E','G','B','D']),ordered:true,hint:'Build the deeper answer in order: E, G, B, D.'}),
    'skyglass-inversion':Object.freeze({id:'skyglass-inversion',stage:3,name:'Prism Inversion',concept:'Reflected F major ninth',notes:Object.freeze(['E','G','C','F','A']),ordered:true,hint:'Follow the old reflection, then open its hidden colours: E, G, C, F, A.'}),
    'moonwake-seventh':Object.freeze({id:'moonwake-seventh',stage:4,name:'Moonwake Memory',concept:'C major ninth arpeggio',notes:Object.freeze(['C','E','G','B','D']),ordered:true,hint:'Carry the memory beyond its seventh: C, E, G, B, D.'})
  });

  var ARCS = Object.freeze({
    1:Object.freeze({id:'story-mossvale',stage:1,title:'Four Notes, One Grove',region:'Mossvale Grove',guide:'EEMS',chord:'mossvale-major',summary:'Recover Mossvale\'s scattered notes, shape their first harmony, and silence the Nullspeaker.',steps:Object.freeze([
      Object.freeze({id:'meet-eems',objective:'Find EEMS at the grove console.',kind:'talk'}),
      Object.freeze({id:'gather-glowweed',objective:'Gather 6 Glowweed for Jimbo.',kind:'collect',goal:6}),
      Object.freeze({id:'tune-pruner',objective:'Return to Jimbo for the Pruner Edge.',kind:'talk'}),
      Object.freeze({id:'learn-pulse',objective:'Help Blu and learn Echo Pulse.',kind:'combat'}),
      Object.freeze({id:'recover-notes',objective:'Recover C, E, G and B from the four musical clearings.',kind:'collect',goal:4}),
      Object.freeze({id:'major-triad',objective:'Tune the Story Resonator with a C-major triad.',kind:'chord'}),
      Object.freeze({id:'compose-gate-song',objective:'Save a two-bar melody or chord progression at EEMS\' Mossbox.',kind:'compose'}),
      Object.freeze({id:'defeat-nullspeaker',objective:'Defeat the Nullspeaker in the Feedback Amphitheatre.',kind:'boss'})
    ])}),
    2:Object.freeze({id:'story-rootsong',stage:2,title:'The Rootsong Below',region:'Rootsong Hollows',guide:'Pip',chord:'rootsong-minor',summary:'Restore the buried resonators, answer their minor harmony, and return a shared rhythm to the roots.',steps:Object.freeze([
      Object.freeze({id:'meet-pip',objective:'Meet Pip, keeper of the buried Rootsong.',kind:'talk'}),
      Object.freeze({id:'wake-resonators',objective:'Wake all 3 silent root-resonators with Echo Pulse.',kind:'pulse',goal:3}),
      Object.freeze({id:'minor-answer',objective:'Answer the roots with the E-minor-seventh pattern E, G, B, D.',kind:'chord'}),
      Object.freeze({id:'quiet-discord-roots',objective:'Defeat the 3 discord roots feeding on the restored rhythm.',kind:'combat',goal:3}),
      Object.freeze({id:'claim-rootsong',objective:'Return to Pip and bind the Rootsong relic.',kind:'talk'}),
      Object.freeze({id:'defeat-rootbound',objective:'Defeat the Rootbound Colossus.',kind:'boss'})
    ])}),
    3:Object.freeze({id:'story-skyglass',stage:3,title:'A Melody in Many Skies',region:'Skyglass Reach',guide:'Zephra',chord:'skyglass-inversion',summary:'Reunite a melody split by prisms, choose the true inversion, and bring the Prism Choir back into one voice.',steps:Object.freeze([
      Object.freeze({id:'meet-zephra',objective:'Meet Zephra beneath the fractured skyway.',kind:'talk'}),
      Object.freeze({id:'retune-chimes',objective:'Retune all 3 refracted Skyglass chimes.',kind:'pulse',goal:3}),
      Object.freeze({id:'find-true-reflection',objective:'Resolve the full prism reflection with E, G, C, F, A.',kind:'chord'}),
      Object.freeze({id:'break-false-echoes',objective:'Defeat the 3 false echoes guarding the bridge.',kind:'combat',goal:3}),
      Object.freeze({id:'claim-skyglass',objective:'Return to Zephra and focus the Skyglass relic.',kind:'talk'}),
      Object.freeze({id:'defeat-prism-choir',objective:'Defeat the Prism Choir.',kind:'boss'})
    ])}),
    4:Object.freeze({id:'story-moonwake',stage:4,title:'Moonwake Remembers',region:'Moonwake Coast',guide:'Tavi',chord:'moonwake-seventh',summary:'Recover the tide\'s unfinished memories and complete the forgotten song beneath the moon.',steps:Object.freeze([
      Object.freeze({id:'meet-tavi',objective:'Meet Tavi while the resonance tide is unstable.',kind:'talk'}),
      Object.freeze({id:'recover-shell-memories',objective:'Recover all 3 singing shell memories.',kind:'collect',goal:3}),
      Object.freeze({id:'free-memory-echoes',objective:'Defeat the 3 echoes holding the memories apart.',kind:'combat',goal:3}),
      Object.freeze({id:'perform-seventh',objective:'Complete the Moonwake memory: C, E, G, B, D.',kind:'chord'}),
      Object.freeze({id:'claim-moonwake',objective:'Return to Tavi and complete the Moonwake relic.',kind:'talk'}),
      Object.freeze({id:'defeat-tidebreaker',objective:'Defeat the Tidebreaker and carry the song home.',kind:'boss'})
    ])})
  });

  function validChord(id) { return Object.prototype.hasOwnProperty.call(CHORDS,id); }
  function validNote(note) { return Object.prototype.hasOwnProperty.call(NOTES,note); }
  function timingWindow(mode) { return TIMING_WINDOWS[mode] || TIMING_WINDOWS.standard; }

  function evaluateChord(id, input) {
    var chord = CHORDS[id];
    if (!chord) return {status:'invalid',matched:0,complete:false};
    var notes = Array.isArray(input) ? input.filter(validNote).slice(0,chord.notes.length) : [];
    if (chord.ordered) {
      for (var i=0;i<notes.length;i++) {
        if (notes[i] !== chord.notes[i]) return {status:'wrong',matched:i,complete:false,expected:chord.notes[i]};
      }
      return {status:notes.length===chord.notes.length?'complete':'partial',matched:notes.length,complete:notes.length===chord.notes.length,expected:chord.notes[notes.length]||''};
    }
    var unique=[];
    for (var n=0;n<notes.length;n++) {
      if (unique.indexOf(notes[n])>=0) return {status:'wrong',matched:unique.length,complete:false};
      unique.push(notes[n]);
    }
    for (var u=0;u<unique.length;u++) if (chord.notes.indexOf(unique[u])<0) return {status:'wrong',matched:0,complete:false};
    var matched=chord.notes.filter(function(note){return unique.indexOf(note)>=0;}).length;
    return {status:matched===chord.notes.length?'complete':'partial',matched:matched,complete:matched===chord.notes.length};
  }

  function sanitizePuzzleState(id, raw) {
    var chord=CHORDS[id];
    if (!chord) return null;
    raw=raw&&typeof raw==='object'?raw:{};
    var status=['locked','available','in-progress','completed'].indexOf(raw.status)>=0?raw.status:'locked';
    var input=Array.isArray(raw.input)?raw.input.filter(validNote).slice(0,chord.notes.length):[];
    if (status==='completed') input=chord.notes.slice();
    return {status:status,input:input,attempts:Math.max(0,Math.min(999,Math.floor(Number(raw.attempts)||0))),rewardClaimed:!!raw.rewardClaimed};
  }

  return Object.freeze({schemaVersion:2,notes:NOTES,chords:CHORDS,arcs:ARCS,timingWindows:TIMING_WINDOWS,timingWindow:timingWindow,evaluateChord:evaluateChord,sanitizePuzzleState:sanitizePuzzleState});
});
