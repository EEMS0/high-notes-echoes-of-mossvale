(function () {
  'use strict';

  var ROOT = 'Sprites/';
  var catalog = new Map();
  var records = new Map();
  var pending = new Map();
  var reportedErrors = new Set();
  var readyPromise = null;
  var EMPTY_DRAW_OPTIONS = Object.freeze({});

  function reportOnce(key, error) {
    if (reportedErrors.has(key)) return;
    reportedErrors.add(key);
    document.documentElement.dataset.spriteErrors = String(reportedErrors.size);
    console.error('[HIGH NOTES sprites] ' + key, error);
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.decoding = 'async';
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('Unable to load image: ' + url)); };
      image.src = url;
    });
  }

  function initialise() {
    if (readyPromise) return readyPromise;
    readyPromise = fetch(ROOT + 'manifest.json', { cache: 'force-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('Sprite catalog returned HTTP ' + response.status);
        return response.json();
      })
      .then(function (manifest) {
        if (!manifest || !Array.isArray(manifest.entries)) {
          throw new Error('Sprite catalog is missing its entries array.');
        }
        manifest.entries.forEach(function (entry) {
          if (entry && entry.id && entry.exists !== false) catalog.set(entry.id, entry);
        });
        document.documentElement.dataset.spriteCatalog = String(manifest.entries.length);
        document.documentElement.dataset.spriteErrors = '0';
        catalog.set('odin-expanded-actions', {
          id: 'odin-expanded-actions',
          group: 'companion-actions',
          manifest: 'Companions/Odin/odin-expanded-actions.json',
          sheet: 'Companions/Odin/odin-expanded-actions-sheet.png',
          exists: true
        });
        catalog.set('combat-effects', {
          id: 'combat-effects',
          group: 'effects',
          manifest: 'Effects/combat-effects.json',
          sheet: 'Effects/combat-effects-sheet.png',
          exists: true
        });
        return manifest;
      })
      .catch(function (error) {
        reportOnce('catalog', error);
        throw error;
      });
    return readyPromise;
  }

  function load(id) {
    if (records.has(id)) return Promise.resolve(records.get(id));
    if (pending.has(id)) return pending.get(id);
    var promise = initialise().then(function () {
      var entry = catalog.get(id);
      if (!entry) throw new Error('Unknown sprite id: ' + id);
      return Promise.all([
        fetch(ROOT + entry.manifest, { cache: 'force-cache' }).then(function (response) {
          if (!response.ok) throw new Error(entry.manifest + ' returned HTTP ' + response.status);
          return response.json();
        }),
        loadImage(ROOT + entry.sheet)
      ]).then(function (parts) {
        var manifest = parts[0];
        var image = parts[1];
        if (!manifest.frame || (!manifest.animations && !manifest.effects)) {
          throw new Error('Malformed animation manifest: ' + entry.manifest);
        }
        var record = { entry: entry, manifest: manifest, image: image };
        records.set(id, record);
        document.documentElement.dataset.spriteAssetsLoaded = String(records.size);
        pending.delete(id);
        window.dispatchEvent(new CustomEvent('moss-sprite-ready', { detail: { id: id } }));
        return record;
      });
    }).catch(function (error) {
      pending.delete(id);
      reportOnce(id, error);
      throw error;
    });
    pending.set(id, promise);
    return promise;
  }

  function preload(ids) {
    var unique = Array.from(new Set(ids || []));
    return Promise.allSettled(unique.map(load));
  }

  function directionFromAngle(angle) {
    var x = Math.cos(angle || 0);
    var y = Math.sin(angle || 0);
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'west' : 'east';
    return y < 0 ? 'north' : 'south';
  }

  function directionalAnimation(base, direction) {
    if (base !== 'idle' && base !== 'walk' && base !== 'run') return base;
    return base + '_' + (direction || 'south');
  }

  function animationFor(record, animationName) {
    var animations = record.manifest.animations || record.manifest.effects;
    return animations[animationName] || animations.idle_south || animations.idle ||
      animations.spawn || animations[Object.keys(animations)[0]];
  }

  function draw(context, id, animationName, elapsedSeconds, x, footY, size, options) {
    var record = records.get(id);
    if (!record) {
      load(id).catch(function () { /* reportOnce in load supplies actionable diagnostics. */ });
      return false;
    }
    var animation = animationFor(record, animationName);
    if (!animation) return false;
    var frameCount = Math.max(1, animation.frameCount || (animation.frames && animation.frames.length) || 1);
    var frameDuration = Math.max(1, animation.frameDurationMs || 100) / 1000;
    var elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    var frameIndex = animation.loop === false ?
      Math.min(frameCount - 1, Math.floor(elapsed / frameDuration)) :
      Math.floor(elapsed / frameDuration) % frameCount;
    var frame = animation.frames && animation.frames[frameIndex];
    var frameWidth = record.manifest.frame.width;
    var frameHeight = record.manifest.frame.height;
    var sourceX = frame ? frame.x : ((animation.startFrame || 0) + frameIndex) * frameWidth;
    var sourceY = frame ? frame.y : (animation.row || 0) * frameHeight;
    var sourceWidth = frame ? frame.width : frameWidth;
    var sourceHeight = frame ? frame.height : frameHeight;
    var origin = record.manifest.origin || { x: 0.5, y: 0.92 };
    var renderSize = Math.max(1, size || frameHeight);
    var renderWidth = renderSize * sourceWidth / sourceHeight;
    var opts = options || EMPTY_DRAW_OPTIONS;

    context.save();
    context.globalAlpha *= opts.alpha == null ? 1 : opts.alpha;
    if (opts.glow) {
      context.shadowColor = opts.glow;
      context.shadowBlur = opts.glowBlur == null ? 14 : opts.glowBlur;
    }
    context.translate(Math.round(x), Math.round(footY));
    if (opts.flipX) context.scale(-1, 1);
    context.drawImage(
      record.image,
      sourceX, sourceY, sourceWidth, sourceHeight,
      -renderWidth * (opts.originX == null ? origin.x : opts.originX),
      -renderSize * (opts.originY == null ? origin.y : opts.originY),
      renderWidth, renderSize
    );
    context.restore();
    return true;
  }

  function portraitPath(id, expression) {
    return ROOT + 'Portraits/' + id + '/' + (expression || 'neutral') + '.png';
  }

  function loaded(id) {
    return records.has(id);
  }

  window.MossSprites = {
    initialise: initialise,
    load: load,
    preload: preload,
    draw: draw,
    loaded: loaded,
    directionFromAngle: directionFromAngle,
    directionalAnimation: directionalAnimation,
    portraitPath: portraitPath
  };

  initialise().catch(function () { /* reportOnce in initialise supplies actionable diagnostics. */ });
}());
