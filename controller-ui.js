/*
 * MossControllerUI — controller-driven menu navigation and on-screen prompts.
 *
 * Sits between MossInput (raw device layer) and game.js (gameplay). It owns
 * every input frame in which a menu, panel, dialogue or the title screen is on
 * screen, so gameplay code only ever sees pad input during actual play.
 *
 * Navigation is spatial rather than list-index based: focus candidates are
 * scored against their on-screen rectangles. That keeps dynamically rendered
 * grids (backpack, skill tree, shop, instruments, hub tabs) working with no
 * per-menu ordering tables to maintain.
 */
(function () {
  'use strict';

  var input = window.MossInput;
  if (!input) return;

  var FOCUSABLE = 'button:not([disabled]):not([hidden]), select:not([disabled]), ' +
    'input:not([disabled]):not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])';

  /*
   * Topmost-first. Mirrors the precedence used by game.js closeTopOverlay so
   * cancel always dismisses the panel the player believes is on top.
   */
  var OVERLAYS = [
    'settingsPanel', 'howPanel', 'inventoryScreen', 'shopScreen', 'skillsScreen',
    'instrumentsScreen', 'homeScreen', 'statisticsScreen', 'mapScreen',
    'composerScreen', 'productionHub', 'endingScreen', 'pauseScreen', 'titleScreen'
  ];

  /* Tab strips that the bumpers should cycle, per overlay. */
  var TAB_GROUPS = {
    inventoryScreen: '#inventoryTabs button',
    productionHub: '#productionTabs button',
    skillsScreen: '#skillFilters button',
    mapScreen: '#questFilters button'
  };

  var lastFocused = null;
  var noticeNode = null;
  var noticeTimer = 0;
  var legendNode = null;

  function byId(id) { return document.getElementById(id); }

  function game() {
    var api = window.__HIGH_NOTES__;
    return api && api.controller ? api.controller : null;
  }

  function isVisible(el) {
    if (!el || el.hidden) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  }

  /* The panel the player is currently looking at, or null during gameplay. */
  function topOverlay() {
    for (var i = 0; i < OVERLAYS.length; i++) {
      var el = byId(OVERLAYS[i]);
      if (el && !el.hidden && isVisible(el)) return el;
    }
    return null;
  }

  function dialogueOpen() {
    var box = byId('dialogueBox');
    return !!box && !box.hidden && isVisible(box);
  }

  function collectFocusable(root) {
    var nodes = root.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.disabled) continue;
      if (node.type === 'hidden') continue;
      if (!isVisible(node)) continue;
      out.push(node);
    }
    return out;
  }

  function centreOf(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect: rect };
  }

  /*
   * Score candidates lying in the requested direction. Distance along the axis
   * of travel dominates; drift across it is penalised so a press of "down"
   * prefers the cell directly below over one far to the side.
   */
  function findNeighbour(current, candidates, dx, dy) {
    if (!current) return candidates[0] || null;
    var from = centreOf(current);
    var best = null;
    var bestScore = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (candidate === current) continue;
      var to = centreOf(candidate);
      var deltaX = to.x - from.x;
      var deltaY = to.y - from.y;
      var along = deltaX * dx + deltaY * dy;
      if (along <= 1) continue;
      var across = Math.abs(deltaX * dy) + Math.abs(deltaY * dx);
      if (across > along * 2.4 + 40) continue;
      var score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) return best;
    /* Nothing ahead — wrap to the far edge so long lists stay reachable. */
    var wrapped = null;
    var wrapScore = -Infinity;
    for (var j = 0; j < candidates.length; j++) {
      var option = candidates[j];
      if (option === current) continue;
      var point = centreOf(option);
      var back = (point.x - from.x) * -dx + (point.y - from.y) * -dy;
      var offAxis = Math.abs((point.x - from.x) * dy) + Math.abs((point.y - from.y) * dx);
      if (back <= 0 || offAxis > 90) continue;
      if (back > wrapScore) {
        wrapScore = back;
        wrapped = option;
      }
    }
    return wrapped;
  }

  function setFocus(el) {
    if (!el) return;
    if (lastFocused && lastFocused !== el) lastFocused.classList.remove('pad-focus');
    lastFocused = el;
    el.classList.add('pad-focus');
    try {
      el.focus({ preventScroll: false });
    } catch (error) {
      try { el.focus(); } catch (ignored) { /* detached node */ }
    }
    if (typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (error) {
        /* Older engines reject the options object. */
      }
    }
  }

  function clearFocusRing() {
    if (lastFocused) lastFocused.classList.remove('pad-focus');
    lastFocused = null;
  }

  function currentFocus(root) {
    var active = document.activeElement;
    if (active && active !== document.body && root.contains(active) && isVisible(active)) return active;
    if (lastFocused && root.contains(lastFocused) && isVisible(lastFocused)) return lastFocused;
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Value editing — sliders, selects and checkboxes must work without a mouse */
  /* ---------------------------------------------------------------------- */

  function isValueControl(el) {
    if (!el) return false;
    if (el.tagName === 'SELECT') return true;
    if (el.tagName !== 'INPUT') return false;
    return el.type === 'range' || el.type === 'checkbox';
  }

  function adjustValue(el, direction) {
    if (el.tagName === 'SELECT') {
      var count = el.options.length;
      if (!count) return false;
      var next = el.selectedIndex + direction;
      if (next < 0) next = count - 1;
      if (next >= count) next = 0;
      el.selectedIndex = next;
      fire(el);
      return true;
    }
    if (el.type === 'range') {
      var step = Number(el.step) || 0.05;
      var min = el.min === '' ? 0 : Number(el.min);
      var max = el.max === '' ? 1 : Number(el.max);
      var value = Number(el.value) + step * direction;
      el.value = String(Math.max(min, Math.min(max, value)));
      fire(el);
      return true;
    }
    return false;
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function activate(el) {
    if (!el) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      el.checked = !el.checked;
      fire(el);
      return;
    }
    if (el.tagName === 'SELECT') {
      adjustValue(el, 1);
      return;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') return;
    if (typeof el.click === 'function') el.click();
  }

  /*
   * game.js closeTopOverlay() knows nothing about the ending screen or the
   * Version 2.0 hub. Both are displayed while `paused` is true, so delegating
   * to it would fall through to togglePause(false) and resume the world
   * underneath while the panel stayed on screen.
   */
  function cancelOverlay(overlay) {
    if (!overlay) return;
    /* The run is over; Play Again is the only meaningful exit. */
    if (overlay.id === 'endingScreen') return;
    if (overlay.id === 'productionHub') {
      var close = byId('closeProductionHub');
      if (close) close.click();
      return;
    }
    var api = game();
    if (api) api.closeTopOverlay();
  }

  /* ---------------------------------------------------------------------- */
  /* Tab strips                                                              */
  /* ---------------------------------------------------------------------- */

  function cycleTabs(overlay, direction) {
    var selector = TAB_GROUPS[overlay.id];
    if (!selector) return false;
    var tabs = [];
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i]) && !nodes[i].disabled) tabs.push(nodes[i]);
    }
    if (tabs.length < 2) return false;
    var activeIndex = 0;
    for (var j = 0; j < tabs.length; j++) {
      if (tabs[j].classList.contains('active') || tabs[j].getAttribute('aria-selected') === 'true') {
        activeIndex = j;
        break;
      }
    }
    var nextIndex = (activeIndex + direction + tabs.length) % tabs.length;
    tabs[nextIndex].click();
    /* Content is re-rendered by the click, so re-seed focus next frame. */
    window.requestAnimationFrame(function () {
      var refreshed = collectFocusable(overlay);
      if (refreshed.length) setFocus(tabs[nextIndex]);
    });
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Connection notice                                                        */
  /* ---------------------------------------------------------------------- */

  function ensureNotice() {
    if (noticeNode && noticeNode.isConnected) return noticeNode;
    var shell = byId('gameShell') || document.body;
    noticeNode = document.createElement('div');
    noticeNode.className = 'controller-notice';
    noticeNode.setAttribute('role', 'status');
    noticeNode.setAttribute('aria-live', 'polite');
    noticeNode.innerHTML = '<span class="notice-dot" aria-hidden="true"></span><span class="notice-text"></span>';
    shell.appendChild(noticeNode);
    return noticeNode;
  }

  function showNotice(text, detail, lost) {
    var node = ensureNotice();
    var body = node.querySelector('.notice-text');
    body.textContent = '';
    var strong = document.createElement('strong');
    strong.textContent = text;
    body.appendChild(strong);
    if (detail) {
      var small = document.createElement('small');
      small.textContent = ' ' + detail;
      body.appendChild(small);
    }
    node.classList.toggle('is-lost', !!lost);
    node.classList.add('show');
    noticeTimer = 3.4;
  }

  function updateNotice(dt) {
    if (noticeTimer <= 0) return;
    noticeTimer -= dt;
    if (noticeTimer <= 0 && noticeNode) noticeNode.classList.remove('show');
  }

  input.onConnectionChange(function (connected, id) {
    if (connected) {
      /* Trim the vendor noise Xbox pads report so the notice stays readable. */
      var name = String(id || 'Controller').replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Controller';
      if (name.length > 32) name = name.slice(0, 32).trim() + '…';
      showNotice('Controller connected', name, false);
      input.vibrate(0.35, 140);
    } else {
      showNotice('Controller disconnected', 'Reconnect, or use keyboard', true);
      var api = game();
      if (api && api.isStarted() && !api.isPaused()) api.pauseForInterruption();
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Prompt swapping                                                          */
  /* ---------------------------------------------------------------------- */

  function chip(labelText) {
    return '<span class="cprompt" data-btn="' + labelText + '">' + labelText + '</span>';
  }

  function refreshPrompts() {
    var pad = input.promptStyle() === 'xbox';
    var hint = byId('dialogueHint');
    if (hint) {
      hint.innerHTML = pad ? chip('A') + ' continue' : 'E / Enter to continue';
      hint.classList.toggle('desktop-only', !pad);
    }
    var abilityKey = document.querySelector('.ability-key');
    if (abilityKey) abilityKey.textContent = pad ? 'CONTROLLER' : 'QUICK KEYS';
    var abilityBar = byId('abilityBar');
    if (abilityBar && abilityBar.dataset.padManaged !== 'off') {
      abilityBar.innerHTML = pad
        ? chip('A') + ' STRIKE · ' + chip('B') + ' DODGE · ' + chip('X') + ' PULSE'
        : 'SPACE SWING · SHIFT DASH';
    }
    var titleHint = document.querySelector('.title-hint');
    if (titleHint) {
      titleHint.innerHTML = pad
        ? chip('LS') + ' roam · ' + chip('A') + ' strike · ' + chip('Y') + ' vibe · ' + chip('Menu') + ' pause'
        : '<kbd>WASD</kbd> roam · <kbd>J</kbd> strike · <kbd>E</kbd> vibe';
      titleHint.classList.toggle('desktop-only', !pad);
    }
    updateLegend();
  }

  input.onMethodChange(refreshPrompts);

  /* ---------------------------------------------------------------------- */
  /* Context legend                                                           */
  /* ---------------------------------------------------------------------- */

  function ensureLegend() {
    if (legendNode && legendNode.isConnected) return legendNode;
    var shell = byId('gameShell') || document.body;
    legendNode = document.createElement('div');
    legendNode.className = 'pad-legend';
    legendNode.setAttribute('aria-hidden', 'true');
    shell.appendChild(legendNode);
    return legendNode;
  }

  function updateLegend() {
    var node = ensureLegend();
    if (input.promptStyle() !== 'xbox') {
      node.classList.remove('show');
      return;
    }
    var overlay = topOverlay();
    var parts;
    if (dialogueOpen()) {
      parts = [chip('A') + ' Continue'];
    } else if (overlay) {
      parts = [chip('A') + ' Select', chip('B') + ' Back'];
      if (TAB_GROUPS[overlay.id]) parts.push(chip('LB') + chip('RB') + ' Tabs');
      if (overlay.id === 'pauseScreen') parts.push(chip('Menu') + ' Resume');
    } else {
      node.classList.remove('show');
      return;
    }
    node.innerHTML = parts.map(function (part) { return '<span>' + part + '</span>'; }).join('');
    node.classList.add('show');
  }

  /* ---------------------------------------------------------------------- */
  /* Fullscreen                                                               */
  /* ---------------------------------------------------------------------- */

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function fullscreenSupported() {
    var root = document.documentElement;
    return !!(root.requestFullscreen || root.webkitRequestFullscreen);
  }

  function toggleFullscreen() {
    var target = byId('gameShell') || document.documentElement;
    try {
      if (fullscreenElement()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          var exiting = exit.call(document);
          if (exiting && typeof exiting.catch === 'function') exiting.catch(noop);
        }
        return true;
      }
      var request = target.requestFullscreen || target.webkitRequestFullscreen;
      if (!request) return false;
      /* Never retry on rejection — repeated requests get the tab blocked. */
      var entering = request.call(target, { navigationUI: 'hide' });
      if (entering && typeof entering.catch === 'function') entering.catch(noop);
      return true;
    } catch (error) {
      return false;
    }
  }

  function noop() {}

  function syncFullscreenLabel() {
    var button = byId('fullscreenToggle');
    if (!button) return;
    var active = !!fullscreenElement();
    button.textContent = active ? 'Exit Fullscreen' : 'Enter Fullscreen';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  document.addEventListener('fullscreenchange', syncFullscreenLabel);
  document.addEventListener('webkitfullscreenchange', syncFullscreenLabel);

  /* ---------------------------------------------------------------------- */
  /* Frame update                                                             */
  /* ---------------------------------------------------------------------- */

  /*
   * Returns true when this module consumed the frame's input, which tells
   * game.js to skip gameplay pad handling.
   */
  function update(dt) {
    updateNotice(dt);

    var overlay = topOverlay();
    var inDialogue = dialogueOpen();

    if (!overlay && !inDialogue) {
      clearFocusRing();
      if (legendNode) legendNode.classList.remove('show');
      return false;
    }

    /* Menu context: only the pad drives navigation, never gameplay. */
    if (input.getActiveMethod() === 'gamepad') updateLegend();

    if (inDialogue) {
      if (input.padPressed('confirm') || input.padPressed('interact') || input.padPressed('cancel')) {
        var api = game();
        if (api) api.advanceDialogue();
      }
      return true;
    }

    if (!input.isConnected()) return true;

    handleNavigation(overlay, dt);
    return true;
  }

  function handleNavigation(overlay, dt) {
    var candidates = collectFocusable(overlay);
    if (!candidates.length) return;

    var focused = currentFocus(overlay);
    if (!focused) {
      setFocus(candidates[0]);
      focused = candidates[0];
    }

    var step = input.menuStep();
    var dx = step.x;
    var dy = step.y;

    if (dx || dy) {
      /* Left/right edits the focused control instead of moving off it. */
      if (!(dx && isValueControl(focused) && adjustValue(focused, dx))) {
        var next = findNeighbour(focused, candidates, dx, dy);
        if (next) setFocus(next);
      }
    }

    /* Deliberately no rumble on menu movement or confirmation — haptics are
       reserved for gameplay feedback so menus stay quiet. */
    if (input.padPressed('confirm')) {
      activate(focused);
      /* Activation frequently re-renders the panel; re-seed focus safely. */
      window.requestAnimationFrame(function () {
        var current = topOverlay();
        if (!current) return;
        if (lastFocused && current.contains(lastFocused) && isVisible(lastFocused)) return;
        var refreshed = collectFocusable(current);
        if (refreshed.length) setFocus(refreshed[0]);
      });
      return;
    }

    if (input.padPressed('cancel')) {
      clearFocusRing();
      cancelOverlay(overlay);
      return;
    }

    if (input.padPressed('pause')) {
      var pauseApi = game();
      if (!pauseApi) return;
      clearFocusRing();
      if (overlay.id === 'pauseScreen') pauseApi.togglePause(false);
      else cancelOverlay(overlay);
      return;
    }

    if (input.padPressed('tabNext')) cycleTabs(overlay, 1);
    else if (input.padPressed('tabPrev')) cycleTabs(overlay, -1);
  }

  /* ---------------------------------------------------------------------- */

  window.MossControllerUI = {
    update: update,
    refreshPrompts: refreshPrompts,
    toggleFullscreen: toggleFullscreen,
    fullscreenSupported: fullscreenSupported,
    isFullscreen: function () { return !!fullscreenElement(); },
    syncFullscreenLabel: syncFullscreenLabel,
    showNotice: showNotice,
    isMenuContext: function () { return !!topOverlay() || dialogueOpen(); },
    chip: chip,
    focusFirst: function (rootId) {
      var root = byId(rootId);
      if (!root) return;
      var options = collectFocusable(root);
      if (options.length) setFocus(options[0]);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshPrompts);
  } else {
    refreshPrompts();
  }
})();
