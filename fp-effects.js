/*
 * MossFPEffects — additive camera feel.
 *
 * Every value produced here is an *offset* applied to the camera only. The
 * collision body and the interaction ray never see it, so head bob can never
 * change where the player actually is or what they can reach.
 *
 * All effects decay back to exactly zero, and all are disableable.
 */
import { metres } from './fp-scene.js';

const BOB_FREQUENCY = 8.2;          /* steps per second at walking pace */
const BOB_VERTICAL = metres(0.045);
const BOB_LATERAL = metres(0.028);
const SPRINT_FOV_BONUS = 6;
const LANDING_RECOVER = 7.5;

function settings() {
  return (window.MossInput && window.MossInput.settings) || {};
}

/* Respect the game's own reduced-motion switch, not just our local toggles. */
function reducedMotion() {
  /* applySettings() mirrors the game's own reduced-motion setting onto <body>. */
  return !!document.body && document.body.classList.contains('reduced-motion');
}

export class MossFPEffects {
  constructor() {
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landingDip = 0;
    this.landingVelocity = 0;
    this.currentFov = 70;
  }

  impulseLanding(strength) {
    if (!this.effectsEnabled()) return;
    this.landingVelocity -= Math.min(1, Math.max(0, strength)) * metres(0.9);
  }

  effectsEnabled() {
    var config = settings();
    if (reducedMotion()) return false;
    return config.cameraEffects !== false;
  }

  bobEnabled() {
    var config = settings();
    if (reducedMotion()) return false;
    return config.headBob !== false && config.cameraEffects !== false;
  }

  update(dt, state) {
    var target = this.bobEnabled() && state.moving && state.grounded
      ? Math.min(1, state.speed * (state.sprinting ? 1.35 : 1))
      : 0;
    /* Fade in and out rather than snapping, so starting to walk is not a jolt. */
    this.bobAmount += (target - this.bobAmount) * Math.min(1, dt * 8);
    if (this.bobAmount < 0.001) {
      this.bobAmount = 0;
      this.bobPhase = 0;
    } else {
      this.bobPhase += dt * BOB_FREQUENCY * (state.sprinting ? 1.45 : 1);
    }

    /* Critically damped spring back to neutral after a landing. */
    if (this.landingDip !== 0 || this.landingVelocity !== 0) {
      this.landingVelocity += -this.landingDip * LANDING_RECOVER * 6 * dt;
      this.landingVelocity *= Math.max(0, 1 - LANDING_RECOVER * dt);
      this.landingDip += this.landingVelocity * dt;
      if (Math.abs(this.landingDip) < 0.01 && Math.abs(this.landingVelocity) < 0.01) {
        this.landingDip = 0;
        this.landingVelocity = 0;
      }
    }
  }

  verticalOffset() {
    /* Two bobs per stride: the head rises on each foot plant. */
    return Math.sin(this.bobPhase * 2) * BOB_VERTICAL * this.bobAmount + this.landingDip;
  }

  lateralOffset() {
    return Math.sin(this.bobPhase) * BOB_LATERAL * this.bobAmount;
  }

  pitchOffset() {
    return this.landingDip * 0.0016;
  }

  fieldOfView(sprinting) {
    var config = settings();
    var base = typeof config.fov === 'number' ? config.fov : 70;
    var target = base + (sprinting && this.effectsEnabled() ? SPRINT_FOV_BONUS : 0);
    /* Eased so the transition reads as motion, not a snap. */
    this.currentFov += (target - this.currentFov) * 0.12;
    if (Math.abs(this.currentFov - target) < 0.05) this.currentFov = target;
    return this.currentFov;
  }

  reset() {
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landingDip = 0;
    this.landingVelocity = 0;
  }
}
