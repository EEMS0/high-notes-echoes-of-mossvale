/*
 * MossFPBillboards — characters and pickups as camera-facing quads.
 *
 * The game's art is top-down sprite sheets, so entities are drawn Doom-style:
 * each one gets a quad that yaws to face the camera but never tilts, so looking
 * up or down does not shear the sprite.
 *
 * Sprites are produced by the game's own MossSprites.draw() into a small
 * offscreen canvas, which becomes the quad's texture. That reuses every bit of
 * existing animation, atlas and fallback logic rather than reimplementing it,
 * and the canvas is only repainted when the animation frame actually changes.
 *
 * Note on scale: the 2D sprite "size" values are *screen* sizes for a top-down
 * camera, not world heights, so world heights are declared here in metres.
 */
import * as THREE from './vendor/three.module.js';
import { groundHeightAt, metres } from './fp-scene.js';

const CANVAS_SIZE = 128;
/* Redraw at most this often; sprite animations run far slower than the frame rate. */
const REDRAW_INTERVAL = 0.06;

const SPECS = {
  npc: { height: metres(1.8), sizeInCanvas: 108 },
  enemy: { height: metres(1.35), sizeInCanvas: 104 },
  shrine: { height: metres(1.5), sizeInCanvas: 96 },
  collectible: { height: metres(0.6), sizeInCanvas: 72 },
  weed: { height: metres(0.5), sizeInCanvas: 64 },
  portal: { height: metres(2.4), sizeInCanvas: 110 }
};

export class MossFPBillboards {
  constructor(scene) {
    this.scene = scene;
    this.entries = new Map();
    this.group = new THREE.Group();
    this.group.name = 'billboards';
    scene.scene.add(this.group);
    this.elapsed = 0;
  }

  rebuild() {
    var self = this;
    this.entries.forEach(function (entry) { self.disposeEntry(entry); });
    this.entries.clear();
  }

  disposeEntry(entry) {
    this.group.remove(entry.mesh);
    if (entry.texture) entry.texture.dispose();
    if (entry.material) entry.material.dispose();
    if (entry.geometry) entry.geometry.dispose();
  }

  createEntry(key, kind) {
    var spec = SPECS[kind] || SPECS.npc;
    var canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    var texture = new THREE.CanvasTexture(canvas);
    /* Pixel art: match the 2D renderer's imageSmoothingEnabled = false. */
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;

    var material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.35,
      depthWrite: true,
      side: THREE.DoubleSide
    });
    var geometry = new THREE.PlaneGeometry(spec.height, spec.height);
    var mesh = new THREE.Mesh(geometry, material);
    this.group.add(mesh);

    var entry = {
      key: key, kind: kind, spec: spec, canvas: canvas,
      context: canvas.getContext('2d'), texture: texture,
      material: material, geometry: geometry, mesh: mesh,
      lastPaint: -1, lastSignature: '', seen: true
    };
    this.entries.set(key, entry);
    return entry;
  }

  /*
   * Repaint an entry's texture from the live sprite system. Falls back to a
   * simple tinted marker so an entity is never invisible just because its atlas
   * has not finished loading.
   */
  paint(entry, sprite) {
    var context = entry.context;
    context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    context.imageSmoothingEnabled = false;

    var drawn = false;
    if (sprite.id && window.MossSprites) {
      try {
        drawn = window.MossSprites.draw(
          context, sprite.id, sprite.animation, sprite.elapsed,
          CANVAS_SIZE / 2, CANVAS_SIZE, entry.spec.sizeInCanvas,
          { originX: 0.5, originY: 1 }
        );
      } catch (error) {
        drawn = false;
      }
    }

    if (!drawn) {
      /*
       * Shrines, notes and portals have no sprite sheet of their own, so they
       * are drawn as a glowing mote rather than a flat placeholder block — it
       * reads as something magical to walk toward, which is what they are.
       */
      var color = sprite.color || '#8fe3c1';
      var centreX = CANVAS_SIZE / 2;
      var centreY = CANVAS_SIZE - entry.spec.sizeInCanvas * 0.5;
      var radius = entry.spec.sizeInCanvas * 0.42;

      var glow = context.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius);
      glow.addColorStop(0, color);
      glow.addColorStop(0.45, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      context.globalAlpha = 0.55;
      context.fillStyle = glow;
      context.beginPath();
      context.arc(centreX, centreY, radius, 0, Math.PI * 2);
      context.fill();

      /* A diamond core keeps the shape readable against bright ground. */
      context.globalAlpha = 0.95;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(centreX, centreY - radius * 0.55);
      context.lineTo(centreX + radius * 0.34, centreY);
      context.lineTo(centreX, centreY + radius * 0.55);
      context.lineTo(centreX - radius * 0.34, centreY);
      context.closePath();
      context.fill();
      context.globalAlpha = 1;
    }
    entry.texture.needsUpdate = true;
  }

  /* Collect the entities worth drawing, with their sprite descriptors. */
  collect(api, out) {
    var entities = api.getEntities();
    var now = this.elapsed;

    (entities.npcs || []).forEach(function (npc) {
      var position = api.npcWorldPosition(npc);
      out.push({
        key: 'npc:' + npc.id, kind: 'npc', x: position.x, y: position.y,
        id: npc.spriteId || npc.id,
        animation: position.activity === 'travelling' ? 'walk_east' : 'idle_south',
        elapsed: now + (npc.x % 37) * 0.037, color: npc.color, signature: position.activity || ''
      });
    });

    (entities.enemies || []).forEach(function (enemy) {
      if (enemy.dead) return;
      out.push({
        key: 'enemy:' + (enemy.id || enemy.uid || (enemy.x + ':' + enemy.y)), kind: 'enemy',
        x: enemy.x, y: enemy.y,
        id: enemy.isMiniBoss ? enemy.assetId : enemy.elite ? enemy.eliteAssetId : enemy.speciesId,
        animation: 'idle_south', elapsed: enemy.animTime || now,
        color: enemy.eliteColor || '#ff8fa3', signature: enemy.mode || ''
      });
    });

    (entities.shrines || []).forEach(function (shrine) {
      out.push({
        key: 'shrine:' + shrine.id, kind: 'shrine', x: shrine.x, y: shrine.y,
        id: null, animation: 'idle', elapsed: now, color: '#ffe6a3', signature: 'shrine'
      });
    });

    (entities.collectibles || []).forEach(function (item) {
      out.push({
        key: 'item:' + item.id, kind: 'collectible', x: item.x, y: item.y,
        id: null, animation: 'idle', elapsed: now, color: '#8fb6ff', signature: 'item'
      });
    });

    (entities.portals || []).forEach(function (portal) {
      out.push({
        key: 'portal:' + portal.id, kind: 'portal', x: portal.x, y: portal.y,
        id: null, animation: 'idle', elapsed: now, color: '#c2b4ff', signature: 'portal'
      });
    });

    return out;
  }

  update(api, cameraYaw, dt) {
    this.elapsed += dt || 0;
    var descriptors = this.collect(api, []);
    var self = this;

    this.entries.forEach(function (entry) { entry.seen = false; });

    for (var i = 0; i < descriptors.length; i++) {
      var descriptor = descriptors[i];
      var entry = this.entries.get(descriptor.key);
      if (!entry) entry = this.createEntry(descriptor.key, descriptor.kind);
      entry.seen = true;

      /* Only touch the GPU when the visible frame would actually differ. */
      var signature = descriptor.id + '|' + descriptor.animation + '|' + descriptor.signature;
      if (signature !== entry.lastSignature || this.elapsed - entry.lastPaint >= REDRAW_INTERVAL) {
        entry.lastSignature = signature;
        entry.lastPaint = this.elapsed;
        this.paint(entry, descriptor);
      }

      var half = entry.spec.height * 0.5;
      entry.mesh.position.set(
        descriptor.x,
        groundHeightAt(descriptor.x, descriptor.y) + half,
        descriptor.y
      );
      /* Yaw only: the quad must never tilt with the camera pitch. */
      entry.mesh.rotation.set(0, cameraYaw, 0);
    }

    /* Retire anything that left the level so textures are not leaked. */
    this.entries.forEach(function (entry, key) {
      if (entry.seen) return;
      self.disposeEntry(entry);
      self.entries.delete(key);
    });
  }
}
