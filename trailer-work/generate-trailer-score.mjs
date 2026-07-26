import { writeFileSync } from 'node:fs';

const sampleRate = 48000;
const duration = 44;
const channels = 2;
const frames = Math.floor(sampleRate * duration);
const pcm = Buffer.alloc(frames * channels * 2);
const beat = 60 / 110;
const step = beat / 2;
const tau = Math.PI * 2;
const progression = [
  [40, 47, 52, 55], // E minor
  [36, 43, 48, 52], // C major
  [43, 50, 55, 59], // G major
  [38, 45, 50, 54]  // D major
];
const motif = [60, 64, 67, 71, 67, 64, 71, 72]; // C E G B
const transitions = [3.6, 9.2, 11.6, 15.6, 19.6, 24.0, 31.6, 35.6, 38.8];
let noiseState = 0x5eeda11;

function midi(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function fract(value) {
  return value - Math.floor(value);
}

function noise() {
  noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
  return noiseState / 2147483648 - 1;
}

function pulseEnvelope(local, attack, decay) {
  if (local < 0 || local > decay) return 0;
  return Math.min(1, local / attack) * Math.exp(-local * 4.5 / decay);
}

function sectionGain(time) {
  if (time < 2.4) return 0.28 + time * 0.06;
  if (time < 9.4) return 0.72;
  if (time < 24) return 0.88;
  if (time < 31.8) return 0.68;
  if (time < 39) return 1;
  return Math.max(0, 1 - (time - 39) / 5);
}

function transitionFx(time, channel) {
  let value = 0;
  for (const hitTime of transitions) {
    const before = time - (hitTime - 1.05);
    if (before >= 0 && before < 1.05) {
      const rise = before / 1.05;
      value += Math.sin(tau * (180 + rise * rise * 1050) * before + channel * 0.4) * rise * rise * 0.055;
      value += noise() * rise * rise * 0.028;
    }
    const after = time - hitTime;
    if (after >= 0 && after < 0.7) {
      value += Math.sin(tau * (48 - after * 18) * after) * Math.exp(-after * 7) * 0.36;
    }
  }
  return value;
}

for (let frame = 0; frame < frames; frame++) {
  const time = frame / sampleRate;
  const gain = sectionGain(time);
  const barIndex = Math.floor(time / (beat * 4));
  const chord = progression[barIndex % progression.length];
  const beatIndex = Math.floor(time / beat);
  const beatPhase = time - beatIndex * beat;
  const stepIndex = Math.floor(time / step);
  const stepPhase = time - stepIndex * step;
  const barBeat = beatIndex % 4;

  let padLeft = 0;
  let padRight = 0;
  for (let voice = 0; voice < chord.length; voice++) {
    const frequency = midi(chord[voice]);
    const drift = Math.sin(time * 0.17 + voice) * 0.002;
    const tone = Math.sin(tau * frequency * (1 + drift) * time + voice * 0.8);
    const shimmer = Math.sin(tau * frequency * 2.003 * time + voice) * 0.23;
    padLeft += (tone + shimmer) * (voice % 2 ? 0.8 : 1);
    padRight += (tone + shimmer) * (voice % 2 ? 1 : 0.78);
  }
  const introSwell = Math.min(1, time / 2.5);
  padLeft *= 0.036 * introSwell;
  padRight *= 0.036 * introSwell;

  const bassFrequency = midi(chord[0] - 12);
  const bassEnv = pulseEnvelope(beatPhase, 0.012, beat * 0.92);
  const bassPhase = fract(bassFrequency * time);
  const bass = (Math.sin(tau * bassPhase) * 0.7 + (bassPhase * 2 - 1) * 0.3) * bassEnv * 0.15;

  const arpNote = chord[stepIndex % chord.length] + 12 + (stepIndex % 8 >= 4 ? 12 : 0);
  const arpFrequency = midi(arpNote);
  const arpEnv = pulseEnvelope(stepPhase, 0.008, step * 0.88);
  const arp = (Math.sin(tau * arpFrequency * time) + Math.sin(tau * arpFrequency * 2 * time) * 0.22) * arpEnv * 0.105;
  const arpPan = Math.sin(stepIndex * 1.9) * 0.34;

  const motifActive = (time > 9 && time < 24) || (time > 31.5 && time < 39);
  const motifNote = motif[stepIndex % motif.length] + (time > 31.5 ? 12 : 0);
  const leadFrequency = midi(motifNote);
  const leadEnv = motifActive ? pulseEnvelope(stepPhase, 0.014, step * 0.82) : 0;
  const lead = (Math.sin(tau * leadFrequency * time) * 0.75 +
    Math.sin(tau * leadFrequency * 2.01 * time) * 0.2 +
    Math.sin(tau * leadFrequency * 3.99 * time) * 0.08) * leadEnv * 0.12;
  const leadPan = Math.sin(time * 0.73) * 0.42;

  const drumsActive = time > 3.25;
  const kick = drumsActive
    ? Math.sin(tau * (46 + 92 * Math.exp(-beatPhase * 26)) * beatPhase) * Math.exp(-beatPhase * 16) * 0.48
    : 0;
  const snarePhase = barBeat === 1 || barBeat === 3 ? beatPhase : 10;
  const snare = drumsActive && snarePhase < 0.22
    ? (noise() * 0.72 + Math.sin(tau * 185 * snarePhase) * 0.28) * Math.exp(-snarePhase * 24) * 0.21
    : 0;
  const hat = drumsActive
    ? noise() * Math.exp(-stepPhase * 92) * (stepIndex % 2 ? 0.055 : 0.08)
    : 0;

  const subPulse = time > 31.5 && beatIndex % 2 === 0
    ? Math.sin(tau * 34 * beatPhase) * Math.exp(-beatPhase * 9) * 0.11
    : 0;
  const fxLeft = transitionFx(time, 0);
  const fxRight = transitionFx(time, 1);

  let left = padLeft + bass + arp * (1 - arpPan) + lead * (1 - leadPan) + kick + snare + hat + subPulse + fxLeft;
  let right = padRight + bass + arp * (1 + arpPan) + lead * (1 + leadPan) + kick + snare * 0.94 + hat * 0.9 + subPulse + fxRight;

  left = Math.tanh(left * gain * 1.25) * 0.88;
  right = Math.tanh(right * gain * 1.25) * 0.88;
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left * 32767))), frame * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right * 32767))), frame * 4 + 2);
}

const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channels * 2, 28);
wav.writeUInt16LE(channels * 2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
writeFileSync(new URL('./trailer-score.wav', import.meta.url), wav);
console.log(`Wrote ${duration}s original trailer score (${(wav.length / 1048576).toFixed(1)} MB)`);
