(function () {
  'use strict';

  var OPTIONS = {
    body: [
      { id:'fern', label:'Fern', color:'#d7a77e' }, { id:'amber', label:'Amber', color:'#a96f4f' },
      { id:'umber', label:'Umber', color:'#744830' }, { id:'moon', label:'Moon', color:'#efc6a6' }
    ],
    hair: [
      { id:'tuft', label:'Tuned Tuft' }, { id:'braid', label:'Echo Braid' },
      { id:'mohawk', label:'Riff Crest' }, { id:'cap', label:'Moss Cap' }
    ],
    outfit: [
      { id:'grove', label:'Grove', color:'#2c7165' }, { id:'ember', label:'Ember', color:'#8d414e' },
      { id:'sky', label:'Skyglass', color:'#396a91' }, { id:'violet', label:'Violet', color:'#694b91' },
      { id:'gold', label:'Headliner', color:'#8e7130' }
    ],
    accent: [
      { id:'mint', label:'Mint', color:'#56f0c4' }, { id:'gold', label:'Gold', color:'#ffc857' },
      { id:'blue', label:'Blue', color:'#62c7ff' }, { id:'violet', label:'Violet', color:'#d77cff' },
      { id:'rose', label:'Rose', color:'#ff7892' }, { id:'pearl', label:'Pearl', color:'#e7f7df' }
    ]
  };
  var DEFAULTS = { body:'fern', hair:'tuft', outfit:'grove', accent:'mint' };
  var overlay = new Image();
  overlay.decoding = 'async';
  overlay.src = 'assets/sprites/runtime/hero-hair-directions.png';

  /*
   * The authored instrument sheets already contain a complete hero silhouette.
   * Custom hair therefore has to register against the head inside the selected
   * animation cell, not against one generic world-space point. These anchors
   * were measured across all six integrated sheets and intentionally share one
   * table, including averaged anchors for the more extreme dash silhouettes.
   */
  var DIRECTIONS = ['south','north','west','east'];
  var DIRECTION_COLUMN = {south:0,north:1,west:2,east:3};
  var SOURCE_CELL_SIZE = 1254 / 4;
  var HERO_HEAD_ANCHORS = [
    [{x:179.4,y:107.4},{x:153.2,y:118.6},{x:147.4,y:110.8},{x:126.2,y:111.5}],
    [{x:179.9,y:81.3},{x:152.7,y:94.2},{x:144.4,y:86.4},{x:125.6,y:88.5}],
    [{x:166.1,y:77.1},{x:144.8,y:86.6},{x:151.7,y:80.5},{x:121.2,y:83.1}],
    [{x:150.2,y:94.4},{x:154.7,y:60.1},{x:87.2,y:82.8},{x:174.1,y:86.8}]
  ];
  var HAIR_SCALP_ANCHORS = {
    tuft:   [{x:167.5,y:181.5},{x:163,y:180.5},{x:163.5,y:158},{x:154.5,y:113}],
    braid:  [{x:149.5,y:195},{x:150,y:215},{x:139,y:185},{x:144,y:150}],
    mohawk: [{x:178.5,y:165},{x:138.5,y:168.5},{x:156,y:157},{x:133,y:118}],
    cap:    [{x:119.5,y:205},{x:110,y:204},{x:110.5,y:181},{x:111.5,y:149}]
  };
  var HAIR_SCALES = {tuft:.55,braid:.53,mohawk:.54,cap:.55};
  /* Long braid ornaments in one source cell touch the following cell's top
     edge. Crop that inherited edge strip rather than rendering a loose bead
     above the next directional pose. */
  var HAIR_CROPS = {
    tuft:   [{},{},{},{}],
    braid:  [{},{top:50},{top:44},{top:18}],
    mohawk: [{right:4},{},{},{}],
    cap:    [{left:12},{left:10},{},{}]
  };

  function allowed(group, value) {
    return OPTIONS[group].some(function (entry) { return entry.id === value; });
  }
  function sanitizeAppearance(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      body:allowed('body', value.body) ? value.body : DEFAULTS.body,
      hair:allowed('hair', value.hair) ? value.hair : DEFAULTS.hair,
      outfit:allowed('outfit', value.outfit) ? value.outfit : DEFAULTS.outfit,
      accent:allowed('accent', value.accent) ? value.accent : DEFAULTS.accent
    };
  }
  function sanitizeName(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f<>]/g, '').replace(/[^\w \-']/g, '').trim().slice(0, 18) || 'Echo';
  }
  function color(group, id) {
    var found = OPTIONS[group].find(function (entry) { return entry.id === id; });
    return found ? found.color : OPTIONS[group][0].color;
  }
  function normaliseDirection(direction) {
    return DIRECTIONS.indexOf(direction) >= 0 ? direction : 'south';
  }
  function normalisePose(direction, pose) {
    pose = pose && typeof pose === 'object' ? pose : {};
    direction = normaliseDirection(pose.direction || direction);
    var row = Math.max(0,Math.min(3,Math.floor(Number(pose.row) || 0)));
    var anchorY = Number(pose.anchorY);
    if (!Number.isFinite(anchorY)) anchorY = .73;
    return {
      direction:direction,
      column:DIRECTION_COLUMN[direction],
      row:row,
      anchorY:Math.max(.5,Math.min(1.1,anchorY))
    };
  }
  function hairPlacement(appearance, x, footY, size, direction, pose) {
    var hairIndex = OPTIONS.hair.findIndex(function (entry) { return entry.id === appearance.hair; });
    var resolved = normalisePose(direction,pose);
    var head = HERO_HEAD_ANCHORS[resolved.row][resolved.column];
    var sourceAnchor = HAIR_SCALP_ANCHORS[appearance.hair][resolved.column];
    var crop = HAIR_CROPS[appearance.hair][resolved.column];
    var cellW = overlay.naturalWidth ? overlay.naturalWidth / 4 : SOURCE_CELL_SIZE;
    var cellH = overlay.naturalHeight ? overlay.naturalHeight / 4 : SOURCE_CELL_SIZE;
    var hairSize = size * HAIR_SCALES[appearance.hair];
    var targetX = x - size / 2 + head.x / SOURCE_CELL_SIZE * size;
    var targetY = footY - size * resolved.anchorY + head.y / SOURCE_CELL_SIZE * size;
    var cropLeft = Number(crop.left) || 0;
    var cropTop = Number(crop.top) || 0;
    var cropRight = Number(crop.right) || 0;
    var cropBottom = Number(crop.bottom) || 0;
    var scaleX = cellW / SOURCE_CELL_SIZE;
    var scaleY = cellH / SOURCE_CELL_SIZE;
    var fullX = targetX - sourceAnchor.x / SOURCE_CELL_SIZE * hairSize;
    var fullY = targetY - sourceAnchor.y / SOURCE_CELL_SIZE * hairSize;
    return {
      direction:resolved.direction,
      row:resolved.row,
      column:resolved.column,
      sourceX:hairIndex * cellW + cropLeft * scaleX,
      sourceY:resolved.column * cellH + cropTop * scaleY,
      sourceWidth:(SOURCE_CELL_SIZE - cropLeft - cropRight) * scaleX,
      sourceHeight:(SOURCE_CELL_SIZE - cropTop - cropBottom) * scaleY,
      x:fullX + cropLeft / SOURCE_CELL_SIZE * hairSize,
      y:fullY + cropTop / SOURCE_CELL_SIZE * hairSize,
      width:(SOURCE_CELL_SIZE - cropLeft - cropRight) / SOURCE_CELL_SIZE * hairSize,
      height:(SOURCE_CELL_SIZE - cropTop - cropBottom) / SOURCE_CELL_SIZE * hairSize,
      targetX:targetX,
      targetY:targetY
    };
  }
  function drawHair(ctx, appearance, x, footY, size, direction, pose) {
    var placement = hairPlacement(appearance,x,footY,size,direction,pose);
    if (overlay.complete && overlay.naturalWidth) {
      ctx.drawImage(overlay,placement.sourceX,placement.sourceY,placement.sourceWidth,placement.sourceHeight,
        placement.x,placement.y,placement.width,placement.height);
      return;
    }
    ctx.fillStyle = color('accent', appearance.accent);
    ctx.beginPath();
    if (appearance.hair === 'braid') { ctx.arc(placement.targetX,placement.targetY,size*.17,Math.PI,Math.PI*2);ctx.rect(placement.targetX+size*.1,placement.targetY,size*.06,size*.22); }
    else if (appearance.hair === 'mohawk') { ctx.moveTo(placement.targetX-size*.17,placement.targetY);ctx.lineTo(placement.targetX,placement.targetY-size*.25);ctx.lineTo(placement.targetX+size*.17,placement.targetY); }
    else if (appearance.hair === 'cap') { ctx.arc(placement.targetX,placement.targetY,size*.21,Math.PI,Math.PI*2); }
    else { ctx.moveTo(placement.targetX-size*.18,placement.targetY);ctx.lineTo(placement.targetX-size*.05,placement.targetY-size*.2);ctx.lineTo(placement.targetX+size*.06,placement.targetY-size*.04);ctx.lineTo(placement.targetX+size*.18,placement.targetY-size*.17);ctx.lineTo(placement.targetX+size*.18,placement.targetY); }
    ctx.fill();
  }
  function decorate(ctx, appearance, x, footY, size, direction, pose) {
    appearance = sanitizeAppearance(appearance);
    pose = normalisePose(direction,pose);
    direction = pose.direction;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha=.22;ctx.fillStyle=color('body',appearance.body);ctx.beginPath();ctx.arc(x,footY-size*.59,size*.145,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha = .18;
    ctx.fillStyle = color('outfit', appearance.outfit);
    /* Keep the palette wash on the torso/cape. Wide rectangles also coloured
       an instrument held across the body, making it appear detached. */
    ctx.beginPath();
    if (direction === 'west' || direction === 'east') {
      ctx.ellipse(x,footY-size*.31,size*.21,size*.25,0,0,Math.PI*2);
    } else {
      ctx.ellipse(x,footY-size*.30,size*.25,size*.25,0,0,Math.PI*2);
    }
    ctx.fill();
    ctx.restore();
    ctx.save();
    drawHair(ctx, appearance, x, footY, size, direction, pose);
    /* Accent is an attached clasp, never a free-floating semicircle. */
    ctx.fillStyle = color('accent', appearance.accent);
    ctx.globalAlpha = .92;
    ctx.translate(x + (direction === 'west' ? -size*.04 : direction === 'east' ? size*.04 : 0),footY-size*.39);
    ctx.rotate(Math.PI/4);
    ctx.fillRect(-size*.027,-size*.027,size*.054,size*.054);
    ctx.restore();
  }

  window.MossCharacter = {
    options:OPTIONS,
    defaults:Object.assign({}, DEFAULTS),
    sanitizeAppearance:sanitizeAppearance,
    sanitizeName:sanitizeName,
    color:color,
    decorate:decorate,
    getHairPlacement:function (appearance,x,footY,size,direction,pose) {
      return hairPlacement(sanitizeAppearance(appearance),Number(x)||0,Number(footY)||0,Math.max(1,Number(size)||1),direction,pose);
    }
  };
}());
