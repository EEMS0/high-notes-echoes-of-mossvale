/*
 * MossFP — first-person controller and entry point for the 3D view.
 *
 * Owns the camera rig, look input and the movement basis. Horizontal movement
 * and collision stay in game.js: this module only rotates the input vector into
 * camera space and hands it back, so a single collision implementation serves
 * both the 2D and first-person views.
 *
 * Camera convention: yaw 0 looks down world -Z, which is the 2D game's -y
 * ("north"), matching the player's default facing of -PI/2.
 */
import { MossFPScene, metres } from './fp-scene.js';
import { PlayerMotor } from './fp-motor.js';
import { MossFPEffects } from './fp-effects.js';
import { MossFPBillboards } from './fp-billboards.js';
import { MossFPInteraction } from './fp-interaction.js';

const PITCH_LIMIT = Math.PI * 0.48;
const EYE_HEIGHT = metres(1.65);
/* Radians per second at full stick deflection, before the sensitivity setting. */
const STICK_LOOK_RATE = 2.6;
/* Radians per mouse pixel, before the sensitivity setting. */
const MOUSE_LOOK_RATE = 0.0022;

function bridge() {
  var api = window.__HIGH_NOTES__;
  return api && api.firstPerson ? api.firstPerson : null;
}

function inputSettings() {
  return (window.MossInput && window.MossInput.settings) || {};
}

class FirstPersonController {
  constructor() {
    this.canvas = document.getElementById('fpCanvas');
    this.active = false;
    this.ready = false;
    this.yaw = 0;
    this.pitch = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.pointerLocked = false;
    this.builtStage = -1;
    this.moveBasis = { x: 0, y: 0 };
    this.sprinting = false;

    if (!this.canvas) return;
    try {
      this.scene = new MossFPScene(this.canvas);
    } catch (error) {
      /* WebGL unavailable — the 2D view remains the whole game. */
      this.failed = true;
      return;
    }
    this.motor = new PlayerMotor();
    this.effects = new MossFPEffects();
    this.billboards = new MossFPBillboards(this.scene);
    this.interaction = new MossFPInteraction();
    this.ready = true;
    this.bindEvents();
  }

  bindEvents() {
    var self = this;
    window.addEventListener('resize', function () { if (self.active) self.scene.resize(); });

    document.addEventListener('pointerlockchange', function () {
      self.pointerLocked = document.pointerLockElement === self.canvas;
      if (!self.pointerLocked) {
        self.mouseDeltaX = 0;
        self.mouseDeltaY = 0;
        /* Losing the pointer mid-play must not leave the view drifting. */
        var api = bridge();
        if (self.active && api && api.isPlaying()) {
          var controller = window.__HIGH_NOTES__ && window.__HIGH_NOTES__.controller;
          if (controller) controller.togglePause(true);
        }
      }
    });

    document.addEventListener('mousemove', function (event) {
      if (!self.active || !self.pointerLocked) return;
      /* Mouse deltas are displacement, never scaled by dt. */
      self.mouseDeltaX += event.movementX || 0;
      self.mouseDeltaY += event.movementY || 0;
    });

    this.canvas.addEventListener('click', function () {
      var api = bridge();
      if (!self.active || !api || !api.isPlaying()) return;
      if (window.MossInput && window.MossInput.getActiveMethod() === 'gamepad') return;
      self.requestPointerLock();
    });
  }

  requestPointerLock() {
    if (this.pointerLocked || !this.canvas.requestPointerLock) return;
    try {
      var result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (error) {
      /* Denied or unsupported; controller play does not need pointer lock. */
    }
  }

  releasePointerLock() {
    if (!this.pointerLocked) return;
    try {
      if (document.exitPointerLock) document.exitPointerLock();
    } catch (error) { /* ignore */ }
  }

  setActive(active) {
    if (!this.ready || this.active === active) return this.active;
    this.active = !!active;
    document.body.classList.toggle('first-person', this.active);
    if (this.active) {
      this.scene.resize();
      this.syncLevel(true);
      var api = bridge();
      if (api) {
        var player = api.getPlayer();
        this.motor.reset(player.x, player.y);
        this.yaw = -(player.facing + Math.PI / 2);
        this.pitch = 0;
      }
    } else {
      this.releasePointerLock();
      this.interaction.clear();
    }
    if (bridge()) bridge().markDirty();
    return this.active;
  }

  /* Rebuild the 3D world when the stage changes (portals, load, respawn). */
  syncLevel(force) {
    var api = bridge();
    if (!api) return;
    var stage = api.getStage();
    if (!force && stage === this.builtStage) return;
    this.builtStage = stage;
    this.scene.build(api.getLevelData());
    this.billboards.rebuild(api);
  }

  /*
   * Look. Mouse contributes accumulated pixels; the stick contributes a rate
   * multiplied by dt. Keeping the two separate is what makes the feel identical
   * at 30, 60 and 120 fps.
   */
  updateLook(dt) {
    var settings = inputSettings();
    var invert = settings.invertLookY ? -1 : 1;
    var sensX = typeof settings.lookSensitivityX === 'number' ? settings.lookSensitivityX : 1;
    var sensY = typeof settings.lookSensitivityY === 'number' ? settings.lookSensitivityY : 1;
    var mouseScale = typeof settings.mouseSensitivity === 'number' ? settings.mouseSensitivity : 1;

    if (this.mouseDeltaX || this.mouseDeltaY) {
      this.yaw -= this.mouseDeltaX * MOUSE_LOOK_RATE * mouseScale * sensX;
      this.pitch -= this.mouseDeltaY * MOUSE_LOOK_RATE * mouseScale * sensY * invert;
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
    }

    if (window.MossInput) {
      /* lookVector is already deadzoned, curved and sensitivity-scaled. */
      var look = window.MossInput.getVector('look');
      if (look && (look.x || look.y)) {
        this.yaw -= look.x * STICK_LOOK_RATE * dt;
        this.pitch -= look.y * STICK_LOOK_RATE * dt * invert;
      }
    }

    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    /* Keep yaw bounded so long sessions cannot accumulate float error. */
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /*
   * Rotate the 2D input vector into camera space. game.js calls this from
   * updatePlayer, so the existing collision and speed code is untouched.
   * Input: mx = strafe, my = -1 forward (screen convention).
   */
  transformMove(mx, my) {
    var sin = Math.sin(this.yaw);
    var cos = Math.cos(this.yaw);
    /* forward = (-sin, -cos), right = (cos, -sin) in game (x, y). */
    this.moveBasis.x = cos * mx + -sin * -my;
    this.moveBasis.y = -sin * mx + -cos * -my;
    return this.moveBasis;
  }

  /* The direction the body faces, in the 2D game's angle convention. */
  facingAngle() {
    return Math.atan2(-Math.cos(this.yaw), -Math.sin(this.yaw));
  }

  update(dt) {
    if (!this.active || !this.ready) return;
    var api = bridge();
    if (!api) return;
    this.syncLevel(false);

    var playing = api.isPlaying();
    if (!playing) {
      /* Menus and dialogue own the frame; drop look input so nothing drifts. */
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      this.motor.clearRequests();
      this.interaction.clear();
      this.updateCamera(dt, api, false);
      return;
    }

    this.updateLook(dt);

    var player = api.getPlayer();
    player.facing = this.facingAngle();

    var input = window.MossInput;
    this.sprinting = !!(input && input.isHeld('sprint')) && (player.moveX !== 0 || player.moveY !== 0);
    if (input && input.wasPressed('jump')) this.motor.requestJump();

    this.motor.update(dt, player.x, player.y);
    if (this.motor.landedThisFrame) {
      this.effects.impulseLanding(this.motor.landingImpact);
      if (input && this.motor.landingImpact > 0.25) input.vibrate(this.motor.landingImpact * 0.35, 90);
    }

    this.billboards.update(api, this.yaw, dt);
    this.interaction.update(api, this.yaw);
    this.updateCamera(dt, api, true);
  }

  camera() {
    return this.scene.camera;
  }

  updateCamera(dt, api, playing) {
    var player = api.getPlayer();
    var speed = Math.hypot(player.moveX || 0, player.moveY || 0);
    this.effects.update(dt, {
      moving: playing && speed > 0.05 && this.motor.grounded,
      speed: speed,
      sprinting: this.sprinting,
      grounded: this.motor.grounded
    });

    var camera = this.scene.camera;
    var eye = this.motor.height + EYE_HEIGHT + this.effects.verticalOffset();
    camera.position.set(
      player.x + this.effects.lateralOffset() * Math.cos(this.yaw),
      eye,
      player.y - this.effects.lateralOffset() * Math.sin(this.yaw)
    );
    /* Yaw then pitch, in that order, so the camera can never roll. */
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch + this.effects.pitchOffset());

    var targetFov = this.effects.fieldOfView(this.sprinting);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  }

  render() {
    if (!this.active || !this.ready) return;
    this.scene.render();
  }

  clearInput() {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.motor.clearRequests();
    this.sprinting = false;
  }
}

var controller = new FirstPersonController();

window.MossFP = {
  isReady: function () { return !!controller.ready; },
  isActive: function () { return controller.active; },
  setActive: function (active) { return controller.setActive(active); },
  toggle: function () { return controller.setActive(!controller.active); },
  update: function (dt) { controller.update(dt); },
  render: function () { controller.render(); },
  transformMove: function (mx, my) { return controller.transformMove(mx, my); },
  facingAngle: function () { return controller.facingAngle(); },
  clearInput: function () { controller.clearInput(); },
  requestPointerLock: function () { controller.requestPointerLock(); },
  releasePointerLock: function () { controller.releasePointerLock(); },
  isPointerLocked: function () { return controller.pointerLocked; },
  resize: function () { if (controller.ready) controller.scene.resize(); },
  rebuild: function () { if (controller.ready) controller.syncLevel(true); },
  getInteractionTarget: function () { return controller.interaction.target; },
  /* Exposed for verification and the debug overlay. */
  debugState: function () {
    return {
      active: controller.active,
      yaw: controller.yaw,
      pitch: controller.pitch,
      height: controller.motor ? controller.motor.height : 0,
      velocityY: controller.motor ? controller.motor.velocityY : 0,
      grounded: controller.motor ? controller.motor.grounded : false,
      pointerLocked: controller.pointerLocked,
      stage: controller.builtStage,
      target: controller.interaction ? controller.interaction.describe() : null
    };
  }
};

/*
 * ES modules are deferred, so game.js has already run boot() and applied its
 * saved settings by the time this file executes. Announce readiness so the saved
 * camera choice can be applied now that there is something to apply it to.
 */
window.dispatchEvent(new CustomEvent('moss-fp-ready', {
  detail: { ready: !!controller.ready }
}));
