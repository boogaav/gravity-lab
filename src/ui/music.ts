/**
 * Optional piano soundtrack — three short ORIGINAL compositions generated
 * procedurally with the Web Audio API (no audio assets, no external requests).
 * This is presentation-layer ambience chosen by the user; it is not physics
 * sonification and has no connection to the simulation state.
 */

export type TrackId = 'off' | 'elegy' | 'tempest' | 'adrift';

interface Chord {
  bass: number; // midi
  notes: number[]; // midi chord tones, low → high
}

interface TrackDef {
  name: string;
  stepDur: number; // seconds per step
  stepsPerChord: number;
  gain: number;
  progression: Chord[];
  schedule: (
    local: number,
    chord: Chord,
    t: number,
    stepDur: number,
    play: (t: number, midi: number, vel: number, dur: number) => void,
  ) => void;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const TRACKS: Record<Exclude<TrackId, 'off'>, TrackDef> = {
  elegy: {
    name: 'Elegy',
    stepDur: 0.3,
    stepsPerChord: 12,
    gain: 1.0,
    progression: [
      { bass: 45, notes: [57, 60, 64, 69] }, // Am
      { bass: 41, notes: [57, 60, 65, 69] }, // F
      { bass: 38, notes: [57, 62, 65, 69] }, // Dm
      { bass: 40, notes: [56, 59, 64, 68] }, // E
    ],
    schedule(local, chord, t, stepDur, play) {
      if (local === 0) {
        play(t, chord.bass, 0.42, stepDur * 12);
        play(t, chord.bass - 12, 0.34, stepDur * 12);
      }
      const seq = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1];
      const swell = 0.26 + 0.1 * Math.sin((local / 12) * Math.PI);
      play(t, chord.notes[seq[local]], swell + (local === 0 ? 0.12 : 0), stepDur * 2.8);
      if (local === 6) play(t, chord.notes[3] + 12, 0.2, stepDur * 4); // high echo
    },
  },
  tempest: {
    name: 'Tempest',
    stepDur: 0.115,
    stepsPerChord: 16,
    gain: 0.9,
    progression: [
      { bass: 38, notes: [50, 53, 57, 62] }, // Dm
      { bass: 34, notes: [50, 53, 58, 62] }, // Bb
      { bass: 31, notes: [50, 55, 58, 62] }, // Gm
      { bass: 33, notes: [49, 52, 57, 61] }, // A
    ],
    schedule(local, chord, t, stepDur, play) {
      if (local === 0 || local === 8) {
        play(t, chord.bass - 12, 0.5, stepDur * 8);
        play(t, chord.bass, 0.4, stepDur * 8);
      }
      const climb = [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0][local];
      const midi = chord.notes[climb % 4] + Math.floor(climb / 4) * 12;
      const accent = local % 4 === 0 ? 0.14 : 0;
      play(t, midi, 0.24 + accent, stepDur * 2.2);
    },
  },
  adrift: {
    name: 'Adrift',
    stepDur: 0.55,
    stepsPerChord: 8,
    gain: 1.1,
    progression: [
      { bass: 40, notes: [52, 59, 62, 66, 71] }, // Em9
      { bass: 36, notes: [52, 55, 59, 64, 71] }, // Cmaj7
      { bass: 33, notes: [52, 57, 60, 64, 67] }, // Am7
      { bass: 35, notes: [54, 57, 59, 63, 66] }, // B7
    ],
    schedule(local, chord, t, stepDur, play) {
      if (local === 0) {
        play(t, chord.bass - 12, 0.32, stepDur * 8);
        play(t, chord.notes[0], 0.2, stepDur * 7);
        play(t, chord.notes[1], 0.18, stepDur * 7);
      }
      if (local === 3) play(t, chord.notes[4], 0.24, stepDur * 5);
      if (local === 5) play(t, chord.notes[3], 0.18, stepDur * 4);
      if (local === 6 && Math.random() < 0.5) play(t, chord.notes[2] + 12, 0.13, stepDur * 4);
    },
  },
};

let ctx: AudioContext | null = null;
let input: GainNode | null = null;
let current: TrackId = 'off';
let timer: number | null = null;
let step = 0;
let nextTime = 0;

function makeReverbImpulse(c: AudioContext, seconds = 2.6): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
  }
  return buf;
}

function ensureAudio(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  input = ctx.createGain();
  input.gain.value = 1;
  const master = ctx.createGain();
  master.gain.value = 0.3;
  const conv = ctx.createConvolver();
  conv.buffer = makeReverbImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  input.connect(master);
  input.connect(conv);
  conv.connect(wet);
  wet.connect(master);
  master.connect(ctx.destination);
  return ctx;
}

/** One synthesized piano-ish note: layered partials with a fast attack and exponential decay. */
function playNote(t: number, midi: number, vel: number, dur: number): void {
  if (!ctx || !input) return;
  // gentle humanization
  const time = Math.max(t + (Math.random() - 0.5) * 0.012, ctx.currentTime);
  const v = vel * (0.9 + Math.random() * 0.2);
  const f = midiHz(midi);
  const partials: Array<[number, number]> = [[1, 1], [2.001, 0.32], [2.997, 0.13], [4.01, 0.05]];
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.001), time + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(dur, 0.1));
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 60) / 30));
  g.connect(pan);
  pan.connect(input);
  for (const [mult, amp] of partials) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mult;
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og);
    og.connect(g);
    o.start(time);
    o.stop(time + Math.max(dur, 0.1) + 0.05);
  }
}

function tick(): void {
  if (!ctx || current === 'off') return;
  const def = TRACKS[current];
  const horizon = ctx.currentTime + 0.6;
  while (nextTime < horizon) {
    const chordIdx = Math.floor(step / def.stepsPerChord) % def.progression.length;
    const local = step % def.stepsPerChord;
    const t = nextTime;
    def.schedule(local, def.progression[chordIdx], t, def.stepDur, (tt, m, vel, dur) =>
      playNote(tt, m, vel * def.gain, dur),
    );
    nextTime += def.stepDur;
    step++;
  }
}

export function setTrack(id: TrackId): void {
  if (id === current) return;
  const c = ensureAudio();
  void c.resume(); // called from a user gesture
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  const now = c.currentTime;
  // fade out anything already scheduled, then bring the input back for the new track
  input!.gain.cancelScheduledValues(now);
  input!.gain.setValueAtTime(input!.gain.value, now);
  input!.gain.linearRampToValueAtTime(0, now + 0.2);
  current = id;
  if (id !== 'off') {
    input!.gain.setValueAtTime(0, now + 0.24);
    input!.gain.linearRampToValueAtTime(1, now + 0.5);
    step = 0;
    nextTime = now + 0.3;
    tick();
    timer = window.setInterval(tick, 120);
  }
}

export function currentTrack(): TrackId {
  return current;
}

export const TRACK_LABELS: Array<{ id: TrackId; label: string }> = [
  { id: 'off', label: '♪ music: off' },
  { id: 'elegy', label: '♪ Elegy — slow & minor' },
  { id: 'tempest', label: '♪ Tempest — driving' },
  { id: 'adrift', label: '♪ Adrift — sparse' },
];
