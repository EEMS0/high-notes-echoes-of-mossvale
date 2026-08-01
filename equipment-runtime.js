(function () {
  'use strict';

  /*
   * HIGH NOTES equipment rig
   *
   * This is deliberately a hybrid renderer. The authored hero remains the body
   * layer and the existing instrument-mastery atlas supplies the item art. The
   * registry below owns attachment points, hand anchors, layer changes and
   * combat origins. Complex authored combined poses can be registered later via
   * `combinedSprite` without changing gameplay or save data.
   */
  var SCHEMA_VERSION = 1;
  var CHARACTER_ID = 'player-default';
  var VALID_LAYERS = Object.freeze(['rear-effects', 'rear', 'body', 'front', 'front-effects']);

  var EQUIPMENT = Object.freeze({
    guitar: Object.freeze({
      id:'guitar', atlasColumn:0, displayName:'Electric Guitar', twoHanded:true,
      renderSize:39, pivot:Object.freeze({x:0.45,y:0.56}), gripBias:0.48,
      projectileReach:20, effectReach:14
    }),
    bass: Object.freeze({
      id:'bass', atlasColumn:1, displayName:'Bass', twoHanded:true,
      renderSize:43, pivot:Object.freeze({x:0.43,y:0.57}), gripBias:0.46,
      projectileReach:22, effectReach:16
    }),
    synth: Object.freeze({
      id:'synth', atlasColumn:2, displayName:'Synth', twoHanded:true,
      renderSize:38, pivot:Object.freeze({x:0.5,y:0.52}), gripBias:0.5,
      projectileReach:25, effectReach:18
    }),
    drums: Object.freeze({
      id:'drums', atlasColumn:3, displayName:'Drumsticks', twoHanded:true,
      renderSize:34, pivot:Object.freeze({x:0.5,y:0.54}), gripBias:0.5,
      projectileReach:18, effectReach:19
    }),
    microphone: Object.freeze({
      id:'microphone', atlasColumn:4, displayName:'Microphone', twoHanded:false,
      renderSize:30, pivot:Object.freeze({x:0.43,y:0.57}), gripBias:0.72,
      projectileReach:26, effectReach:22
    }),
    violin: Object.freeze({
      id:'violin', atlasColumn:5, displayName:'Violin', twoHanded:true,
      renderSize:36, pivot:Object.freeze({x:0.48,y:0.54}), gripBias:0.52,
      projectileReach:24, effectReach:17
    })
  });

  /* Explicit direction records are intentional. A simple scaleX(-1) does not
   * preserve correct hand assignment, overlap or emitter placement. */
  var DIRECTIONS = Object.freeze({
    south:Object.freeze({
      vector:Object.freeze({x:0,y:1}), rotation:1.44, rotationSign:1, flipX:false,
      layer:'front', primary:Object.freeze({x:8,y:-1}), secondary:Object.freeze({x:-6,y:-4}),
      back:Object.freeze({x:-7,y:-12}), effect:Object.freeze({x:0,y:3})
    }),
    north:Object.freeze({
      vector:Object.freeze({x:0,y:-1}), rotation:-1.43, rotationSign:-1, flipX:true,
      layer:'rear', primary:Object.freeze({x:-7,y:-5}), secondary:Object.freeze({x:6,y:-5}),
      back:Object.freeze({x:7,y:-13}), effect:Object.freeze({x:0,y:-9})
    }),
    east:Object.freeze({
      vector:Object.freeze({x:1,y:0}), rotation:0.08, rotationSign:1, flipX:false,
      layer:'front', primary:Object.freeze({x:10,y:-3}), secondary:Object.freeze({x:1,y:-6}),
      back:Object.freeze({x:-5,y:-13}), effect:Object.freeze({x:12,y:-3})
    }),
    west:Object.freeze({
      vector:Object.freeze({x:-1,y:0}), rotation:-0.08, rotationSign:-1, flipX:true,
      layer:'front', primary:Object.freeze({x:-10,y:-3}), secondary:Object.freeze({x:-1,y:-6}),
      back:Object.freeze({x:5,y:-13}), effect:Object.freeze({x:-12,y:-3})
    })
  });

  function frame(dx, dy, rotation, scale, layer, visible, opacity) {
    return Object.freeze({
      dx:dx || 0, dy:dy || 0, rotation:rotation || 0,
      scale:scale == null ? 1 : scale,
      layer:layer || '', visible:visible !== false,
      opacity:opacity == null ? 1 : opacity
    });
  }

  var ANIMATIONS = Object.freeze({
    idle:Object.freeze({id:'idle',networkStateId:0,frameDuration:0.18,loop:true,frames:Object.freeze([
      frame(0,0,0,1), frame(0,-1,-0.025,1), frame(0,0,0.015,1), frame(0,1,0,1)
    ])}),
    walk:Object.freeze({id:'walk',networkStateId:1,frameDuration:0.09,loop:true,frames:Object.freeze([
      frame(-1,1,-0.07,1), frame(0,0,-0.02,1), frame(1,-1,0.05,1), frame(0,0,0.01,1),
      frame(1,1,0.07,1), frame(0,0,0.02,1), frame(-1,-1,-0.05,1), frame(0,0,-0.01,1)
    ])}),
    run:Object.freeze({id:'run',networkStateId:2,frameDuration:0.075,loop:true,frames:Object.freeze([
      frame(-2,1,-0.1,1.02), frame(0,-1,-0.04,1), frame(2,-2,0.08,1.02), frame(1,0,0.03,1),
      frame(2,1,0.1,1.02), frame(0,-1,0.04,1), frame(-2,-2,-0.08,1.02), frame(-1,0,-0.03,1)
    ])}),
    attack:Object.freeze({id:'attack',networkStateId:3,frameDuration:0.048,loop:false,frames:Object.freeze([
      frame(-5,-4,-0.72,0.98,'rear'), frame(-3,-5,-0.42,1,'rear'),
      frame(2,-4,-0.08,1.03,'front'), frame(7,-1,0.42,1.06,'front'),
      frame(8,2,0.78,1.04,'front'), frame(4,1,0.48,1.02,'front'),
      frame(1,0,0.18,1,'front'), frame(0,0,0,1)
    ])}),
    charged:Object.freeze({id:'charged',networkStateId:4,frameDuration:0.065,loop:false,frames:Object.freeze([
      frame(-6,-5,-0.8,1.04,'rear'), frame(-7,-6,-0.62,1.05,'rear'),
      frame(-5,-7,-0.45,1.07,'rear'), frame(0,-5,-0.12,1.08,'front'),
      frame(9,-1,0.58,1.12,'front'), frame(11,3,0.96,1.13,'front'),
      frame(6,2,0.62,1.06,'front'), frame(2,0,0.22,1.02,'front')
    ])}),
    special:Object.freeze({id:'special',networkStateId:5,frameDuration:0.07,loop:false,frames:Object.freeze([
      frame(-2,-4,-0.35,1.02,'rear'), frame(0,-6,-0.18,1.05,'front'),
      frame(4,-7,0.05,1.08,'front'), frame(7,-5,0.24,1.1,'front'),
      frame(7,-2,0.38,1.08,'front'), frame(4,0,0.22,1.04,'front'), frame(1,0,0.08,1.01,'front')
    ])}),
    block:Object.freeze({id:'block',networkStateId:6,frameDuration:0.11,loop:true,frames:Object.freeze([
      frame(5,-4,-0.56,1.03,'front'), frame(6,-5,-0.52,1.04,'front'),
      frame(5,-4,-0.56,1.03,'front'), frame(4,-3,-0.6,1.02,'front')
    ])}),
    dash:Object.freeze({id:'dash',networkStateId:7,frameDuration:0.045,loop:false,frames:Object.freeze([
      frame(-5,-2,-0.32,1,'rear'), frame(-2,-4,-0.18,1,'rear'),
      frame(3,-3,0.02,1.02,'front'), frame(6,-1,0.18,1.03,'front')
    ])}),
    dodge:Object.freeze({id:'dodge',networkStateId:8,frameDuration:0.05,loop:false,frames:Object.freeze([
      frame(-6,-6,-0.6,0.95,'rear'), frame(-4,-10,-0.35,0.92,'rear'),
      frame(1,-11,0.12,0.9,'rear'), frame(5,-7,0.48,0.94,'front'),
      frame(3,-3,0.3,0.98,'front'), frame(0,0,0.05,1,'front')
    ])}),
    hurt:Object.freeze({id:'hurt',networkStateId:9,frameDuration:0.075,loop:false,frames:Object.freeze([
      frame(3,-1,0.4,1,'front'), frame(5,1,0.62,1.02,'front'),
      frame(2,2,0.3,0.98,'front'), frame(0,0,0.08,1,'front')
    ])}),
    stun:Object.freeze({id:'stun',networkStateId:10,frameDuration:0.13,loop:true,frames:Object.freeze([
      frame(-2,1,-0.2,0.98,'rear'), frame(2,2,0.2,0.98,'front'),
      frame(2,1,0.16,0.99,'front'), frame(-2,2,-0.16,0.99,'rear')
    ])}),
    death:Object.freeze({id:'death',networkStateId:11,frameDuration:0.09,loop:false,frames:Object.freeze([
      frame(1,2,0.18,1,'front'), frame(4,5,0.5,0.98,'front'),
      frame(7,9,0.92,0.94,'front'), frame(10,13,1.25,0.9,'rear'),
      frame(12,17,1.46,0.86,'rear'), frame(12,19,1.58,0.82,'rear',false,0)
    ])}),
    respawn:Object.freeze({id:'respawn',networkStateId:12,frameDuration:0.08,loop:false,frames:Object.freeze([
      frame(0,2,0,0.8,'rear',false,0), frame(0,0,-0.12,0.86,'rear',true,0.35),
      frame(0,-2,-0.08,0.93,'rear',true,0.65), frame(0,-2,0,1,'front',true,1)
    ])}),
    switch:Object.freeze({id:'switch',networkStateId:13,frameDuration:0.075,loop:false,frames:Object.freeze([
      frame(0,0,0,1,'front',true,1), frame(-2,-4,-0.28,0.96,'rear',true,0.9),
      frame(-5,-10,-0.62,0.88,'rear',true,0.55), frame(-6,-13,-0.78,0.82,'rear',false,0),
      frame(-5,-12,-0.66,0.84,'rear',false,0), frame(-3,-8,-0.38,0.9,'rear',true,0.55),
      frame(-1,-3,-0.14,0.96,'front',true,0.9), frame(0,0,0,1,'front',true,1)
    ])}),
    victory:Object.freeze({id:'victory',networkStateId:14,frameDuration:0.095,loop:true,frames:Object.freeze([
      frame(0,-5,-0.18,1.05,'front'), frame(2,-8,0.05,1.09,'front'),
      frame(0,-10,0.18,1.12,'front'), frame(-2,-8,-0.04,1.09,'front')
    ])}),
    defeat:Object.freeze({id:'defeat',networkStateId:15,frameDuration:0.14,loop:false,frames:Object.freeze([
      frame(1,3,0.22,0.98,'front'), frame(3,7,0.5,0.94,'rear'),
      frame(5,10,0.8,0.9,'rear'), frame(5,12,0.92,0.88,'rear')
    ])})
  });

  var STATE_ALIASES = Object.freeze({
    movement:'walk', start_movement:'walk', stop_movement:'idle', jump_start:'run', jump:'run',
    jump_ascent:'run', jump_apex:'idle', fall:'dodge', fast_fall:'dodge', land:'idle',
    crouch:'block', air_dodge:'dodge', perfect_block:'block', counter:'attack',
    knockback:'hurt', get_up:'respawn', ground_attack:'attack', directional_attack:'attack',
    aerial_attack:'attack', recovery_special:'special', ultimate:'special', weapon_switch:'switch'
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function equipmentFor(id) {
    return EQUIPMENT[id] || EQUIPMENT.guitar;
  }

  function normaliseState(id) {
    var key = typeof id === 'string' ? id.toLowerCase().replace(/-/g, '_') : 'idle';
    key = STATE_ALIASES[key] || key;
    return ANIMATIONS[key] ? key : 'idle';
  }

  function directionFromAngle(angle) {
    var x = Math.cos(Number(angle) || 0);
    var y = Math.sin(Number(angle) || 0);
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'west' : 'east';
    return y < 0 ? 'north' : 'south';
  }

  function anchorWithMotion(anchor, motion, direction) {
    var lateral = direction === 'west' || direction === 'north' ? -motion.dx : motion.dx;
    return {x:anchor.x + lateral, y:anchor.y + motion.dy};
  }

  function resolvePose(options) {
    options = options && typeof options === 'object' ? options : {};
    var equipment = equipmentFor(options.equipmentId);
    var stateId = normaliseState(options.animationId || options.state);
    var animation = ANIMATIONS[stateId];
    var directionId = DIRECTIONS[options.direction] ? options.direction : directionFromAngle(options.facing);
    var direction = DIRECTIONS[directionId];
    var elapsed = Math.max(0, Number(options.elapsed) || 0);
    var requestedProgress = Number(options.progress);
    var rawFrame = Number.isFinite(requestedProgress) ?
      Math.floor(clamp(requestedProgress, 0, 0.999999) * animation.frames.length) :
      Math.floor(elapsed / animation.frameDuration);
    var frameIndex = animation.loop ? rawFrame % animation.frames.length :
      Math.min(animation.frames.length - 1, rawFrame);
    var motion = animation.frames[frameIndex];
    var primary = anchorWithMotion(direction.primary, motion, directionId);
    var secondary = anchorWithMotion(direction.secondary, motion, directionId);
    var backSlot = anchorWithMotion(direction.back, motion, directionId);
    var itemX;
    var itemY;
    if (equipment.twoHanded) {
      itemX = primary.x * equipment.gripBias + secondary.x * (1 - equipment.gripBias);
      itemY = primary.y * equipment.gripBias + secondary.y * (1 - equipment.gripBias);
    } else {
      itemX = primary.x;
      itemY = primary.y;
    }
    if (motion.layer === 'rear' && stateId === 'switch') {
      itemX = (itemX + backSlot.x) * 0.5;
      itemY = (itemY + backSlot.y) * 0.5;
    }
    var rotation = direction.rotation + motion.rotation * direction.rotationSign;
    var layer = VALID_LAYERS.indexOf(motion.layer) >= 0 ? motion.layer : direction.layer;
    var reachX = direction.vector.x * equipment.projectileReach;
    var reachY = direction.vector.y * equipment.projectileReach;
    var effectX = direction.vector.x * equipment.effectReach;
    var effectY = direction.vector.y * equipment.effectReach;
    var item = {
      x:itemX, y:itemY, rotation:rotation, scale:motion.scale,
      flipX:direction.flipX, flipY:false, opacity:motion.opacity,
      layer:layer, pivot:{x:equipment.pivot.x,y:equipment.pivot.y},
      visible:motion.visible, renderSize:equipment.renderSize,
      atlasColumn:equipment.atlasColumn,
      atlasRow:options.legendary ? 1 : 0
    };
    return {
      schemaVersion:SCHEMA_VERSION,
      characterId:options.characterId || CHARACTER_ID,
      equipmentId:equipment.id,
      animationId:stateId,
      networkStateId:animation.networkStateId,
      direction:directionId,
      frameIndex:frameIndex,
      frameCount:animation.frames.length,
      twoHanded:equipment.twoHanded,
      combinedSprite:animation.combinedSprite || null,
      item:item,
      anchors:{
        primaryHand:primary,
        secondaryHand:secondary,
        backSlot:backSlot,
        effect:anchorWithMotion(direction.effect,motion,directionId)
      },
      origins:{
        hitbox:{x:itemX + reachX * 0.42,y:itemY + reachY * 0.42},
        projectile:{x:itemX + reachX,y:itemY + reachY},
        effect:{x:itemX + effectX,y:itemY + effectY},
        trail:{x:itemX + reachX * 0.68,y:itemY + reachY * 0.68}
      }
    };
  }

  function draw(context, atlasImage, pose, layer, options) {
    if (!context || !atlasImage || !pose || !pose.item || !pose.item.visible) return false;
    if (!atlasImage.complete || !atlasImage.naturalWidth || !atlasImage.naturalHeight || atlasImage.failed) return false;
    if (layer && pose.item.layer !== layer) return false;
    options = options && typeof options === 'object' ? options : {};
    var equipment = equipmentFor(pose.equipmentId);
    var cellWidth = atlasImage.naturalWidth / 6;
    var cellHeight = atlasImage.naturalHeight / 2;
    var renderSize = Math.max(1, (Number(options.size) || pose.item.renderSize || equipment.renderSize));
    var renderWidth = renderSize * cellWidth / cellHeight;
    context.save();
    context.globalAlpha *= pose.item.opacity * (options.alpha == null ? 1 : options.alpha);
    if (options.glow) {
      context.shadowColor = options.glow;
      context.shadowBlur = options.glowBlur == null ? 8 : options.glowBlur;
    }
    context.translate(pose.item.x,pose.item.y);
    context.rotate(pose.item.rotation);
    context.scale((pose.item.flipX ? -1 : 1) * pose.item.scale, (pose.item.flipY ? -1 : 1) * pose.item.scale);
    context.drawImage(
      atlasImage,
      pose.item.atlasColumn * cellWidth, pose.item.atlasRow * cellHeight, cellWidth, cellHeight,
      -renderWidth * pose.item.pivot.x, -renderSize * pose.item.pivot.y, renderWidth, renderSize
    );
    context.restore();
    return true;
  }

  function worldOrigin(entity, pose, name) {
    entity = entity && typeof entity === 'object' ? entity : {x:0,y:0};
    var origin = pose && pose.origins && pose.origins[name] ? pose.origins[name] : {x:0,y:0};
    return {x:(Number(entity.x) || 0) + origin.x,y:(Number(entity.y) || 0) + origin.y};
  }

  function networkSnapshot(pose, cosmeticVariant) {
    pose = pose || resolvePose({});
    return {
      equipmentId:pose.equipmentId,
      animationState:pose.animationId,
      animationFrame:pose.frameIndex,
      animationTimestamp:Date.now(),
      facingDirection:pose.direction,
      networkStateId:pose.networkStateId,
      cosmeticVariant:typeof cosmeticVariant === 'string' ? cosmeticVariant : 'standard',
      schemaVersion:SCHEMA_VERSION
    };
  }

  function describe() {
    return {
      schemaVersion:SCHEMA_VERSION,
      architecture:'hybrid-layered-attachments',
      characterIds:[CHARACTER_ID],
      equipmentIds:Object.keys(EQUIPMENT),
      animationIds:Object.keys(ANIMATIONS),
      layers:VALID_LAYERS.slice(),
      assetNote:'Uses the existing authored hero and instrument-mastery atlases; no replacement binary art is claimed.'
    };
  }

  window.MossEquipmentRig = Object.freeze({
    schemaVersion:SCHEMA_VERSION,
    characterId:CHARACTER_ID,
    equipment:equipmentFor,
    validateEquipmentId:function (id) { return !!EQUIPMENT[id]; },
    normaliseState:normaliseState,
    directionFromAngle:directionFromAngle,
    resolvePose:resolvePose,
    draw:draw,
    worldOrigin:worldOrigin,
    networkSnapshot:networkSnapshot,
    describe:describe
  });
}());
