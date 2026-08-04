/*
 * MossInput — unified input layer for HIGH NOTES V2.
 *
 * Translates keyboard, pointer/touch and Gamepad API (Xbox / XInput) input into
 * one abstract action vocabulary so gameplay code never reads raw button
 * indices. Loaded before game.js; everything is exposed on window.MossInput.
 *
 * Design notes:
 *  - Polling happens once per frame from the existing game loop. Gamepad
 *    snapshots are re-read every poll because Chromium hands back frozen
 *    objects rather than live ones.
 *  - No per-frame allocation: button/axis buffers and vectors are reused.
 *  - Every browser API touch is feature-detected and wrapped, because the Xbox
 *    Edge build exposes a narrower surface than desktop Edge.
 */
(function () {
  'use strict';

  var STANDARD_BUTTONS = {
    a: 0, b: 1, x: 2, y: 3,
    leftBumper: 4, rightBumper: 5,
    leftTrigger: 6, rightTrigger: 7,
    view: 8, menu: 9,
    leftStick: 10, rightStick: 11,
    dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
    home: 16
  };
  var BUTTON_SLOTS = 20;
  var AXIS_SLOTS = 8;

  /*
   * Central binding table. Raw indices live here and nowhere else so remapping
   * can be layered on later without touching gameplay code.
   */
  var padBindings = {
    confirm: [STANDARD_BUTTONS.a],
    cancel: [STANDARD_BUTTONS.b],
    attack: [STANDARD_BUTTONS.a, STANDARD_BUTTONS.rightTrigger],
    dodge: [STANDARD_BUTTONS.b],
    pulse: [STANDARD_BUTTONS.x],
    interact: [STANDARD_BUTTONS.y],
    block: [STANDARD_BUTTONS.leftBumper],
    odin: [STANDARD_BUTTONS.rightBumper],
    heal: [STANDARD_BUTTONS.leftTrigger],
    map: [STANDARD_BUTTONS.view],
    pause: [STANDARD_BUTTONS.menu],
    inventory: [STANDARD_BUTTONS.leftStick],
    instruments: [STANDARD_BUTTONS.rightStick],
    recentre: [STANDARD_BUTTONS.rightStick],
    tabPrev: [STANDARD_BUTTONS.leftBumper],
    tabNext: [STANDARD_BUTTONS.rightBumper],
    menuUp: [STANDARD_BUTTONS.dpadUp],
    menuDown: [STANDARD_BUTTONS.dpadDown],
    menuLeft: [STANDARD_BUTTONS.dpadLeft],
    menuRight: [STANDARD_BUTTONS.dpadRight],
    /*
     * First-person additions; the 2D view simply never queries these. A is jump
     * in first person, so attackAlt moves the swing onto the right trigger and
     * the two actions can never fire from one press.
     */
    jump: [STANDARD_BUTTONS.a],
    sprint: [STANDARD_BUTTONS.leftStick],
    attackAlt: [STANDARD_BUTTONS.rightTrigger],
    moveUp: [STANDARD_BUTTONS.dpadUp],
    moveDown: [STANDARD_BUTTONS.dpadDown],
    moveLeft: [STANDARD_BUTTONS.dpadLeft],
    moveRight: [STANDARD_BUTTONS.dpadRight]
  };

  /* Keyboard side of the same vocabulary. Mirrors the pre-existing key set. */
  var keyBindings = {
    moveUp: ['w', 'arrowup'],
    moveDown: ['s', 'arrowdown'],
    moveLeft: ['a', 'arrowleft'],
    moveRight: ['d', 'arrowright'],
    attack: ['space', 'j'],
    dodge: ['shift', 'k'],
    pulse: ['q', 'l'],
    block: ['f'],
    heal: ['h'],
    odin: ['r'],
    interact: ['e', 'enter'],
    map: ['tab'],
    inventory: ['i', 'b'],
    instruments: ['v'],
    home: ['o'],
    pause: ['escape'],
    confirm: ['enter', 'e', 'space'],
    cancel: ['escape'],
    jump: [' ', 'space'],
    sprint: ['shift'],
    menuUp: ['w', 'arrowup'],
    menuDown: ['s', 'arrowdown'],
    menuLeft: ['a', 'arrowleft'],
    menuRight: ['d', 'arrowright']
  };

  var LABELS = {
    xbox: {
      confirm: 'A', cancel: 'B', attack: 'A', dodge: 'B', pulse: 'X', interact: 'Y',
      block: 'LB', odin: 'RB', heal: 'LT', map: 'View', pause: 'Menu',
      inventory: 'L3', instruments: 'R3', tabPrev: 'LB', tabNext: 'RB',
      moveUp: 'D-pad', moveDown: 'D-pad', moveLeft: 'D-pad', moveRight: 'D-pad',
      menuUp: 'D-pad', menuDown: 'D-pad', menuLeft: 'D-pad', menuRight: 'D-pad',
      home: 'Menu'
    },
    keyboard: {
      confirm: 'E', cancel: 'Esc', attack: 'Space', dodge: 'Shift', pulse: 'Q', interact: 'E',
      block: 'F', odin: 'R', heal: 'H', map: 'Tab', pause: 'Esc',
      inventory: 'I', instruments: 'V', tabPrev: 'Q', tabNext: 'E',
      moveUp: 'W', moveDown: 'S', moveLeft: 'A', moveRight: 'D',
      menuUp: 'W', menuDown: 'S', menuLeft: 'A', menuRight: 'D',
      home: 'O'
    }
  };

  var SETTINGS_KEY = 'highNotesControllerV1';
  var settingDefaults = {
    controllerEnabled: true,
    moveDeadzone: 0.18,
    lookDeadzone: 0.20,
    lookSensitivityX: 1,
    lookSensitivityY: 1,
    invertLookY: false,
    vibration: true,
    promptStyle: 'auto',
    triggerThreshold: 0.5,
    outerDeadzone: 0.95,
    responseCurve: 1.35,
    cameraPeek: true,
    swapConfirmCancel: false,
    southpaw: false,
    /* First-person view settings, persisted through the same validated store. */
    viewMode: 'topDown',
    fov: 70,
    mouseSensitivity: 1,
    headBob: true,
    cameraEffects: true,
    reticle: true
  };

  var settings = readSettings();

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function readSettings() {
    var merged = {};
    for (var key in settingDefaults) {
      if (Object.prototype.hasOwnProperty.call(settingDefaults, key)) merged[key] = settingDefaults[key];
    }
    var raw = null;
    try {
      raw = window.localStorage ? window.localStorage.getItem(SETTINGS_KEY) : null;
    } catch (error) {
      raw = null;
    }
    if (!raw) return merged;
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') return merged;
    return validateSettings(parsed, merged);
  }

  function has(source, key) {
    return !!source && Object.prototype.hasOwnProperty.call(source, key);
  }

  /*
   * Defensive merge: a corrupt or hand-edited payload must never be able to
   * produce a NaN deadzone that silently disables the sticks.
   *
   * Absent keys keep the target's current value rather than snapping back to a
   * default, so this doubles as a safe partial-patch applier for the settings
   * panel (changing one row must not reset every other row).
   */
  function validateSettings(source, target) {
    target.controllerEnabled = has(source, 'controllerEnabled') ? source.controllerEnabled !== false : target.controllerEnabled;
    target.vibration = has(source, 'vibration') ? source.vibration !== false : target.vibration;
    target.cameraPeek = has(source, 'cameraPeek') ? source.cameraPeek !== false : target.cameraPeek;
    target.invertLookY = has(source, 'invertLookY') ? source.invertLookY === true : target.invertLookY;
    target.swapConfirmCancel = has(source, 'swapConfirmCancel') ? source.swapConfirmCancel === true : target.swapConfirmCancel;
    target.southpaw = has(source, 'southpaw') ? source.southpaw === true : target.southpaw;
    target.moveDeadzone = has(source, 'moveDeadzone') ? numberOr(source.moveDeadzone, target.moveDeadzone, 0.02, 0.6) : target.moveDeadzone;
    target.lookDeadzone = has(source, 'lookDeadzone') ? numberOr(source.lookDeadzone, target.lookDeadzone, 0.02, 0.6) : target.lookDeadzone;
    target.outerDeadzone = has(source, 'outerDeadzone') ? numberOr(source.outerDeadzone, target.outerDeadzone, 0.6, 1) : target.outerDeadzone;
    target.lookSensitivityX = has(source, 'lookSensitivityX') ? numberOr(source.lookSensitivityX, target.lookSensitivityX, 0.2, 3) : target.lookSensitivityX;
    target.lookSensitivityY = has(source, 'lookSensitivityY') ? numberOr(source.lookSensitivityY, target.lookSensitivityY, 0.2, 3) : target.lookSensitivityY;
    target.triggerThreshold = has(source, 'triggerThreshold') ? numberOr(source.triggerThreshold, target.triggerThreshold, 0.05, 0.95) : target.triggerThreshold;
    target.responseCurve = has(source, 'responseCurve') ? numberOr(source.responseCurve, target.responseCurve, 1, 3) : target.responseCurve;
    target.headBob = has(source, 'headBob') ? source.headBob !== false : target.headBob;
    target.cameraEffects = has(source, 'cameraEffects') ? source.cameraEffects !== false : target.cameraEffects;
    target.reticle = has(source, 'reticle') ? source.reticle !== false : target.reticle;
    target.fov = has(source, 'fov') ? numberOr(source.fov, target.fov, 55, 100) : target.fov;
    target.mouseSensitivity = has(source, 'mouseSensitivity')
      ? numberOr(source.mouseSensitivity, target.mouseSensitivity, 0.2, 3) : target.mouseSensitivity;
    if (has(source, 'promptStyle')) {
      target.promptStyle = ['auto', 'xbox', 'keyboard'].indexOf(source.promptStyle) >= 0 ? source.promptStyle : target.promptStyle;
    }
    if (has(source, 'viewMode')) {
      target.viewMode = ['topDown', 'firstPerson'].indexOf(source.viewMode) >= 0 ? source.viewMode : target.viewMode;
    }
    if (target.outerDeadzone <= target.moveDeadzone) target.outerDeadzone = settingDefaults.outerDeadzone;
    return target;
  }

  function numberOr(value, fallback, min, max) {
    var parsed = Number(value);
    if (!isFinite(parsed)) return fallback;
    return clamp(parsed, min, max);
  }

  function saveSettings() {
    try {
      if (window.localStorage) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      /* Storage is optional; controller support must survive private mode. */
    }
  }

  /* ---------------------------------------------------------------------- */
  /* State                                                                    */
  /* ---------------------------------------------------------------------- */

  var keysDown = new Set();
  var padIndex = -1;
  var padId = '';
  var padMapping = '';
  var padConnected = false;

  var buttonNow = new Uint8Array(BUTTON_SLOTS);
  var buttonPrev = new Uint8Array(BUTTON_SLOTS);
  var buttonValue = new Float32Array(BUTTON_SLOTS);
  var axisRaw = new Float32Array(AXIS_SLOTS);
  /*
   * Buttons still physically held when state is force-cleared (menu opened,
   * window blurred, pad swapped) are masked until they are genuinely released.
   * Without this, the A press that opens a menu is seen again on the next frame
   * as a brand-new press and immediately activates whatever gained focus.
   */
  var buttonSuppress = new Uint8Array(BUTTON_SLOTS);

  var moveVector = { x: 0, y: 0, magnitude: 0 };
  var lookVector = { x: 0, y: 0, magnitude: 0 };
  var padMoveVector = { x: 0, y: 0, magnitude: 0 };
  var touchVector = { x: 0, y: 0, magnitude: 0 };
  var scratchVector = { x: 0, y: 0, magnitude: 0 };

  var actionHeld = {};
  var actionPrev = {};
  var actionNames = [];
  (function collectActionNames() {
    var seen = {};
    var name;
    for (name in padBindings) {
      if (Object.prototype.hasOwnProperty.call(padBindings, name)) seen[name] = true;
    }
    for (name in keyBindings) {
      if (Object.prototype.hasOwnProperty.call(keyBindings, name)) seen[name] = true;
    }
    for (name in seen) {
      if (Object.prototype.hasOwnProperty.call(seen, name)) {
        actionNames.push(name);
        actionHeld[name] = false;
        actionPrev[name] = false;
      }
    }
  })();

  var activeMethod = 'keyboard';
  var methodListeners = [];
  var connectionListeners = [];

  /* Debounce so stick drift or a nudged mouse cannot flicker the prompt style. */
  var METHOD_SWITCH_COOLDOWN = 0.35;
  var methodCooldown = 0;

  var menuRepeat = { x: 0, y: 0, timerX: 0, timerY: 0 };
  var MENU_REPEAT_DELAY = 0.42;
  var MENU_REPEAT_INTERVAL = 0.13;

  var debugEnabled = false;

  /* ---------------------------------------------------------------------- */
  /* Analogue processing                                                      */
  /* ---------------------------------------------------------------------- */

  /*
   * Circular (radial) deadzone: both axes are considered together so the stick
   * never collapses into eight-way digital movement, and a full diagonal is
   * exactly as fast as a full cardinal push.
   */
  function applyRadialDeadzone(x, y, inner, outer, curve, out) {
    var magnitude = Math.sqrt(x * x + y * y);
    if (!isFinite(magnitude) || magnitude <= inner) {
      out.x = 0;
      out.y = 0;
      out.magnitude = 0;
      return out;
    }
    var span = outer - inner;
    if (span <= 0.0001) span = 0.0001;
    var scaled = clamp((magnitude - inner) / span, 0, 1);
    if (curve && curve !== 1) scaled = Math.pow(scaled, curve);
    var inverse = 1 / magnitude;
    out.x = x * inverse * scaled;
    out.y = y * inverse * scaled;
    out.magnitude = scaled;
    return out;
  }

  function axis(index) {
    var value = axisRaw[index];
    return isFinite(value) ? value : 0;
  }

  /* ---------------------------------------------------------------------- */
  /* Gamepad discovery                                                        */
  /* ---------------------------------------------------------------------- */

  function readPads() {
    if (!navigator.getGamepads) return null;
    try {
      return navigator.getGamepads();
    } catch (error) {
      return null;
    }
  }

  function padActivity(pad) {
    var i;
    for (i = 0; i < pad.buttons.length; i++) {
      var button = pad.buttons[i];
      if (button && (button.pressed || (button.value || 0) > 0.6)) return true;
    }
    /* A generous threshold here keeps a drifting stick from stealing focus. */
    for (i = 0; i < pad.axes.length && i < AXIS_SLOTS; i++) {
      if (Math.abs(pad.axes[i] || 0) > 0.55) return true;
    }
    return false;
  }

  /*
   * Pick the controller the player is actually holding. Standard-mapping pads
   * win over exotic ones, an already-selected pad keeps its slot until another
   * pad shows real activity, and index 0 is never assumed.
   */
  function selectPad(pads) {
    var current = padIndex >= 0 && pads[padIndex] && pads[padIndex].connected ? pads[padIndex] : null;
    var challenger = null;
    var challengerStandard = false;
    for (var i = 0; i < pads.length; i++) {
      var pad = pads[i];
      if (!pad || !pad.connected) continue;
      if (current && pad.index === current.index) continue;
      if (!padActivity(pad)) continue;
      var isStandard = pad.mapping === 'standard';
      if (!challenger || (isStandard && !challengerStandard)) {
        challenger = pad;
        challengerStandard = isStandard;
      }
    }
    if (current) {
      /* Only hand over when the newcomer is actively being used. */
      if (challenger && !padActivity(current)) return challenger;
      return current;
    }
    if (challenger) return challenger;
    var fallback = null;
    for (var j = 0; j < pads.length; j++) {
      var candidate = pads[j];
      if (!candidate || !candidate.connected) continue;
      if (!fallback || (candidate.mapping === 'standard' && fallback.mapping !== 'standard')) fallback = candidate;
    }
    return fallback;
  }

  function adoptPad(pad) {
    var changed = !padConnected || padIndex !== pad.index;
    padIndex = pad.index;
    padId = pad.id || 'Controller';
    padMapping = pad.mapping || 'unknown';
    padConnected = true;
    if (changed) notifyConnection(true);
  }

  function dropPad() {
    if (!padConnected) return;
    padConnected = false;
    padIndex = -1;
    buttonNow.fill(0);
    buttonPrev.fill(0);
    buttonValue.fill(0);
    /* A button held across a disconnect must not fire on reconnect. */
    buttonSuppress.fill(1);
    axisRaw.fill(0);
    padMoveVector.x = 0; padMoveVector.y = 0; padMoveVector.magnitude = 0;
    lookVector.x = 0; lookVector.y = 0; lookVector.magnitude = 0;
    menuRepeat.x = 0; menuRepeat.y = 0; menuRepeat.timerX = 0; menuRepeat.timerY = 0;
    notifyConnection(false);
    if (activeMethod === 'gamepad') setActiveMethod('keyboard', true);
  }

  function notifyConnection(connected) {
    for (var i = 0; i < connectionListeners.length; i++) {
      try {
        connectionListeners[i](connected, connected ? padId : '', padIndex);
      } catch (error) {
        /* A misbehaving listener must not stall input polling. */
      }
    }
  }

  function setActiveMethod(method, force) {
    if (activeMethod === method) return;
    if (!force && methodCooldown > 0) return;
    activeMethod = method;
    methodCooldown = METHOD_SWITCH_COOLDOWN;
    if (document.body) {
      document.body.classList.toggle('input-gamepad', method === 'gamepad');
      document.body.classList.toggle('input-keyboard', method === 'keyboard');
      document.body.classList.toggle('input-touch', method === 'touch');
      document.body.setAttribute('data-input-method', method);
    }
    for (var i = 0; i < methodListeners.length; i++) {
      try {
        methodListeners[i](method);
      } catch (error) {
        /* Ignore listener faults so prompt updates cannot break gameplay. */
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Per-frame poll                                                           */
  /* ---------------------------------------------------------------------- */

  function pollGamepad(dt) {
    if (!settings.controllerEnabled) {
      if (padConnected) dropPad();
      return;
    }
    var pads = readPads();
    if (!pads) {
      if (padConnected) dropPad();
      return;
    }
    var pad = selectPad(pads);
    if (!pad) {
      if (padConnected) dropPad();
      return;
    }
    adoptPad(pad);

    var i;
    for (i = 0; i < BUTTON_SLOTS; i++) {
      buttonPrev[i] = buttonNow[i];
      var button = pad.buttons[i];
      if (!button) {
        buttonNow[i] = 0;
        buttonValue[i] = 0;
        continue;
      }
      var value = typeof button.value === 'number' && isFinite(button.value) ? button.value : (button.pressed ? 1 : 0);
      buttonValue[i] = value;
      /*
       * Triggers report analogue values; some browsers leave `pressed` false
       * until fully depressed, so honour the configurable threshold too.
       */
      var isTrigger = i === STANDARD_BUTTONS.leftTrigger || i === STANDARD_BUTTONS.rightTrigger;
      buttonNow[i] = (button.pressed || (isTrigger && value >= settings.triggerThreshold)) ? 1 : 0;
      if (buttonSuppress[i]) {
        if (buttonNow[i]) buttonNow[i] = 0;
        else buttonSuppress[i] = 0;
      }
    }
    for (i = 0; i < AXIS_SLOTS; i++) {
      var raw = pad.axes[i];
      axisRaw[i] = typeof raw === 'number' && isFinite(raw) ? raw : 0;
    }

    var moveAxisX = settings.southpaw ? 2 : 0;
    var moveAxisY = settings.southpaw ? 3 : 1;
    var lookAxisX = settings.southpaw ? 0 : 2;
    var lookAxisY = settings.southpaw ? 1 : 3;

    applyRadialDeadzone(axis(moveAxisX), axis(moveAxisY),
      settings.moveDeadzone, settings.outerDeadzone, settings.responseCurve, padMoveVector);

    /* D-pad is a full-speed digital fallback when the stick is at rest. */
    if (padMoveVector.magnitude === 0) {
      var dx = (buttonNow[STANDARD_BUTTONS.dpadRight] ? 1 : 0) - (buttonNow[STANDARD_BUTTONS.dpadLeft] ? 1 : 0);
      var dy = (buttonNow[STANDARD_BUTTONS.dpadDown] ? 1 : 0) - (buttonNow[STANDARD_BUTTONS.dpadUp] ? 1 : 0);
      if (dx || dy) {
        var length = Math.sqrt(dx * dx + dy * dy);
        padMoveVector.x = dx / length;
        padMoveVector.y = dy / length;
        padMoveVector.magnitude = 1;
      }
    }

    applyRadialDeadzone(axis(lookAxisX), axis(lookAxisY),
      settings.lookDeadzone, settings.outerDeadzone, settings.responseCurve, lookVector);
    lookVector.x *= settings.lookSensitivityX;
    lookVector.y *= settings.lookSensitivityY * (settings.invertLookY ? -1 : 1);

    if (padMoveVector.magnitude > 0.35 || lookVector.magnitude > 0.35 || anyButtonDown()) {
      setActiveMethod('gamepad');
    }
    updateMenuRepeat(dt);
  }

  function anyButtonDown() {
    for (var i = 0; i < BUTTON_SLOTS; i++) {
      if (i === STANDARD_BUTTONS.home) continue;
      if (buttonNow[i]) return true;
    }
    return false;
  }

  /* Any fresh button edge this frame, used as an audio-resume trigger. */
  function anyButtonPressed() {
    for (var i = 0; i < BUTTON_SLOTS; i++) {
      if (i === STANDARD_BUTTONS.home) continue;
      if (buttonNow[i] && !buttonPrev[i]) return true;
    }
    return false;
  }

  /*
   * Menu stepping: first press moves immediately, then pauses, then repeats at
   * a steady interval so a held direction never skips several rows at once.
   */
  function updateMenuRepeat(dt) {
    menuRepeat.x = stepAxisRepeat(directionX(), 'timerX', dt);
    menuRepeat.y = stepAxisRepeat(directionY(), 'timerY', dt);
  }

  function directionX() {
    if (buttonNow[STANDARD_BUTTONS.dpadLeft]) return -1;
    if (buttonNow[STANDARD_BUTTONS.dpadRight]) return 1;
    var value = padMoveVector.x;
    if (value <= -0.5) return -1;
    if (value >= 0.5) return 1;
    return 0;
  }

  function directionY() {
    if (buttonNow[STANDARD_BUTTONS.dpadUp]) return -1;
    if (buttonNow[STANDARD_BUTTONS.dpadDown]) return 1;
    var value = padMoveVector.y;
    if (value <= -0.5) return -1;
    if (value >= 0.5) return 1;
    return 0;
  }

  function stepAxisRepeat(direction, timerKey, dt) {
    if (!direction) {
      menuRepeat[timerKey] = 0;
      return 0;
    }
    if (menuRepeat[timerKey] <= 0) {
      menuRepeat[timerKey] = MENU_REPEAT_DELAY;
      return direction;
    }
    menuRepeat[timerKey] -= dt;
    if (menuRepeat[timerKey] <= 0) {
      menuRepeat[timerKey] = MENU_REPEAT_INTERVAL;
      return direction;
    }
    return 0;
  }

  function refreshActions() {
    for (var i = 0; i < actionNames.length; i++) {
      var name = actionNames[i];
      actionPrev[name] = actionHeld[name];
      actionHeld[name] = computeActionHeld(name);
    }
  }

  function computeActionHeld(name) {
    var keys = keyBindings[name];
    var j;
    if (keys) {
      for (j = 0; j < keys.length; j++) {
        if (keysDown.has(keys[j])) return true;
      }
    }
    if (!padConnected || !settings.controllerEnabled) return false;
    var resolved = resolvePadAction(name);
    var buttons = padBindings[resolved];
    if (!buttons) return false;
    for (j = 0; j < buttons.length; j++) {
      if (buttonNow[buttons[j]]) return true;
    }
    return false;
  }

  /* Optional accessibility swap, applied at lookup time so bindings stay pure. */
  function resolvePadAction(name) {
    if (!settings.swapConfirmCancel) return name;
    if (name === 'confirm') return 'cancel';
    if (name === 'cancel') return 'confirm';
    return name;
  }

  function update(dt) {
    var delta = typeof dt === 'number' && isFinite(dt) ? clamp(dt, 0, 0.25) : 0.016;
    if (methodCooldown > 0) methodCooldown -= delta;
    pollGamepad(delta);
    refreshActions();
    composeMoveVector();
    if (debugEnabled) renderDebug();
  }

  /* Touch joystick wins, then the stick, then digital keys. */
  function composeMoveVector() {
    if (touchVector.magnitude > 0) {
      moveVector.x = touchVector.x * touchVector.magnitude;
      moveVector.y = touchVector.y * touchVector.magnitude;
      moveVector.magnitude = touchVector.magnitude;
      return;
    }
    if (padMoveVector.magnitude > 0) {
      moveVector.x = padMoveVector.x;
      moveVector.y = padMoveVector.y;
      moveVector.magnitude = padMoveVector.magnitude;
      return;
    }
    var kx = (isHeld('moveRight') ? 1 : 0) - (isHeld('moveLeft') ? 1 : 0);
    var ky = (isHeld('moveDown') ? 1 : 0) - (isHeld('moveUp') ? 1 : 0);
    if (!kx && !ky) {
      moveVector.x = 0;
      moveVector.y = 0;
      moveVector.magnitude = 0;
      return;
    }
    var length = Math.sqrt(kx * kx + ky * ky);
    moveVector.x = kx / length;
    moveVector.y = ky / length;
    moveVector.magnitude = 1;
  }

  /* ---------------------------------------------------------------------- */
  /* Public queries                                                           */
  /* ---------------------------------------------------------------------- */

  function isHeld(name) {
    return actionHeld[name] === true;
  }

  function wasPressed(name) {
    return actionHeld[name] === true && actionPrev[name] !== true;
  }

  function wasReleased(name) {
    return actionHeld[name] !== true && actionPrev[name] === true;
  }

  function padPressed(name) {
    if (!padConnected || !settings.controllerEnabled) return false;
    var buttons = padBindings[resolvePadAction(name)];
    if (!buttons) return false;
    for (var i = 0; i < buttons.length; i++) {
      if (buttonNow[buttons[i]] && !buttonPrev[buttons[i]]) return true;
    }
    return false;
  }

  function padHeld(name) {
    if (!padConnected || !settings.controllerEnabled) return false;
    var buttons = padBindings[resolvePadAction(name)];
    if (!buttons) return false;
    for (var i = 0; i < buttons.length; i++) {
      if (buttonNow[buttons[i]]) return true;
    }
    return false;
  }

  function padReleased(name) {
    if (!padConnected || !settings.controllerEnabled) return false;
    var buttons = padBindings[resolvePadAction(name)];
    if (!buttons) return false;
    var anyNow = false;
    var anyPrev = false;
    for (var i = 0; i < buttons.length; i++) {
      if (buttonNow[buttons[i]]) anyNow = true;
      if (buttonPrev[buttons[i]]) anyPrev = true;
    }
    return anyPrev && !anyNow;
  }

  function getAxis(name) {
    switch (name) {
      case 'moveX': return moveVector.x;
      case 'moveY': return moveVector.y;
      case 'lookX': return lookVector.x;
      case 'lookY': return lookVector.y;
      default: return 0;
    }
  }

  function getVector(name) {
    if (name === 'look') return lookVector;
    return moveVector;
  }

  function getTrigger(side) {
    var index = side === 'right' ? STANDARD_BUTTONS.rightTrigger : STANDARD_BUTTONS.leftTrigger;
    return padConnected ? buttonValue[index] : 0;
  }

  function menuStep() {
    scratchVector.x = menuRepeat.x;
    scratchVector.y = menuRepeat.y;
    scratchVector.magnitude = Math.abs(menuRepeat.x) + Math.abs(menuRepeat.y);
    return scratchVector;
  }

  function label(action) {
    var style = promptStyle();
    var table = LABELS[style] || LABELS.keyboard;
    return table[action] || (LABELS.keyboard[action] || '');
  }

  function promptStyle() {
    if (settings.promptStyle === 'xbox') return 'xbox';
    if (settings.promptStyle === 'keyboard') return 'keyboard';
    return activeMethod === 'gamepad' ? 'xbox' : 'keyboard';
  }

  /* ---------------------------------------------------------------------- */
  /* Vibration                                                                */
  /* ---------------------------------------------------------------------- */

  function vibrate(strength, duration) {
    if (!settings.vibration || !settings.controllerEnabled || !padConnected) return false;
    var pads = readPads();
    if (!pads) return false;
    var pad = pads[padIndex];
    var actuator = pad && pad.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return false;
    var magnitude = clamp(Number(strength) || 0, 0, 1);
    var ms = clamp(Number(duration) || 120, 20, 800);
    try {
      var result = actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: ms,
        weakMagnitude: magnitude,
        strongMagnitude: magnitude * 0.75
      });
      if (result && typeof result.catch === 'function') result.catch(function () { /* unsupported effect type */ });
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Keyboard + pointer bridge                                                */
  /* ---------------------------------------------------------------------- */

  function normaliseKey(event) {
    if (event.code === 'Space') return 'space';
    var key = String(event.key || '').toLowerCase();
    if (key === 'shift') return 'shift';
    return key;
  }

  function handleKeyDown(event) {
    keysDown.add(normaliseKey(event));
    setActiveMethod('keyboard');
  }

  function handleKeyUp(event) {
    keysDown.delete(normaliseKey(event));
  }

  var pointerAccum = 0;
  function handlePointerMove(event) {
    /* Require real travel so a jittering trackpad cannot flip the prompts. */
    var moved = Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);
    pointerAccum += moved || 1;
    if (pointerAccum > 24) {
      pointerAccum = 0;
      setActiveMethod('keyboard');
    }
  }

  function handlePointerDown(event) {
    setActiveMethod(event.pointerType === 'touch' ? 'touch' : 'keyboard');
  }

  function releaseAll() {
    keysDown.clear();
    buttonNow.fill(0);
    buttonPrev.fill(0);
    buttonValue.fill(0);
    buttonSuppress.fill(1);
    padMoveVector.x = 0; padMoveVector.y = 0; padMoveVector.magnitude = 0;
    moveVector.x = 0; moveVector.y = 0; moveVector.magnitude = 0;
    lookVector.x = 0; lookVector.y = 0; lookVector.magnitude = 0;
    touchVector.x = 0; touchVector.y = 0; touchVector.magnitude = 0;
    menuRepeat.x = 0; menuRepeat.y = 0; menuRepeat.timerX = 0; menuRepeat.timerY = 0;
    for (var i = 0; i < actionNames.length; i++) {
      actionHeld[actionNames[i]] = false;
      actionPrev[actionNames[i]] = false;
    }
  }

  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) releaseAll();
  });
  if (window.PointerEvent) {
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
  } else {
    window.addEventListener('mousemove', handlePointerMove, { passive: true });
  }

  window.addEventListener('gamepadconnected', function (event) {
    /*
     * The event is only a hint — the next poll does the real adoption. Xbox Edge
     * has been observed firing this late, or not at all for pads present at
     * load, which is why polling never depends on it.
     */
    if (event && event.gamepad && padIndex < 0) padIndex = event.gamepad.index;
  });
  window.addEventListener('gamepaddisconnected', function (event) {
    if (event && event.gamepad && event.gamepad.index === padIndex) dropPad();
  });

  /* ---------------------------------------------------------------------- */
  /* Debug overlay (developer opt-in only)                                    */
  /* ---------------------------------------------------------------------- */

  var debugNode = null;
  function setDebug(enabled) {
    debugEnabled = !!enabled;
    if (!debugEnabled && debugNode) {
      debugNode.remove();
      debugNode = null;
    }
  }

  function renderDebug() {
    if (!debugNode) {
      debugNode = document.createElement('pre');
      debugNode.className = 'controller-debug';
      document.body.appendChild(debugNode);
    }
    var pressed = [];
    for (var i = 0; i < BUTTON_SLOTS; i++) {
      if (buttonNow[i]) pressed.push(i);
    }
    var active = [];
    for (var j = 0; j < actionNames.length; j++) {
      if (actionHeld[actionNames[j]]) active.push(actionNames[j]);
    }
    debugNode.textContent =
      'pad: ' + (padConnected ? padId : 'none') + '\n' +
      'index: ' + padIndex + '  mapping: ' + padMapping + '\n' +
      'method: ' + activeMethod + '  prompts: ' + promptStyle() + '\n' +
      'LS raw: ' + axis(0).toFixed(2) + ', ' + axis(1).toFixed(2) + '\n' +
      'RS raw: ' + axis(2).toFixed(2) + ', ' + axis(3).toFixed(2) + '\n' +
      'move: ' + moveVector.x.toFixed(2) + ', ' + moveVector.y.toFixed(2) + ' (' + moveVector.magnitude.toFixed(2) + ')\n' +
      'look: ' + lookVector.x.toFixed(2) + ', ' + lookVector.y.toFixed(2) + '\n' +
      'LT/RT: ' + getTrigger('left').toFixed(2) + ' / ' + getTrigger('right').toFixed(2) + '\n' +
      'buttons: ' + (pressed.join(' ') || '-') + '\n' +
      'actions: ' + (active.join(' ') || '-');
  }

  /* ---------------------------------------------------------------------- */

  window.MossInput = {
    STANDARD_BUTTONS: STANDARD_BUTTONS,
    bindings: padBindings,
    keyBindings: keyBindings,
    settings: settings,
    settingDefaults: settingDefaults,
    update: update,
    isHeld: isHeld,
    wasPressed: wasPressed,
    wasReleased: wasReleased,
    padHeld: padHeld,
    padPressed: padPressed,
    padReleased: padReleased,
    getAxis: getAxis,
    getVector: getVector,
    getTrigger: getTrigger,
    anyPressed: anyButtonPressed,
    menuStep: menuStep,
    label: label,
    promptStyle: promptStyle,
    vibrate: vibrate,
    releaseAll: releaseAll,
    setTouchVector: function (x, y, magnitude) {
      touchVector.x = x || 0;
      touchVector.y = y || 0;
      touchVector.magnitude = clamp(magnitude || 0, 0, 1);
      if (touchVector.magnitude > 0) setActiveMethod('touch');
    },
    isConnected: function () { return padConnected; },
    getPadInfo: function () {
      return { connected: padConnected, index: padIndex, id: padId, mapping: padMapping };
    },
    getActiveMethod: function () { return activeMethod; },
    setActiveMethod: function (method) { setActiveMethod(method, true); },
    onMethodChange: function (fn) { if (typeof fn === 'function') methodListeners.push(fn); },
    onConnectionChange: function (fn) { if (typeof fn === 'function') connectionListeners.push(fn); },
    saveSettings: saveSettings,
    applySettings: function (patch) {
      if (patch && typeof patch === 'object') validateSettings(patch, settings);
      saveSettings();
    },
    resetSettings: function () {
      validateSettings({}, settings);
      for (var key in settingDefaults) {
        if (Object.prototype.hasOwnProperty.call(settingDefaults, key)) settings[key] = settingDefaults[key];
      }
      saveSettings();
    },
    setDebug: setDebug,
    isDebug: function () { return debugEnabled; },
    /* Exposed for unit testing of the pure maths. */
    _applyRadialDeadzone: applyRadialDeadzone,
    _validateSettings: validateSettings
  };
})();
