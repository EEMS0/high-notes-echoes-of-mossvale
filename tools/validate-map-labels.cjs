'use strict';
const assert = require('node:assert/strict');
const labels = require('../map-label-runtime.js');
const anchors = [
  { text:'QUEST',x:200,y:230,w:35,priority:100 },
  { text:'YOU',x:201,y:230,w:26,priority:95 },
  { text:'BRAD',x:196,y:233,w:31,priority:40 },
  { text:'HOME',x:207,y:235,w:31,priority:40 },
  { text:'OPTIONAL',x:220,y:233,w:50,priority:10 }
];
const obstacles = anchors.map(a=>({x:a.x-7,y:a.y-7,w:14,h:14}));
const result = labels.layout(anchors,560,360,obstacles);
assert.equal(result.length,anchors.length);
assert.deepEqual(labels.layout(anchors,560,360,obstacles),result,'layout is deterministic');
for (const item of result) {
  assert.ok(!obstacles.some(o=>labels.overlaps(item,o)),'label avoids icons');
  assert.ok(!result.some(other=>other!==item&&labels.overlaps(item,other)),'labels never overlap');
}
for (const [x,y] of [[0,0],[0,360],[560,0],[560,360]]) {
  const edge=labels.layout([{text:'YOU',x,y,w:26,priority:95}],560,360);
  assert.equal(edge.length,1,'corner marker remains labelled');
  assert.ok(edge[0].x>=4&&edge[0].y>=4&&edge[0].x+edge[0].w<=556&&edge[0].y+edge[0].h<=356);
}
assert.equal(labels.layout([{text:'bad',x:NaN,y:0,w:30}],560,360).length,0);
const crowded=labels.layout(anchors.map(a=>({...a,x:30,y:30})),65,65);
assert.equal(crowded[0].text,'QUEST','critical labels win crowded layouts');
console.log('Map label validation passed: overlap, priority, deterministic placement, corners and invalid input.');
