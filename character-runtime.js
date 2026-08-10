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
    return ['south','north','west','east'].indexOf(direction) >= 0 ? direction : 'south';
  }
  function drawHair(ctx, appearance, x, y, size, direction) {
    var hairIndex = OPTIONS.hair.findIndex(function (entry) { return entry.id === appearance.hair; });
    direction = normaliseDirection(direction);
    if (overlay.complete && overlay.naturalWidth) {
      var cellW = overlay.naturalWidth / 4;
      var cellH = overlay.naturalHeight / 4;
      var directionRow = {south:0,north:1,west:2,east:3}[direction];
      var hairSize=size*.48;
      ctx.drawImage(overlay, hairIndex * cellW, directionRow * cellH, cellW, cellH,
        x - hairSize / 2, y - size * .83, hairSize, hairSize);
      return;
    }
    ctx.fillStyle = color('accent', appearance.accent);
    ctx.beginPath();
    if (appearance.hair === 'braid') { ctx.arc(x, y-size*.51, size*.18, Math.PI, Math.PI*2); ctx.rect(x+size*.12,y-size*.52,size*.08,size*.27); }
    else if (appearance.hair === 'mohawk') { ctx.moveTo(x-size*.19,y-size*.54);ctx.lineTo(x,y-size*.82);ctx.lineTo(x+size*.18,y-size*.54); }
    else if (appearance.hair === 'cap') { ctx.arc(x,y-size*.55,size*.23,Math.PI,Math.PI*2); }
    else { ctx.moveTo(x-size*.2,y-size*.54);ctx.lineTo(x-size*.05,y-size*.75);ctx.lineTo(x+size*.07,y-size*.57);ctx.lineTo(x+size*.2,y-size*.72);ctx.lineTo(x+size*.2,y-size*.52); }
    ctx.fill();
  }
  function decorate(ctx, appearance, x, footY, size, direction) {
    appearance = sanitizeAppearance(appearance);
    direction = normaliseDirection(direction);
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
    drawHair(ctx, appearance, x, footY, size, direction);
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
    decorate:decorate
  };
}());
