/*
 * MossFPScene — Three.js world builder for the first-person view.
 *
 * The 3D view is a *presentation layer* over the existing 2D simulation. It is
 * built in the game's own coordinate space so no gameplay number is rescaled:
 *
 *     game x  ->  three x
 *     game y  ->  three z          (the 2D world's "down the screen")
 *     new     ->  three y          (height; the 2D game has no vertical axis)
 *
 * Everything here is derived from the level tables in game.js (obstacles are
 * {x,y,r} circles, water are {x,y,rx,ry} ellipses), so the 3D world always
 * matches what the 2D collision actually enforces.
 */
import * as THREE from './vendor/three.module.js';

/* Player r:13 reads as a ~0.41 m human radius, which sets the world scale. */
export const UNITS_PER_METRE = 32;
export function metres(value) { return value * UNITS_PER_METRE; }

/* Deterministic value noise — no allocation, stable across reloads and saves. */
function hash2(ix, iy, seed) {
  var h = ix * 374761393 + iy * 668265263 + seed * 1442695040;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, seed) {
  var ix = Math.floor(x);
  var iy = Math.floor(y);
  var fx = x - ix;
  var fy = y - iy;
  var ux = fx * fx * (3 - 2 * fx);
  var uy = fy * fy * (3 - 2 * fy);
  var a = hash2(ix, iy, seed);
  var b = hash2(ix + 1, iy, seed);
  var c = hash2(ix, iy + 1, seed);
  var d = hash2(ix + 1, iy + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

/*
 * Gentle terrain relief. The source game is perfectly flat, which reads as a
 * dead plane at eye level, so a small deterministic undulation is added purely
 * for the vertical axis. Amplitude is kept low (~0.5 m) so it never fights the
 * 2D collision, which remains strictly horizontal.
 */
const TERRAIN_AMPLITUDE = 16;
let terrainSeed = 90421;

export function groundHeightAt(x, z) {
  var broad = smoothNoise(x / 900, z / 900, terrainSeed) - 0.5;
  var fine = smoothNoise(x / 260, z / 260, terrainSeed + 17) - 0.5;
  return (broad * 1.6 + fine * 0.6) * TERRAIN_AMPLITUDE;
}

/* Reused scratch objects — nothing in the per-frame path allocates. */
const tmpColor = new THREE.Color();
const tmpColorB = new THREE.Color();

const REGION_STAGE = Object.freeze({
  mossvale: 1,
  rootsong: 2,
  skyglass: 3,
  moonwake: 4
});

/* The campaign bridge is the authority for restoration. The first-person
   renderer deliberately does not infer progress, grant tiers, or read saves. */
export function normaliseRestorationState(value, fallbackStage) {
  var source = value && typeof value === 'object' ? value : {};
  var numericValue = typeof value === 'number' ? value : source.tier;
  if (!Number.isFinite(Number(numericValue))) numericValue = source.restorationTier;
  var tier = Math.max(0, Math.min(3, Math.floor(Number(numericValue) || 0)));
  var stageFromRegion = REGION_STAGE[String(source.region || '').toLowerCase()];
  var stage = Number(source.stage || stageFromRegion || fallbackStage);
  stage = stage >= 1 && stage <= 4 ? Math.floor(stage) : 0;
  var reducedAmbient = source.reduceAmbient === true ||
    source.reducedAmbient === true || source.reducedEffects === true ||
    source.ambientEffects === false || source.ambientRestorationEffects === false;
  return { tier: tier, stage: stage, reducedAmbient: reducedAmbient };
}

function parseCssColor(value, fallback) {
  try {
    return new THREE.Color(value);
  } catch (error) {
    return new THREE.Color(fallback || '#ffffff');
  }
}

/*
 * The level palette stores rgba() strings for zones. THREE.Color cannot parse
 * the alpha, so strip it and keep the alpha separately for blend weighting.
 */
function parseRgba(value) {
  var match = /rgba?\(([^)]+)\)/.exec(String(value));
  if (!match) return { color: parseCssColor(value, '#ffffff'), alpha: 1 };
  var parts = match[1].split(',').map(function (part) { return parseFloat(part); });
  var color = new THREE.Color(
    (parts[0] || 0) / 255,
    (parts[1] || 0) / 255,
    (parts[2] || 0) / 255
  );
  return { color: color, alpha: parts.length > 3 ? parts[3] : 1 };
}

export class MossFPScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x0b1f1d, 1);
    this.maxPixelRatio = 2;
    this.worldGroup = null;
    this.billboards = [];
    this.disposables = [];
    this.restorationSummary = { tier: 0, stage: 0, reducedAmbient: false, instances: 0 };

    this.scene = new THREE.Scene();

    /* near/far in game units; near is tight so walls never clip the eye. */
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, metres(0.05), metres(260));

    this.hemi = new THREE.HemisphereLight(0xbfe6d4, 0x1b2f27, 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2cf, 1.35);
    this.sun.position.set(-0.45, 1, 0.6).multiplyScalar(metres(40));
    this.scene.add(this.sun);
  }

  setPixelRatioCap(cap) {
    this.maxPixelRatio = Math.max(0.5, Math.min(3, cap || 2));
    this.resize();
  }

  resize() {
    var width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    var height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    var ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /* Drop every GPU resource from the previous level before building a new one. */
  clearWorld() {
    if (this.worldGroup) this.scene.remove(this.worldGroup);
    for (var i = 0; i < this.disposables.length; i++) {
      var item = this.disposables[i];
      if (item && typeof item.dispose === 'function') item.dispose();
    }
    this.disposables.length = 0;
    this.billboards.length = 0;
    this.worldGroup = null;
    this.restorationSummary = { tier: 0, stage: 0, reducedAmbient: false, instances: 0 };
  }

  track(resource) {
    this.disposables.push(resource);
    return resource;
  }

  build(level, restorationState) {
    this.clearWorld();
    terrainSeed = level.seed || 90421;

    var group = new THREE.Group();
    this.worldGroup = group;
    this.scene.add(group);

    var palette = level.palette || {};
    var world = level.world || { w: 2800, h: 1900 };
    var ground = parseCssColor(palette.ground, '#102c29');

    this.scene.background = ground.clone().multiplyScalar(1.25);
    this.scene.fog = new THREE.Fog(this.scene.background.getHex(), metres(18), metres(95));
    this.renderer.setClearColor(this.scene.background.getHex(), 1);

    this.buildGround(group, level, world, ground);
    this.buildWater(group, level, palette);
    this.buildObstacles(group, level, palette);
    this.buildBoundary(group, world, palette);
    var restoration = normaliseRestorationState(restorationState, Number(level.id));
    /* The rehearsal prologue is intentionally outside the four-region
       restoration system even when it is entered from a restored save. */
    if (!level.isPrologue && restoration.stage === Number(level.id)) {
      this.buildRestoration(group, level, palette, restoration);
    }
    return group;
  }

  /*
   * Deterministic, non-interactive restoration dressing. All primitives are
   * instanced, reuse a tiny geometry/material pool, and are rebuilt only when
   * the bridge's sanitized tier or ambient setting changes. They never enter
   * collision or gameplay arrays.
   */
  buildRestoration(group, level, palette, restoration) {
    var tier = Math.max(0, Math.min(3, restoration.tier | 0));
    this.restorationSummary = {
      tier: tier,
      stage: restoration.stage,
      reducedAmbient: !!restoration.reducedAmbient,
      instances: 0
    };
    if (!tier) return;

    var reduced = !!restoration.reducedAmbient;
    var counts = reduced ? [5, 3, 1] : [14, 8, 4];
    var occupied = [];
    var placements = [
      this.restorationPositions(level, counts[0], 101 + restoration.stage * 37, 28, occupied),
      tier >= 2 ? this.restorationPositions(level, counts[1], 211 + restoration.stage * 53, 36, occupied) : [],
      tier >= 3 ? this.restorationPositions(level, counts[2], 307 + restoration.stage * 71, 52, occupied) : []
    ];
    var dressing = new THREE.Group();
    dressing.name = 'living-restoration-stage-' + restoration.stage + '-tier-' + tier;
    group.add(dressing);

    var colors = {
      1: ['#8fe3c1', '#ffbe70', '#f6e36d'],
      2: ['#b7d66d', '#d9a85d', '#ffd66b'],
      3: ['#9de8ff', '#c2b4ff', '#ff91d5'],
      4: ['#61d8c8', '#86cfff', '#e8d9a8']
    }[restoration.stage] || ['#8fe3c1', '#ffc857', '#ffffff'];

    var glow = this.track(new THREE.MeshBasicMaterial({
      color: colors[0], transparent: true, opacity: reduced ? 0.68 : 0.82,
      depthWrite: false
    }));
    var accent = this.track(new THREE.MeshLambertMaterial({
      color: colors[1], emissive: parseCssColor(colors[1], '#ffc857').multiplyScalar(0.17),
      flatShading: true
    }));
    var structure = this.track(new THREE.MeshLambertMaterial({
      color: parseCssColor(palette.border, '#426b57').lerp(parseCssColor(colors[2], '#ffffff'), 0.22),
      flatShading: true
    }));
    var sphere = this.track(new THREE.SphereGeometry(1, 7, 5));
    var stem = this.track(new THREE.CylinderGeometry(0.14, 0.2, 1, 6));
    var cone = this.track(new THREE.ConeGeometry(1, 1, 5));
    var ring = this.track(new THREE.TorusGeometry(1, 0.13, 5, 12));

    if (restoration.stage === 1) {
      this.addRestorationInstances(dressing, sphere, glow, placements[0], 'returning-fireflies', function (dummy, point, index) {
        var size = 2.2 + hash2(index, 1, 41) * 2.2;
        dummy.position.set(point.x, point.y + 18 + hash2(index, 2, 43) * 34, point.z);
        dummy.scale.setScalar(size);
      });
      if (tier >= 2) this.addBloomInstances(dressing, stem, cone, structure, accent, placements[1], 'heart-flowers');
      if (tier >= 3) this.addLanternInstances(dressing, stem, sphere, structure, glow, placements[2], 'repaired-performance-lights');
    } else if (restoration.stage === 2) {
      this.addRestorationInstances(dressing, sphere, glow, placements[0], 'glowing-root-nodes', function (dummy, point, index) {
        var width = 4 + hash2(index, 2, 51) * 3;
        dummy.position.set(point.x, point.y + width * 0.55, point.z);
        dummy.scale.set(width * 1.5, width * 0.65, width);
      });
      if (tier >= 2) this.addBloomInstances(dressing, stem, cone, structure, accent, placements[1], 'rhythm-fungi');
      if (tier >= 3) this.addResonatorInstances(dressing, stem, ring, structure, glow, placements[2], 'active-root-resonators');
    } else if (restoration.stage === 3) {
      this.addRestorationInstances(dressing, cone, glow, placements[0], 'healed-prisms', function (dummy, point, index) {
        var height = 20 + hash2(index, 3, 61) * 18;
        dummy.position.set(point.x, point.y + height * 0.5, point.z);
        dummy.scale.set(5 + height * 0.08, height, 5 + height * 0.08);
        dummy.rotation.z = (hash2(index, 4, 63) - 0.5) * 0.24;
      });
      if (tier >= 2) this.addLanternInstances(dressing, stem, sphere, structure, glow, placements[1], 'bridge-lights');
      if (tier >= 3) this.addResonatorInstances(dressing, stem, ring, structure, accent, placements[2], 'restored-sky-chimes');
    } else if (restoration.stage === 4) {
      this.addLanternInstances(dressing, stem, sphere, structure, glow, placements[0], 'moonwake-lanterns');
      if (tier >= 2) this.addRestorationInstances(dressing, ring, glow, placements[1], 'peaceful-memory-echoes', function (dummy, point, index) {
        var size = 10 + hash2(index, 5, 73) * 5;
        dummy.position.set(point.x, point.y + 18 + hash2(index, 6, 79) * 18, point.z);
        dummy.scale.setScalar(size);
        dummy.rotation.y = hash2(index, 7, 83) * Math.PI;
      });
      if (tier >= 3) this.addResonatorInstances(dressing, stem, ring, structure, accent, placements[2], 'coastal-harmony-stands');
    }
  }

  restorationPositions(level, count, salt, clearance, occupied) {
    var positions = [];
    var world = level.world || { w: 2800, h: 1900 };
    var attempts = Math.max(40, count * 40);
    var seed = Number(level.seed) || 90421;
    for (var attempt = 0; attempt < attempts && positions.length < count; attempt++) {
      var x = 70 + hash2(attempt + 1, salt, seed) * Math.max(1, world.w - 140);
      var z = 70 + hash2(salt, attempt + 1, seed + 19) * Math.max(1, world.h - 140);
      if (!this.isRestorationPlacementOpen(level, x, z, clearance, occupied)) continue;
      var point = { x: x, z: z, y: groundHeightAt(x, z) };
      positions.push(point);
      occupied.push(point);
    }
    return positions;
  }

  isRestorationPlacementOpen(level, x, z, clearance, occupied) {
    var obstacles = level.obstacles || [];
    for (var i = 0; i < obstacles.length; i++) {
      var obstacle = obstacles[i];
      if (Math.hypot(x - obstacle.x, z - obstacle.y) < obstacle.r + clearance) return false;
    }
    var pools = level.water || [];
    for (var p = 0; p < pools.length; p++) {
      var pool = pools[p];
      var nx = (x - pool.x) / Math.max(1, pool.rx + clearance);
      var nz = (z - pool.y) / Math.max(1, pool.ry + clearance);
      if (nx * nx + nz * nz < 1) return false;
    }
    var landmarks = [level.spawn, level.hub, level.boss];
    for (var l = 0; l < landmarks.length; l++) {
      var landmark = landmarks[l];
      if (landmark && Math.hypot(x - landmark.x, z - landmark.y) < clearance + 62) return false;
    }
    for (var j = 0; j < occupied.length; j++) {
      if (Math.hypot(x - occupied[j].x, z - occupied[j].z) < clearance * 1.7) return false;
    }
    return true;
  }

  addRestorationInstances(group, geometry, material, placements, name, transform) {
    if (!placements.length) return null;
    var mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    var dummy = new THREE.Object3D();
    for (var i = 0; i < placements.length; i++) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      transform(dummy, placements[i], i);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    group.add(mesh);
    this.restorationSummary.instances += placements.length;
    return mesh;
  }

  addBloomInstances(group, stemGeometry, bloomGeometry, stemMaterial, bloomMaterial, placements, name) {
    this.addRestorationInstances(group, stemGeometry, stemMaterial, placements, name + '-stems', function (dummy, point, index) {
      var height = 10 + hash2(index, 8, 89) * 8;
      dummy.position.set(point.x, point.y + height * 0.5, point.z);
      dummy.scale.set(3.2, height, 3.2);
    });
    this.addRestorationInstances(group, bloomGeometry, bloomMaterial, placements, name + '-blooms', function (dummy, point, index) {
      var height = 10 + hash2(index, 8, 89) * 8;
      var size = 5 + hash2(index, 9, 97) * 2.5;
      dummy.position.set(point.x, point.y + height + size * 0.35, point.z);
      dummy.scale.set(size, size * 0.75, size);
      dummy.rotation.x = Math.PI;
      dummy.rotation.y = hash2(index, 10, 101) * Math.PI * 2;
    });
  }

  addLanternInstances(group, postGeometry, lightGeometry, postMaterial, lightMaterial, placements, name) {
    this.addRestorationInstances(group, postGeometry, postMaterial, placements, name + '-posts', function (dummy, point, index) {
      var height = 25 + hash2(index, 11, 103) * 10;
      dummy.position.set(point.x, point.y + height * 0.5, point.z);
      dummy.scale.set(4.2, height, 4.2);
    });
    this.addRestorationInstances(group, lightGeometry, lightMaterial, placements, name + '-lights', function (dummy, point, index) {
      var height = 25 + hash2(index, 11, 103) * 10;
      var size = 4.5 + hash2(index, 12, 107) * 1.8;
      dummy.position.set(point.x, point.y + height + 2, point.z);
      dummy.scale.setScalar(size);
    });
  }

  addResonatorInstances(group, postGeometry, ringGeometry, postMaterial, ringMaterial, placements, name) {
    this.addRestorationInstances(group, postGeometry, postMaterial, placements, name + '-stands', function (dummy, point, index) {
      var height = 30 + hash2(index, 13, 109) * 8;
      dummy.position.set(point.x, point.y + height * 0.5, point.z);
      dummy.scale.set(4.8, height, 4.8);
    });
    this.addRestorationInstances(group, ringGeometry, ringMaterial, placements, name + '-rings', function (dummy, point, index) {
      var height = 30 + hash2(index, 13, 109) * 8;
      var size = 11 + hash2(index, 14, 113) * 3;
      dummy.position.set(point.x, point.y + height, point.z);
      dummy.scale.setScalar(size);
      dummy.rotation.y = hash2(index, 15, 127) * Math.PI;
    });
  }

  /*
   * One displaced plane carrying vertex colours. Zone tints are baked into the
   * vertices rather than drawn as overlay quads, which keeps the ground a
   * single draw call and avoids any z-fighting between stacked planes.
   */
  buildGround(group, level, world, baseColor) {
    var segmentsX = Math.max(24, Math.round(world.w / 45));
    var segmentsY = Math.max(24, Math.round(world.h / 45));
    var geometry = new THREE.PlaneGeometry(world.w, world.h, segmentsX, segmentsY);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(world.w / 2, 0, world.h / 2);

    var position = geometry.attributes.position;
    var colors = new Float32Array(position.count * 3);
    var zones = level.zones || [];
    var parsedZones = zones.map(function (zone) {
      return {
        x: zone[0], y: zone[1], w: zone[2], h: zone[3],
        inner: parseRgba(zone[4]), outer: parseRgba(zone[5])
      };
    });

    for (var i = 0; i < position.count; i++) {
      var x = position.getX(i);
      var z = position.getZ(i);
      position.setY(i, groundHeightAt(x, z));

      tmpColor.copy(baseColor);
      for (var j = 0; j < parsedZones.length; j++) {
        var zone = parsedZones[j];
        /* Elliptical falloff so biome patches blend instead of forming boxes. */
        var nx = (x - zone.x) / (zone.w * 0.5);
        var nz = (z - zone.y) / (zone.h * 0.5);
        var d = Math.sqrt(nx * nx + nz * nz);
        if (d >= 1) continue;
        var weight = (1 - d) * (1 - d);
        tmpColorB.copy(zone.inner.color).lerp(zone.outer.color, Math.min(1, d));
        tmpColor.lerp(tmpColorB, weight * (zone.inner.alpha || 1));
      }
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    var material = new THREE.MeshLambertMaterial({ vertexColors: true });
    var mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ground';
    group.add(mesh);
    this.track(geometry);
    this.track(material);
    return mesh;
  }

  /*
   * Water is solid to the 2D collision (circleHitsObstacle rejects it), so it
   * is drawn as a shallow inset disc the player can see but never enter.
   */
  buildWater(group, level, palette) {
    var pools = level.water || [];
    if (!pools.length) return;
    var material = new THREE.MeshLambertMaterial({
      color: parseCssColor(palette.waterA, '#2a7180'),
      transparent: true,
      opacity: 0.86
    });
    this.track(material);
    var geometry = new THREE.CircleGeometry(1, 28);
    geometry.rotateX(-Math.PI / 2);
    this.track(geometry);

    for (var i = 0; i < pools.length; i++) {
      var pool = pools[i];
      var mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(pool.x, groundHeightAt(pool.x, pool.y) - 3, pool.y);
      mesh.scale.set(pool.rx, 1, pool.ry);
      group.add(mesh);
    }
  }

  /*
   * Obstacles are circles with a radius, so each stage's palette.obstacle style
   * ('tree' | 'root' | 'crystal' | 'coast') decides what fills that footprint.
   * Geometry is shared per style and only the transform differs.
   */
  buildObstacles(group, level, palette) {
    var obstacles = level.obstacles || [];
    if (!obstacles.length) return;
    var style = palette.obstacle || 'tree';
    var built = this.obstacleFactory(style, palette);

    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      var node = built.make(o, i);
      node.position.set(o.x, groundHeightAt(o.x, o.y), o.y);
      /* Deterministic per-obstacle variation keeps the grove from looking cloned. */
      node.rotation.y = hash2(Math.round(o.x), Math.round(o.y), 7) * Math.PI * 2;
      group.add(node);
    }
  }

  obstacleFactory(style, palette) {
    var self = this;
    var trunkColor = parseCssColor(palette.border, '#426b57').multiplyScalar(0.7);
    var canopyColor = parseCssColor((palette.grass && palette.grass[0]) || '#3f7857', '#3f7857');
    var accent = parseCssColor(palette.routeGlow ? '#9fe8d0' : '#9fe8d0', '#9fe8d0');

    var trunkMat = this.track(new THREE.MeshLambertMaterial({ color: trunkColor }));
    var canopyMat = this.track(new THREE.MeshLambertMaterial({ color: canopyColor, flatShading: true }));
    var crystalMat = this.track(new THREE.MeshLambertMaterial({
      color: accent, flatShading: true, transparent: true, opacity: 0.85
    }));
    var rockMat = this.track(new THREE.MeshLambertMaterial({ color: trunkColor, flatShading: true }));

    var trunkGeo = this.track(new THREE.CylinderGeometry(0.34, 0.46, 1, 7));
    var canopyGeo = this.track(new THREE.IcosahedronGeometry(1, 0));
    var spikeGeo = this.track(new THREE.ConeGeometry(0.6, 1, 5));
    var rockGeo = this.track(new THREE.IcosahedronGeometry(1, 0));

    function tree(o) {
      var node = new THREE.Group();
      var height = o.r * 2.6 + 40;
      var trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.scale.set(o.r * 0.9, height, o.r * 0.9);
      trunk.position.y = height * 0.5;
      node.add(trunk);
      var canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.scale.setScalar(o.r * 1.15);
      canopy.position.y = height + o.r * 0.45;
      node.add(canopy);
      return node;
    }

    function root(o) {
      var node = new THREE.Group();
      var mound = new THREE.Mesh(rockGeo, rockMat);
      mound.scale.set(o.r, o.r * 0.75, o.r);
      mound.position.y = o.r * 0.35;
      node.add(mound);
      var arch = new THREE.Mesh(trunkGeo, trunkMat);
      arch.scale.set(o.r * 0.5, o.r * 1.8, o.r * 0.5);
      arch.position.y = o.r * 0.9;
      arch.rotation.z = 0.35;
      node.add(arch);
      return node;
    }

    function crystal(o) {
      var node = new THREE.Group();
      var count = 3;
      for (var i = 0; i < count; i++) {
        var shard = new THREE.Mesh(spikeGeo, crystalMat);
        var height = o.r * (2 + hash2(Math.round(o.x) + i, Math.round(o.y), 3) * 1.6);
        shard.scale.set(o.r * (0.5 + i * 0.12), height, o.r * (0.5 + i * 0.12));
        shard.position.set(
          (hash2(i, Math.round(o.x), 11) - 0.5) * o.r,
          height * 0.5,
          (hash2(i, Math.round(o.y), 13) - 0.5) * o.r
        );
        shard.rotation.z = (hash2(i, 5, 19) - 0.5) * 0.4;
        node.add(shard);
      }
      return node;
    }

    function coast(o) {
      var node = new THREE.Group();
      var rock = new THREE.Mesh(rockGeo, rockMat);
      rock.scale.set(o.r, o.r * 0.85, o.r * 0.92);
      rock.position.y = o.r * 0.42;
      node.add(rock);
      return node;
    }

    var makers = { tree: tree, root: root, crystal: crystal, coast: coast };
    return { make: makers[style] || tree, self: self };
  }

  /*
   * circleHitsObstacle blocks the player 22 units inside the world rect, so the
   * visible wall sits exactly there — the player never walks into an invisible
   * barrier, and never reaches a visible gap they cannot cross.
   */
  buildBoundary(group, world, palette) {
    var inset = 22;
    var height = metres(9);
    var material = this.track(new THREE.MeshLambertMaterial({
      color: parseCssColor(palette.border, '#426b57').multiplyScalar(0.55),
      side: THREE.DoubleSide
    }));
    var spans = [
      { w: world.w, x: world.w / 2, z: inset, ry: 0 },
      { w: world.w, x: world.w / 2, z: world.h - inset, ry: 0 },
      { w: world.h, x: inset, z: world.h / 2, ry: Math.PI / 2 },
      { w: world.h, x: world.w - inset, z: world.h / 2, ry: Math.PI / 2 }
    ];
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      var geometry = this.track(new THREE.PlaneGeometry(span.w, height));
      var mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(span.x, height * 0.4, span.z);
      mesh.rotation.y = span.ry;
      group.add(mesh);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clearWorld();
    this.renderer.dispose();
  }
}
