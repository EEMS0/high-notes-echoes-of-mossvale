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
  overlay.src = 'assets/sprites/runtime/hero-customization-overlays.png';

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
  function drawHair(ctx, appearance, x, y, size) {
    var hairIndex = OPTIONS.hair.findIndex(function (entry) { return entry.id === appearance.hair; });
    if (overlay.complete && overlay.naturalWidth) {
      var cell = overlay.naturalWidth / 4;
      var hairSize=size*.30;
      ctx.drawImage(overlay, hairIndex * cell, 0, cell, overlay.naturalHeight, x - hairSize / 2, y - size * .73, hairSize, hairSize);
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
  function decorate(ctx, appearance, x, footY, size) {
    appearance = sanitizeAppearance(appearance);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha=.22;ctx.fillStyle=color('body',appearance.body);ctx.beginPath();ctx.arc(x,footY-size*.59,size*.145,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha = .18;
    ctx.fillStyle = color('outfit', appearance.outfit);
    ctx.fillRect(x-size*.34, footY-size*.48, size*.68, size*.43);
    ctx.restore();
    ctx.save();
    drawHair(ctx, appearance, x, footY, size);
    ctx.strokeStyle = color('accent', appearance.accent);
    ctx.lineWidth = Math.max(2, size*.035);
    ctx.beginPath(); ctx.arc(x, footY-size*.34, size*.27, .15, Math.PI-.15); ctx.stroke();
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
