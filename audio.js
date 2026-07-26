/* MossAudio: original procedural music and sound effects, no external assets. */
(function (root) {
  "use strict";

  const AudioContextClass = root.AudioContext || root.webkitAudioContext;
  const NOTE_MIDI = Object.freeze({ C: 72, E: 76, G: 79, B: 83 });
  const MUSIC_STEP = 60 / 104 / 4; // 104 BPM, sixteenth-note clock.
  const EPSILON = 0.0001;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  class MossAudioEngine {
    constructor() {
      this.supported = Boolean(AudioContextClass);
      this.context = null;
      this.master = null;
      this.musicBus = null;
      this.sfxBus = null;
      this.compressor = null;

      this.musicVolume = 0.62;
      this.sfxVolume = 0.82;
      this.noteCount = 0;
      this.melody = [];
      this._activeMelodyNames = [];
      this.adaptiveState = {
        stage: 1,
        scene: "exploration",
        intensity: 0,
        instrument: "guitar",
        resonance: "",
        weather: "clear",
        track: ""
      };

      this._wanted = false;
      this._running = false;
      this._paused = false;
      this._hidden = typeof document !== "undefined" && document.hidden;
      this._disposed = false;
      this._timer = 0;
      this._step = 0;
      this._nextStepTime = 0;
      this._noiseBuffer = null;
      this._sources = new Set();
      this._musicSources = new Set();
      this._previewSources = new Set();
      this._resumePromise = null;
      this._resumeGeneration = 0;
      this._suspendPromise = null;
      this._lifecycleRecoveryPromise = null;
      this._lifecycleGeneration = 0;
      this._needsLifecycleResume = false;
      this._clockCheckTimer = 0;
      this._lastContextTime = 0;
      this._stalledSchedulerTicks = 0;
      this._primedContext = null;
      this._contextStateTarget = null;
      this._contextStateHandler = null;
      this._dialogueIndex = 0;
      this._footstepIndex = 0;

      this._onVisibilityChange = () => {
        if (document.hidden) this._handlePageHidden();
        else this._handlePageShown();
      };
      this._onPageHide = () => this._handlePageHidden();
      this._onPageShow = () => {
        if (typeof document === "undefined" || !document.hidden) this._handlePageShown();
      };
      this._onUserGesture = () => {
        // Do not claim an audio session for title-screen taps that do not start the game.
        if (this._disposed || (!this.context && !this._wanted)) return;
        this.unlock().catch(() => false);
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this._onVisibilityChange);
      }
      if (typeof root.addEventListener === "function") {
        root.addEventListener("pagehide", this._onPageHide);
        root.addEventListener("pageshow", this._onPageShow);
        // Capture runs before gameplay handlers, giving WebKit the activation token first.
        root.addEventListener("pointerdown", this._onUserGesture, true);
        root.addEventListener("touchend", this._onUserGesture, true);
        root.addEventListener("keydown", this._onUserGesture, true);
      }
    }

    _ensureContext() {
      if (this._disposed || !this.supported) return false;
      if (this.context && this.context.state !== "closed") return true;

      try {
        const ctx = new AudioContextClass();
        const master = ctx.createGain();
        const musicBus = ctx.createGain();
        const sfxBus = ctx.createGain();
        const compressor = ctx.createDynamicsCompressor();

        master.gain.value = 0.86;
        musicBus.gain.value = Math.pow(this.musicVolume, 1.45);
        sfxBus.gain.value = Math.pow(this.sfxVolume, 1.35);
        compressor.threshold.value = -16;
        compressor.knee.value = 18;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.18;

        musicBus.connect(master);
        sfxBus.connect(master);
        master.connect(compressor);
        compressor.connect(ctx.destination);

        this.context = ctx;
        this.master = master;
        this.musicBus = musicBus;
        this.sfxBus = sfxBus;
        this.compressor = compressor;
        this._resumePromise = null;
        this._resumeGeneration += 1;
        this._suspendPromise = null;
        this._lifecycleRecoveryPromise = null;
        this._lifecycleGeneration += 1;
        if (!this._hidden) this._needsLifecycleResume = false;
        this._primedContext = null;
        this._attachContextStateHandler(ctx);
        return true;
      } catch (_error) {
        this.supported = false;
        return false;
      }
    }

    _attachContextStateHandler(ctx) {
      this._detachContextStateHandler();
      const handler = () => {
        if (this._disposed || this.context !== ctx) return;
        if (ctx.state === "running") {
          if (this._needsLifecycleResume && !this._hidden) {
            // Confirm that WebKit's clock really restarted before trusting "running".
            this._scheduleClockCheck(ctx, 0);
          } else {
            this._reconcilePlayback();
          }
        } else {
          if (ctx.state !== "closed" && !this._hidden) this._needsLifecycleResume = true;
          this._stopScheduler(false);
          this._cancelMelodyPreview();
        }
      };
      this._contextStateTarget = ctx;
      this._contextStateHandler = handler;
      if (typeof ctx.addEventListener === "function") {
        ctx.addEventListener("statechange", handler);
      } else {
        ctx.onstatechange = handler;
      }
    }

    _detachContextStateHandler() {
      const ctx = this._contextStateTarget;
      const handler = this._contextStateHandler;
      if (ctx && handler) {
        if (typeof ctx.removeEventListener === "function") {
          ctx.removeEventListener("statechange", handler);
        } else if (ctx.onstatechange === handler) {
          ctx.onstatechange = null;
        }
      }
      this._contextStateTarget = null;
      this._contextStateHandler = null;
    }

    _primeContext(ctx) {
      if (!ctx || this._primedContext === ctx || typeof ctx.createBufferSource !== "function") return;
      try {
        // A one-frame silent source preserves compatibility with WebKit versions where
        // resume() alone did not fully open the output path. It must start in the gesture.
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          try { source.disconnect(); } catch (_error) { /* already disconnected */ }
        };
        source.start(0);
        this._primedContext = ctx;
      } catch (_error) {
        // Modern WebKit only needs resume(); priming is a best-effort compatibility path.
      }
    }

    _settleWithin(attempt, timeoutMs) {
      return new Promise((resolve) => {
        let settled = false;
        const timer = root.setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(false);
        }, timeoutMs);
        Promise.resolve(attempt).then((value) => {
          if (settled) return;
          settled = true;
          root.clearTimeout(timer);
          resolve(value);
        }).catch(() => {
          if (settled) return;
          settled = true;
          root.clearTimeout(timer);
          resolve(false);
        });
      });
    }

    _resumeContext(forceAttempt = false) {
      if (!this.context || this.context.state === "closed") return Promise.resolve(false);
      if (this.context.state === "running") return Promise.resolve(true);
      if (this._resumePromise && !forceAttempt) return this._resumePromise;
      if (forceAttempt) this._resumePromise = null;

      const ctx = this.context;
      const generation = ++this._resumeGeneration;
      let attempt;
      try {
        // Call synchronously so a click/tap retains its browser activation token.
        attempt = ctx.resume();
      } catch (_error) {
        return Promise.resolve(false);
      }
      const pending = this._settleWithin(
        Promise.resolve(attempt).then(() => this.context === ctx && ctx.state === "running"),
        800
      );
      this._resumePromise = pending;
      pending.then(() => {
        if (this._resumeGeneration === generation && this._resumePromise === pending) {
          this._resumePromise = null;
        }
      });
      return pending;
    }

    _suspendContext(ctx) {
      if (!ctx || ctx.state === "closed" || typeof ctx.suspend !== "function") {
        return Promise.resolve(false);
      }
      let attempt;
      try {
        attempt = ctx.suspend();
      } catch (_error) {
        return Promise.resolve(false);
      }
      return this._settleWithin(
        Promise.resolve(attempt).then(() => this.context === ctx && ctx.state !== "closed"),
        450
      );
    }

    _forceContextBounce(ctx, lifecycleGeneration) {
      if (!ctx || this.context !== ctx || ctx.state === "closed") return Promise.resolve(false);
      const suspension = ctx.state === "running" ? this._suspendContext(ctx) : Promise.resolve(true);
      return suspension.then(() => {
        if (this._disposed || this.context !== ctx || this._hidden) return false;
        if (Number.isFinite(lifecycleGeneration) && lifecycleGeneration !== this._lifecycleGeneration) return false;
        // Force bypasses an older resume promise that Safari may have left pending.
        return this._resumeContext(true);
      }).catch(() => false);
    }

    _handlePageHidden() {
      if (this._disposed) return;
      const alreadyHandled = this._hidden && this._needsLifecycleResume;
      this._hidden = true;
      this._needsLifecycleResume = true;
      this._cancelClockCheck();
      this._stopScheduler(false);
      this._cancelMelodyPreview();
      this._primedContext = null;
      if (alreadyHandled || !this.context || this.context.state === "closed") return;

      this._lifecycleGeneration += 1;
      this._resumeGeneration += 1;
      this._resumePromise = null;
      const ctx = this.context;
      const pending = this._suspendContext(ctx);
      this._suspendPromise = pending;
      pending.then(() => {
        if (this._suspendPromise === pending && this.context !== ctx) this._suspendPromise = null;
      });
    }

    _handlePageShown() {
      if (this._disposed) return;
      if (typeof document !== "undefined" && document.hidden) return;
      this._hidden = false;
      if (!this.context || this.context.state === "closed") {
        this._needsLifecycleResume = false;
        this._suspendPromise = null;
        return;
      }
      if (!this._needsLifecycleResume) {
        this._reconcilePlayback();
        return;
      }
      this._recoverFromLifecycle();
    }

    _recoverFromLifecycle() {
      if (this._disposed || this._hidden || !this.context || this.context.state === "closed") {
        return Promise.resolve(false);
      }
      if (this._lifecycleRecoveryPromise) return this._lifecycleRecoveryPromise;

      const ctx = this.context;
      const generation = this._lifecycleGeneration;
      const waitForSuspend = this._suspendPromise || Promise.resolve(true);
      const pending = Promise.resolve(waitForSuspend)
        .catch(() => false)
        .then(() => {
          if (this._disposed || this._hidden || this.context !== ctx || generation !== this._lifecycleGeneration) return false;
          // A forced bounce also repairs WebKit's "running" state with a frozen clock.
          return ctx.state === "running"
            ? this._forceContextBounce(ctx, generation)
            : this._resumeContext(true);
        })
        .then((ready) => {
          if (this.context !== ctx || generation !== this._lifecycleGeneration) return false;
          this._suspendPromise = null;
          this._needsLifecycleResume = !ready;
          if (ready) {
            this._reconcilePlayback();
            this._scheduleClockCheck(ctx, 0);
          }
          return ready;
        })
        .catch(() => false);
      this._lifecycleRecoveryPromise = pending;
      pending.then(() => {
        if (this._lifecycleRecoveryPromise === pending) this._lifecycleRecoveryPromise = null;
      });
      return pending;
    }

    _cancelClockCheck() {
      if (this._clockCheckTimer) root.clearTimeout(this._clockCheckTimer);
      this._clockCheckTimer = 0;
    }

    _scheduleClockCheck(ctx, attempt) {
      this._cancelClockCheck();
      if (!ctx || this.context !== ctx || ctx.state !== "running" || this._hidden || this._paused || !this._wanted) return;
      const before = ctx.currentTime;
      this._clockCheckTimer = root.setTimeout(() => {
        this._clockCheckTimer = 0;
        if (this._disposed || this.context !== ctx || ctx.state !== "running" || this._hidden || this._paused || !this._wanted) return;
        if (ctx.currentTime > before + 0.005) {
          if (this._needsLifecycleResume) {
            this._needsLifecycleResume = false;
            this._reconcilePlayback();
          }
          return;
        }

        this._needsLifecycleResume = true;
        this._stopScheduler(false);
        if (attempt > 0) return;
        this._forceContextBounce(ctx, this._lifecycleGeneration).then((ready) => {
          if (!ready || this.context !== ctx || this._hidden) return;
          this._needsLifecycleResume = false;
          this._reconcilePlayback();
          this._scheduleClockCheck(ctx, attempt + 1);
        }).catch(() => false);
      }, 280);
    }

    /** Resume suspended or WebKit-interrupted audio after a click/tap. */
    async unlock() {
      if (!this._ensureContext()) return false;
      const ctx = this.context;
      const recovering = this._needsLifecycleResume;
      if (recovering) {
        // This call is inside a real gesture; invalidate non-gesture lifecycle work first.
        this._lifecycleGeneration += 1;
        this._lifecycleRecoveryPromise = null;
        this._suspendPromise = null;
      }
      this._primeContext(ctx);
      if (this._hidden) return false;
      const ready = recovering && ctx.state === "running"
        ? await this._forceContextBounce(ctx, this._lifecycleGeneration)
        : ctx.state === "running" || await this._resumeContext(true);
      if (ready && this.context === ctx) {
        this._needsLifecycleResume = false;
        this._reconcilePlayback();
        if (recovering) this._scheduleClockCheck(ctx, 0);
      }
      return ready;
    }

    setMusicVolume(value) {
      this.musicVolume = clamp(Number(value) || 0, 0, 1);
      this._setBusVolume(this.musicBus, Math.pow(this.musicVolume, 1.45));
      return this.musicVolume;
    }

    setSfxVolume(value) {
      this.sfxVolume = clamp(Number(value) || 0, 0, 1);
      this._setBusVolume(this.sfxBus, Math.pow(this.sfxVolume, 1.35));
      return this.sfxVolume;
    }

    _setBusVolume(bus, value) {
      if (!bus || !this.context || this.context.state === "closed") return;
      const now = this.context.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(value, now, 0.018);
    }

    /** Request music playback. Safe to call on every scene change. */
    start() {
      this._wanted = true;
      if (!this._ensureContext()) return false;
      if (this.context.state === "running" && !this._needsLifecycleResume) {
        this._reconcilePlayback();
      } else {
        // This succeeds when start() itself came from a user gesture.
        this.unlock().catch(() => false);
      }
      return true;
    }

    stop() {
      this._wanted = false;
      this._cancelClockCheck();
      this._stopScheduler(true);
      this._cancelMelodyPreview();
      return true;
    }

    pause(flag = true) {
      this._paused = Boolean(flag);
      if (this._paused) {
        this._cancelClockCheck();
        this._cancelMelodyPreview();
      }
      if (!this._paused && this._needsLifecycleResume && !this._hidden) {
        this._recoverFromLifecycle().then(() => this._reconcilePlayback()).catch(() => false);
      } else if (!this._paused && this.context && this.context.state !== "running" && this.context.state !== "closed") {
        this._resumeContext(false).then(() => this._reconcilePlayback()).catch(() => false);
      } else {
        this._reconcilePlayback();
      }
      return this._paused;
    }

    _reconcilePlayback() {
      if (!this.context) return;
      const shouldPlay = this._wanted && !this._paused && !this._hidden && !this._needsLifecycleResume;
      if (shouldPlay && this.context.state === "running") {
        this._startScheduler();
      } else {
        this._stopScheduler(false);
      }
    }

    _startScheduler() {
      if (this._running || !this.context || this.context.state !== "running" ||
          !this._wanted || this._paused || this._hidden || this._needsLifecycleResume) return;
      this._running = true;
      this._lastContextTime = this.context.currentTime;
      this._stalledSchedulerTicks = 0;
      this._nextStepTime = Math.max(this.context.currentTime + 0.055, this._nextStepTime);
      this._timer = root.setInterval(() => this._scheduleAhead(), 25);
      this._scheduleAhead();
    }

    _stopScheduler(resetPosition) {
      if (this._timer) root.clearInterval(this._timer);
      this._timer = 0;
      this._running = false;
      this._stopSources(this._musicSources);
      this._nextStepTime = 0;
      this._lastContextTime = 0;
      this._stalledSchedulerTicks = 0;
      if (resetPosition) this._step = 0;
    }

    _scheduleAhead() {
      if (!this._running || !this.context) return;
      if (this.context.state !== "running" || !this._wanted || this._paused || this._hidden || this._needsLifecycleResume) {
        this._stopScheduler(false);
        return;
      }
      const now = this.context.currentTime;
      if (now <= this._lastContextTime + 0.0005) {
        this._stalledSchedulerTicks += 1;
        if (this._stalledSchedulerTicks >= 20) {
          this._needsLifecycleResume = true;
          this._stopScheduler(false);
          return;
        }
      } else {
        this._stalledSchedulerTicks = 0;
      }
      this._lastContextTime = now;
      // Advance the transport before scheduling after a stall; never render missed beats in a burst.
      if (!Number.isFinite(this._nextStepTime) || this._nextStepTime <= 0) {
        this._nextStepTime = now + 0.035;
      } else if (this._nextStepTime < now - 0.01) {
        const target = now + 0.02;
        const skipped = Math.max(1, Math.ceil((target - this._nextStepTime) / MUSIC_STEP));
        this._step = (this._step + skipped) % 64;
        this._nextStepTime += skipped * MUSIC_STEP;
      }
      const horizon = now + 0.14;
      // The cap is a final guard against malformed browser clocks.
      let scheduled = 0;
      while (this._nextStepTime < horizon && scheduled < 12) {
        this._scheduleMusicStep(this._step, this._nextStepTime);
        this._step = (this._step + 1) % 64;
        this._nextStepTime += MUSIC_STEP;
        scheduled += 1;
      }
    }

    setProgress(noteCount, melodyArray, unlockedNotes) {
      this.noteCount = clamp(Math.floor(Number(noteCount) || 0), 0, 4);
      const input = Array.isArray(melodyArray)
        ? melodyArray
        : typeof melodyArray === "string"
          ? melodyArray.split(/[\s,]+/)
          : [];
      this.melody = input.slice(0, 32).map((note) => {
        const clean = String(note || "-").trim().toUpperCase().replace(/[0-9]/g, "");
        return Object.prototype.hasOwnProperty.call(NOTE_MIDI, clean) ? clean : "-";
      });
      this._activeMelodyNames = [];
      if (Array.isArray(unlockedNotes)) {
        const unlocked = new Set(unlockedNotes.map((note) => {
          const clean = String(note || "").trim().toUpperCase().replace(/[0-9]/g, "");
          return Object.prototype.hasOwnProperty.call(NOTE_MIDI, clean) ? clean : "-";
        }));
        this.melody.forEach((note) => {
          if (note !== "-" && unlocked.has(note) && !this._activeMelodyNames.includes(note)) {
            this._activeMelodyNames.push(note);
          }
        });
      } else {
        // Legacy callers reveal at most noteCount distinct melody colors.
        this.melody.forEach((note) => {
          if (note !== "-" && !this._activeMelodyNames.includes(note) && this._activeMelodyNames.length < this.noteCount) {
            this._activeMelodyNames.push(note);
          }
        });
      }
      return { noteCount: this.noteCount, melody: this.melody.slice() };
    }

    /** Update the procedural arrangement without restarting the transport. */
    setAdaptiveState(nextState = {}) {
      const stages = [1, 2, 3, 4];
      const scenes = ["exploration", "combat", "boss", "home"];
      const instruments = ["guitar", "bass", "synth", "drums", "microphone", "violin"];
      const resonances = ["", "nature", "psychedelic", "heavy", "conductor"];
      const weather = ["clear", "rain", "fog", "wind", "crystal-storm", "blood-moon", "forest-bloom"];
      const current = this.adaptiveState;
      current.stage = stages.includes(Number(nextState.stage)) ? Number(nextState.stage) : current.stage;
      current.scene = scenes.includes(nextState.scene) ? nextState.scene : current.scene;
      current.intensity = clamp(Number(nextState.intensity) || 0, 0, 1);
      current.instrument = instruments.includes(nextState.instrument) ? nextState.instrument : current.instrument;
      current.resonance = resonances.includes(nextState.resonance) ? nextState.resonance : current.resonance;
      current.weather = weather.includes(nextState.weather) ? nextState.weather : current.weather;
      current.track = typeof nextState.track === "string" ? nextState.track.slice(0, 48) : current.track;
      return Object.assign({}, current);
    }

    _scheduleMusicStep(step, time) {
      const inBar = step % 16;
      const bar = Math.floor(step / 16);
      const roots = [48, 45, 41, 43]; // C, A, F, G: an original mellow loop.
      const chords = [
        [48, 55, 59, 64],
        [45, 52, 55, 60],
        [41, 48, 52, 55],
        [43, 50, 52, 59]
      ];
      const chord = chords[bar];
      this._scheduleAdaptiveLayer(step, time, inBar, bar, chord, roots);

      // Soft chord blooms are present from the beginning, so the world never feels empty.
      if (inBar === 0) {
        chord.slice(0, this.noteCount >= 2 ? 4 : 3).forEach((midi, index) => {
          this._osc({
            time: time + index * 0.012,
            freq: midiToHz(midi),
            duration: MUSIC_STEP * 14.5,
            type: index % 2 ? "sine" : "triangle",
            volume: index === 0 ? 0.028 : 0.021,
            attack: 0.19,
            release: 0.7,
            filter: 1450,
            bus: this.musicBus,
            music: true,
            pan: (index - 1.5) * 0.16
          });
        });
        this._kick(time, this.noteCount >= 1 ? 0.11 : 0.065, true);
      }

      // The groove gains a rounded bass after the first discovery.
      if (this.noteCount >= 1 && inBar % 4 === 0) {
        const bassShape = [0, 0, 7, 0][inBar / 4];
        this._osc({
          time,
          freq: midiToHz(roots[bar] - 12 + bassShape),
          duration: MUSIC_STEP * 2.8,
          type: "triangle",
          volume: 0.08,
          attack: 0.008,
          release: 0.17,
          filter: 520,
          bus: this.musicBus,
          music: true
        });
      }

      if (this.noteCount >= 2 && inBar % 4 === 2) {
        this._hat(time, inBar % 8 === 6 ? 0.026 : 0.018, true);
      }
      if (this.noteCount >= 2 && (inBar === 4 || inBar === 12)) {
        this._snare(time, 0.045, true);
      }
      if (this.noteCount >= 3 && (inBar === 7 || inBar === 15)) {
        this._kick(time, 0.06, true);
      }

      // A glassy arpeggio arrives mid-progress and follows each chord rather than a fixed tune.
      if (this.noteCount >= 3 && inBar % 2 === 1) {
        const arpIndex = ((inBar >> 1) + bar * 2) % chord.length;
        const arpMidi = chord[arpIndex] + 12;
        this._osc({
          time,
          freq: midiToHz(arpMidi),
          duration: MUSIC_STEP * 1.6,
          type: "sine",
          volume: 0.034,
          attack: 0.006,
          release: 0.15,
          filter: 2600,
          bus: this.musicBus,
          music: true,
          pan: arpIndex % 2 ? 0.28 : -0.28
        });
      }

      if (this.noteCount >= 4 && inBar % 4 === 2) {
        this._osc({
          time,
          freq: midiToHz(chord[(inBar / 4 + 1) % chord.length] + 24),
          duration: MUSIC_STEP * 0.72,
          type: "square",
          volume: 0.012,
          attack: 0.003,
          release: 0.06,
          filter: 3200,
          bus: this.musicBus,
          music: true,
          pan: inBar % 8 ? 0.42 : -0.42
        });
      }

      // Collected notes occupy eighth-note slots; '-' deliberately leaves musical space.
      if (this.noteCount > 0 && this.melody.length && inBar % 2 === 0) {
        const melodyIndex = Math.floor(step / 2) % this.melody.length;
        const note = this.melody[melodyIndex];
        if (note !== "-" && this._activeMelodyNames.includes(note)) {
          const phraseLift = bar === 3 && inBar >= 8 ? 12 : 0;
          const midi = NOTE_MIDI[note] + phraseLift;
          this._osc({
            time,
            freq: midiToHz(midi),
            duration: MUSIC_STEP * 1.55,
            type: "triangle",
            volume: 0.052,
            attack: 0.008,
            release: 0.2,
            filter: 2200,
            bus: this.musicBus,
            music: true,
            pan: melodyIndex % 2 ? 0.13 : -0.13
          });
          if (this.noteCount >= 4 && melodyIndex % 4 === 3) {
            this._osc({
              time: time + MUSIC_STEP * 0.72,
              freq: midiToHz(midi - 12),
              duration: MUSIC_STEP * 0.65,
              type: "sine",
              volume: 0.019,
              attack: 0.005,
              release: 0.08,
              bus: this.musicBus,
              music: true,
              pan: 0.34
            });
          }
        }
      }
    }

    _scheduleAdaptiveLayer(step, time, inBar, bar, chord, roots) {
      const adaptive = this.adaptiveState || {};
      const intensity = clamp(Number(adaptive.intensity) || 0, 0, 1);
      const combat = adaptive.scene === "combat" || adaptive.scene === "boss";
      const boss = adaptive.scene === "boss";
      const stage = Number(adaptive.stage) || 1;

      // Regional timbre persists during exploration and grows denser in combat.
      if (inBar === 8 && stage === 2) {
        this._osc({ time, freq: midiToHz(roots[bar] - 19), duration: MUSIC_STEP * 5.5, type: "triangle",
          volume: 0.025 + intensity * 0.018, attack: 0.04, release: 0.35, filter: 430, bus: this.musicBus, music: true });
      } else if (inBar % 8 === 3 && stage === 3) {
        this._osc({ time, freq: midiToHz(chord[(bar + inBar) % chord.length] + 24), duration: MUSIC_STEP * 1.8, type: "sine",
          volume: 0.016 + intensity * 0.012, attack: 0.006, release: 0.22, filter: 3800, bus: this.musicBus, music: true, pan: inBar === 3 ? -0.4 : 0.4 });
      } else if (inBar === 0 && stage === 4) {
        this._osc({ time, freq: midiToHz(roots[bar] - 5), duration: MUSIC_STEP * 12, type: "sine",
          volume: 0.018 + intensity * 0.012, attack: 0.28, release: 0.8, filter: 980, bus: this.musicBus, music: true });
      }

      if (!combat && adaptive.scene !== "home") return;
      if (combat && inBar % 4 === 0) this._kick(time, 0.055 + intensity * 0.08 + (boss ? 0.035 : 0), true);
      if (combat && (inBar === 4 || inBar === 12)) this._snare(time, 0.028 + intensity * 0.045, true);
      if (combat && intensity > 0.45 && inBar % 2 === 1) this._hat(time, 0.012 + intensity * 0.018, true);

      const instrument = adaptive.instrument || "guitar";
      if (instrument === "guitar" && inBar % 4 === 2) {
        this._osc({ time, freq: midiToHz(chord[(inBar / 2) % chord.length] + 12), duration: MUSIC_STEP * 1.1, type: "square",
          volume: 0.012 + intensity * 0.018, attack: 0.004, release: 0.09, filter: 2500, bus: this.musicBus, music: true, pan: 0.18 });
      } else if (instrument === "bass" && inBar % 4 === 0) {
        this._osc({ time, freq: midiToHz(roots[bar] - 24), duration: MUSIC_STEP * 2.7, type: "sawtooth",
          volume: 0.022 + intensity * 0.028, attack: 0.008, release: 0.18, filter: 390, bus: this.musicBus, music: true });
      } else if (instrument === "synth" && inBar % 2 === 0) {
        this._osc({ time, freq: midiToHz(chord[(step >> 1) % chord.length] + 24), duration: MUSIC_STEP * 0.9, type: "sine",
          volume: 0.014 + intensity * 0.016, attack: 0.003, release: 0.1, filter: 4200, bus: this.musicBus, music: true, pan: inBar % 4 ? 0.38 : -0.38 });
      } else if (instrument === "drums" && inBar % 4 === 2) {
        this._snare(time, 0.022 + intensity * 0.035, true);
      } else if (instrument === "microphone" && inBar === 0) {
        this._osc({ time, freq: midiToHz(chord[2] + 12), duration: MUSIC_STEP * 11, type: "sine",
          volume: 0.017 + intensity * 0.015, attack: 0.2, release: 0.7, filter: 1800, bus: this.musicBus, music: true, pan: -0.16 });
      } else if (instrument === "violin" && inBar % 4 === 1) {
        this._osc({ time, freq: midiToHz(chord[(bar + inBar) % chord.length] + 12), duration: MUSIC_STEP * 2.4, type: "triangle",
          volume: 0.015 + intensity * 0.02, attack: 0.035, release: 0.2, filter: 2400, bus: this.musicBus, music: true, pan: 0.24 });
      }

      if (boss && inBar === 0) {
        this._osc({ time, freq: midiToHz(roots[bar] - 31), duration: MUSIC_STEP * 13, type: "sawtooth",
          volume: 0.028, attack: 0.08, release: 0.7, filter: 330, bus: this.musicBus, music: true });
      }
    }

    previewNote(noteName) {
      if (!this._soundReady()) return false;
      const clean = String(noteName || "").trim().toUpperCase().replace(/[0-9]/g, "");
      if (!Object.prototype.hasOwnProperty.call(NOTE_MIDI, clean)) return false;
      const now = this.context.currentTime + 0.012;
      const midi = NOTE_MIDI[clean];
      this._osc({ time: now, freq: midiToHz(midi), duration: 0.64, type: "triangle", volume: 0.13, attack: 0.006, release: 0.34, filter: 2900 });
      this._osc({ time: now + 0.035, freq: midiToHz(midi + 12), duration: 0.48, type: "sine", volume: 0.055, attack: 0.004, release: 0.31, pan: 0.18 });
      return true;
    }

    /** Preview a complete composition; a new preview always cancels the previous one. */
    playMelody(melodyArray) {
      this._cancelMelodyPreview();
      const input = Array.isArray(melodyArray)
        ? melodyArray
        : typeof melodyArray === "string"
          ? melodyArray.split(/[\s,]+/)
          : [];
      // Empty input is an explicit, context-free cancellation command.
      if (!input.length) return true;
      if (!this._soundReady()) return false;
      const melody = input.slice(0, 32).map((note) => {
        const clean = String(note || "-").trim().toUpperCase().replace(/[0-9]/g, "");
        return Object.prototype.hasOwnProperty.call(NOTE_MIDI, clean) ? clean : "-";
      });
      if (!melody.length) return false;

      const startTime = this.context.currentTime + 0.035;
      const spacing = 0.24;
      melody.forEach((note, index) => {
        if (note === "-") return;
        const midi = NOTE_MIDI[note] + (index >= melody.length - 2 ? 12 : 0);
        this._osc({
          time: startTime + index * spacing,
          freq: midiToHz(midi),
          duration: 0.3,
          type: "triangle",
          volume: 0.095,
          attack: 0.006,
          release: 0.18,
          filter: 2800,
          pan: index % 2 ? 0.16 : -0.16,
          preview: true
        });
      });
      return true;
    }

    _cancelMelodyPreview() {
      this._stopSources(this._previewSources);
    }

    _soundReady() {
      if (!this._ensureContext()) return false;
      if (this.context.state === "running" && !this._needsLifecycleResume) return true;
      if (this._needsLifecycleResume) {
        if (!this._hidden && !this._lifecycleRecoveryPromise) this._recoverFromLifecycle();
        return false;
      }
      if (this.context.state !== "closed") {
        this._resumeContext(false).then((ready) => {
          if (ready) this._reconcilePlayback();
        }).catch(() => false);
      }
      // Never queue one-shots against a frozen clock; the gesture may be retried after resume.
      return this.context.state === "running";
    }

    /** Play a named one-shot. Unknown names fail silently and return false. */
    sfx(name) {
      const id = String(name || "").trim().toLowerCase();
      if (!this._soundReady()) return false;
      const t = this.context.currentTime + 0.006;
      const tone = (offset, midi, duration, type, volume, extra = {}) => this._osc({
        time: t + offset,
        freq: midiToHz(midi),
        duration,
        type,
        volume,
        ...extra
      });

      switch (id) {
        case "pickup":
          tone(0, 76, 0.13, "triangle", 0.105, { slideTo: midiToHz(79), release: 0.07 });
          tone(0.085, 83, 0.25, "sine", 0.11, { release: 0.16, pan: 0.14 });
          break;
        case "note":
          tone(0, 72, 0.34, "triangle", 0.11, { release: 0.2, pan: -0.12 });
          tone(0.075, 79, 0.42, "sine", 0.09, { release: 0.27, pan: 0.12 });
          tone(0.15, 83, 0.55, "sine", 0.075, { release: 0.38 });
          break;
        case "attack":
          this._noise({ time: t, duration: 0.115, volume: 0.095, filter: 1550, filterType: "bandpass", slideFilter: 480 });
          this._osc({ time: t, freq: 210, slideTo: 92, duration: 0.12, type: "sawtooth", volume: 0.055, release: 0.06 });
          break;
        case "hit":
          this._noise({ time: t, duration: 0.19, volume: 0.16, filter: 520, filterType: "lowpass" });
          this._osc({ time: t, freq: 118, slideTo: 48, duration: 0.23, type: "square", volume: 0.075, release: 0.13 });
          break;
        case "enemyhit":
        case "enemy_hit":
          this._noise({ time: t, duration: 0.1, volume: 0.13, filter: 1150, filterType: "bandpass" });
          this._osc({ time: t, freq: 260, slideTo: 105, duration: 0.14, type: "triangle", volume: 0.085, release: 0.075 });
          break;
        case "dodge":
          this._noise({ time: t, duration: 0.22, volume: 0.075, filter: 620, filterType: "bandpass", slideFilter: 2800, pan: 0.28 });
          this._osc({ time: t + 0.035, freq: 340, slideTo: 720, duration: 0.16, type: "sine", volume: 0.038, release: 0.1 });
          break;
        case "pulse":
          this._osc({ time: t, freq: 165, slideTo: 92, duration: 0.42, type: "sine", volume: 0.12, attack: 0.012, release: 0.28, filter: 650 });
          this._osc({ time: t + 0.035, freq: 330, slideTo: 185, duration: 0.31, type: "triangle", volume: 0.035, release: 0.22 });
          break;
        case "dialogue": {
          const speechNotes = [67, 71, 69, 74, 72];
          const speechMidi = speechNotes[this._dialogueIndex++ % speechNotes.length];
          tone(0, speechMidi, 0.052, "square", 0.032, { release: 0.025, filter: 1800 });
          break;
        }
        case "quest":
          [60, 64, 67, 74].forEach((midi, i) => tone(i * 0.105, midi, 0.31, i === 3 ? "sine" : "triangle", 0.075, { release: 0.2, pan: i % 2 ? 0.14 : -0.14 }));
          break;
        case "unlock":
          [60, 67, 71, 76].forEach((midi, i) => tone(i * 0.055, midi, 0.82, i % 2 ? "sine" : "triangle", 0.068, { attack: 0.012, release: 0.55, pan: (i - 1.5) * 0.13 }));
          break;
        case "error":
          tone(0, 54, 0.15, "square", 0.068, { slideTo: midiToHz(49), release: 0.07, filter: 900 });
          tone(0.12, 47, 0.23, "square", 0.062, { release: 0.13, filter: 760 });
          break;
        case "boss":
          this._kick(t, 0.23, false);
          this._noise({ time: t, duration: 0.7, volume: 0.11, filter: 390, filterType: "lowpass" });
          [36, 37, 43].forEach((midi, i) => tone(i * 0.08, midi, 0.78 - i * 0.09, "sawtooth", 0.055, { attack: 0.018, release: 0.42, filter: 490 }));
          break;
        case "win":
          // Original five-note cadence, intentionally unrelated to any game theme.
          [62, 69, 65, 72, 74].forEach((midi, i) => tone(i * 0.13, midi, i === 4 ? 0.75 : 0.28, i === 4 ? "sine" : "triangle", 0.082, { release: i === 4 ? 0.5 : 0.16, pan: i % 2 ? 0.12 : -0.12 }));
          break;
        case "step": {
          const alternate = this._footstepIndex++ % 2;
          this._noise({ time: t, duration: 0.055, volume: 0.026, filter: alternate ? 520 : 430, filterType: "lowpass", pan: alternate ? 0.08 : -0.08 });
          break;
        }
        default:
          return false;
      }
      return true;
    }

    _osc(options) {
      if (!this.context || !options.bus && !this.sfxBus) return null;
      const ctx = this.context;
      const time = Math.max(ctx.currentTime + 0.001, Number(options.time) || ctx.currentTime);
      const duration = Math.max(0.025, Number(options.duration) || 0.12);
      const attack = clamp(Number(options.attack) || 0.004, 0.001, duration * 0.55);
      const release = clamp(Number(options.release) || duration * 0.55, 0.012, duration * 0.92);
      const peak = clamp(Number(options.volume) || 0.04, EPSILON, 0.35);
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const nodes = [envelope];
      let tail = envelope;

      oscillator.type = options.type || "sine";
      oscillator.frequency.setValueAtTime(Math.max(20, options.freq || 220), time);
      if (options.slideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.slideTo), time + duration * 0.92);
      }
      if (options.detune) oscillator.detune.setValueAtTime(options.detune, time);

      envelope.gain.setValueAtTime(EPSILON, time);
      envelope.gain.exponentialRampToValueAtTime(peak, time + attack);
      envelope.gain.setValueAtTime(peak, Math.max(time + attack, time + duration - release));
      envelope.gain.exponentialRampToValueAtTime(EPSILON, time + duration);
      oscillator.connect(envelope);

      if (options.filter && typeof ctx.createBiquadFilter === "function") {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = options.filter;
        filter.Q.value = 0.7;
        tail.connect(filter);
        tail = filter;
        nodes.push(filter);
      }
      if (Number.isFinite(options.pan) && typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(options.pan, -1, 1);
        tail.connect(panner);
        tail = panner;
        nodes.push(panner);
      }
      tail.connect(options.bus || this.sfxBus);

      this._trackSource(oscillator, nodes, Boolean(options.music), options.preview ? this._previewSources : null);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.035);
      return oscillator;
    }

    _getNoiseBuffer() {
      if (this._noiseBuffer || !this.context) return this._noiseBuffer;
      const length = Math.ceil(this.context.sampleRate * 1.2);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < length; i += 1) {
        // Slight correlation makes softer, game-friendly noise than raw white noise.
        const white = Math.random() * 2 - 1;
        previous = previous * 0.28 + white * 0.72;
        data[i] = previous;
      }
      this._noiseBuffer = buffer;
      return buffer;
    }

    _noise(options) {
      if (!this.context || !options.bus && !this.sfxBus) return null;
      const ctx = this.context;
      const time = Math.max(ctx.currentTime + 0.001, Number(options.time) || ctx.currentTime);
      const duration = clamp(Number(options.duration) || 0.08, 0.025, 1.1);
      const peak = clamp(Number(options.volume) || 0.04, EPSILON, 0.3);
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const envelope = ctx.createGain();
      const nodes = [filter, envelope];
      let tail = envelope;

      source.buffer = this._getNoiseBuffer();
      filter.type = options.filterType || "highpass";
      filter.frequency.setValueAtTime(Math.max(40, options.filter || 1800), time);
      if (options.slideFilter) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.slideFilter), time + duration);
      }
      filter.Q.value = options.filterType === "bandpass" ? 1.1 : 0.55;
      envelope.gain.setValueAtTime(EPSILON, time);
      envelope.gain.exponentialRampToValueAtTime(peak, time + 0.004);
      envelope.gain.exponentialRampToValueAtTime(EPSILON, time + duration);
      source.connect(filter);
      filter.connect(envelope);

      if (Number.isFinite(options.pan) && typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(options.pan, -1, 1);
        tail.connect(panner);
        tail = panner;
        nodes.push(panner);
      }
      tail.connect(options.bus || this.sfxBus);

      this._trackSource(source, nodes, Boolean(options.music), options.preview ? this._previewSources : null);
      source.start(time);
      source.stop(time + duration + 0.02);
      return source;
    }

    _kick(time, volume, music) {
      this._osc({
        time,
        freq: 135,
        slideTo: 43,
        duration: 0.2,
        type: "sine",
        volume,
        attack: 0.002,
        release: 0.17,
        bus: music ? this.musicBus : this.sfxBus,
        music
      });
    }

    _hat(time, volume, music) {
      this._noise({ time, duration: 0.045, volume, filter: 5700, filterType: "highpass", bus: music ? this.musicBus : this.sfxBus, music, pan: 0.12 });
    }

    _snare(time, volume, music) {
      this._noise({ time, duration: 0.12, volume, filter: 1350, filterType: "bandpass", bus: music ? this.musicBus : this.sfxBus, music, pan: -0.08 });
      this._osc({ time, freq: 185, slideTo: 118, duration: 0.09, type: "triangle", volume: volume * 0.5, release: 0.06, bus: music ? this.musicBus : this.sfxBus, music });
    }

    _trackSource(source, nodes, music, group) {
      this._sources.add(source);
      if (music) this._musicSources.add(source);
      if (group) group.add(source);
      source.onended = () => {
        this._sources.delete(source);
        this._musicSources.delete(source);
        if (group) group.delete(source);
        try { source.disconnect(); } catch (_error) { /* already disconnected */ }
        nodes.forEach((node) => {
          try { node.disconnect(); } catch (_error) { /* already disconnected */ }
        });
      };
    }

    _stopSources(collection) {
      Array.from(collection).forEach((source) => {
        try { source.stop(); } catch (_error) { /* source may already have ended */ }
      });
      collection.clear();
    }

    /** Reset musical progress and the loop position while preserving volume settings. */
    reset() {
      if (this._disposed) return false;
      const shouldResume = this._wanted;
      this._stopScheduler(true);
      this._cancelMelodyPreview();
      this.noteCount = 0;
      this.melody = [];
      this._activeMelodyNames = [];
      this.adaptiveState = { stage: 1, scene: "exploration", intensity: 0, instrument: "guitar", resonance: "", weather: "clear", track: "" };
      this._dialogueIndex = 0;
      this._footstepIndex = 0;
      this._wanted = shouldResume;
      this._reconcilePlayback();
      return true;
    }

    /** Permanently release this instance. Calling dispose repeatedly is harmless. */
    async dispose() {
      if (this._disposed) return true;
      this._disposed = true;
      this._wanted = false;
      this._stopScheduler(true);
      this._cancelMelodyPreview();
      this._stopSources(this._sources);
      this._cancelClockCheck();
      this._lifecycleGeneration += 1;
      this._resumeGeneration += 1;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
      }
      if (typeof root.removeEventListener === "function") {
        root.removeEventListener("pagehide", this._onPageHide);
        root.removeEventListener("pageshow", this._onPageShow);
        root.removeEventListener("pointerdown", this._onUserGesture, true);
        root.removeEventListener("touchend", this._onUserGesture, true);
        root.removeEventListener("keydown", this._onUserGesture, true);
      }
      const ctx = this.context;
      this._detachContextStateHandler();
      this.context = null;
      this.master = null;
      this.musicBus = null;
      this.sfxBus = null;
      this.compressor = null;
      this._noiseBuffer = null;
      this._primedContext = null;
      this._resumePromise = null;
      this._suspendPromise = null;
      this._lifecycleRecoveryPromise = null;
      if (ctx && ctx.state !== "closed") {
        try { await ctx.close(); } catch (_error) { /* browser is already tearing down */ }
      }
      return true;
    }
  }

  const instance = new MossAudioEngine();
  // Singleton for ordinary game use; constructor remains available for tests/tools.
  root.MossAudioEngine = MossAudioEngine;
  root.MossAudio = instance;
  instance.Engine = MossAudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
