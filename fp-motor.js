/*
 * MossFPMotor — the vertical axis.
 *
 * The 2D game has no height at all: horizontal movement and collision are
 * already solved by game.js (moveWithCollision / circleHitsObstacle) and are
 * reused untouched. This module owns only what the source game lacks — gravity,
 * jumping, ground contact and landing — expressed in game units.
 *
 * The pure functions at the top are exported so they can be asserted directly
 * without a renderer or a running game loop.
 */
import { groundHeightAt, metres } from './fp-scene.js';

export const MOTOR_DEFAULTS = {
  gravity: metres(25),           /* ~2.5x real gravity; standard for readable jumps */
  jumpVelocity: metres(7.4),     /* apex ~1.1 m, ~0.3 s rise */
  maxFallSpeed: metres(38),
  coyoteTime: 0.12,
  jumpBufferTime: 0.12,
  groundTolerance: 1.5,          /* game units of slack before we call it airborne */
  stepHeight: metres(0.45),
  slopeLimit: Math.PI / 4        /* 45 degrees */
};

/* Frame-rate independent: velocity integrates over dt, never per frame. */
export function applyGravity(velocityY, dt, gravity, maxFallSpeed) {
  var next = velocityY - gravity * dt;
  if (next < -maxFallSpeed) return -maxFallSpeed;
  return next;
}

export function isGrounded(height, groundY, tolerance) {
  return height <= groundY + (tolerance || 0);
}

/*
 * Coyote time lets a player jump for a moment after walking off an edge; the
 * jump buffer lets a press land slightly before touching down. Both are small
 * and additive, so neither turns into a double jump.
 */
export function canJump(state, options) {
  if (state.jumpBuffer <= 0) return false;
  return state.grounded || state.coyote > 0;
}

/* Surface normals distinguish a walkable floor from a wall you must not climb. */
export function slopeAngleFromNormal(nx, ny, nz) {
  var length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return Math.acos(Math.min(1, Math.max(-1, ny / length)));
}

export function isWalkableSlope(nx, ny, nz, slopeLimit) {
  return slopeAngleFromNormal(nx, ny, nz) <= slopeLimit;
}

/* Finite-difference normal of the procedural terrain at a point. */
export function groundNormalAt(x, z, sample) {
  var s = sample || 6;
  var hL = groundHeightAt(x - s, z);
  var hR = groundHeightAt(x + s, z);
  var hD = groundHeightAt(x, z - s);
  var hU = groundHeightAt(x, z + s);
  var nx = hL - hR;
  var nz = hD - hU;
  var ny = 2 * s;
  var length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

export class PlayerMotor {
  constructor(options) {
    this.config = Object.assign({}, MOTOR_DEFAULTS, options || {});
    this.height = 0;
    this.velocityY = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.wasGrounded = true;
    this.landedThisFrame = false;
    this.landingImpact = 0;
    this.fallStartHeight = 0;
    this.groundNormal = { x: 0, y: 1, z: 0 };
  }

  /* Place the body on the ground without generating a spurious landing event. */
  reset(x, z) {
    this.height = groundHeightAt(x, z);
    this.velocityY = 0;
    this.grounded = true;
    this.wasGrounded = true;
    this.coyote = this.config.coyoteTime;
    this.jumpBuffer = 0;
    this.landedThisFrame = false;
    this.landingImpact = 0;
    this.fallStartHeight = this.height;
  }

  requestJump() {
    this.jumpBuffer = this.config.jumpBufferTime;
  }

  clearRequests() {
    this.jumpBuffer = 0;
  }

  update(dt, x, z) {
    var config = this.config;
    var groundY = groundHeightAt(x, z);
    this.landedThisFrame = false;

    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.coyote > 0) this.coyote -= dt;

    /* Jump is consumed before gravity so the first frame carries full velocity. */
    if (canJump(this, config)) {
      this.velocityY = config.jumpVelocity;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.fallStartHeight = this.height;
    }

    this.velocityY = applyGravity(this.velocityY, dt, config.gravity, config.maxFallSpeed);
    this.height += this.velocityY * dt;

    if (this.height <= groundY) {
      this.height = groundY;
      if (!this.grounded) {
        this.landedThisFrame = true;
        /* Impact is normalised 0..1 for camera/haptic feedback. */
        this.landingImpact = Math.min(1, Math.abs(this.velocityY) / config.maxFallSpeed * 2.4);
      }
      this.velocityY = 0;
      this.grounded = true;
      this.coyote = config.coyoteTime;
      this.fallStartHeight = groundY;
    } else if (this.height > groundY + config.groundTolerance) {
      if (this.grounded) this.fallStartHeight = this.height;
      this.grounded = false;
    }

    /*
     * Walking uphill: terrain rises under a grounded body, so snap up to it
     * rather than letting the body float and then fall. Limited by stepHeight so
     * this can never be used to climb something it should not.
     */
    if (this.grounded && groundY > this.height && groundY - this.height <= config.stepHeight) {
      this.height = groundY;
    }

    this.groundNormal = groundNormalAt(x, z);
    this.wasGrounded = this.grounded;
    return this.grounded;
  }
}
