import { Rng } from '../core/Rng';

/**
 * Procedural chiptune soundtrack. Each track is a compact definition (key, scale, chord
 * progression, groove) expanded into a 16-bar song with a repeating melodic structure
 * (A A B A' / C C' B A). No audio files needed — but file tracks are supported too
 * (see src/config/music.ts).
 */

export type ScaleName = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'harmonic';
export type DrumStyle = 'drive' | 'half' | 'break' | 'gallop';
export type BassStyle = 'pulse' | 'octave' | 'walk' | 'syncop';
export type ArpStyle = 'up' | 'updown' | 'broken' | 'none';
export type LeadWave = 'square' | 'pulse25' | 'triangle' | 'sawtooth';
export type Voice = 'lead' | 'bass' | 'arp' | 'kick' | 'snare' | 'hat';

export interface SynthTrackDef {
  id: string;
  name: string;
  bpm: number;
  /** MIDI note of the tonic (bass register). */
  root: number;
  scale: ScaleName;
  /** Scale degrees (0-based) of each chord. */
  progression: number[];
  barsPerChord: number;
  drums: DrumStyle;
  bass: BassStyle;
  arp: ArpStyle;
  lead: LeadWave;
  seed: number;
  /** Times the 16-bar song loops before the next track. */
  loops: number;
}

export interface NoteEvent {
  step: number;
  dur: number;
  midi: number;
  voice: Voice;
  vel: number;
}

export interface Song {
  def: SynthTrackDef;
  steps: number;
  stepDur: number;
  /** Events grouped by step index for O(1) scheduling. */
  byStep: NoteEvent[][];
}

const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

export function degreeToMidi(root: number, scale: ScaleName, degree: number): number {
  const s = SCALES[scale];
  const oct = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return root + oct * 12 + s[idx];
}

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const BARS = 16;
const STEPS_PER_BAR = 16;

const RHYTHMS: number[][] = [
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  [1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0],
  [0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0],
];

interface MotifNote {
  step: number;
  dur: number;
  deg: number;
}

function chordDegreeAt(def: SynthTrackDef, bar: number): number {
  return def.progression[Math.floor(bar / def.barsPerChord) % def.progression.length];
}

function nearestChordTone(deg: number, chordRoot: number): number {
  let best = deg;
  let bestDist = Infinity;
  for (let o = -2; o <= 3; o++) {
    for (const t of [0, 2, 4]) {
      const c = chordRoot + t + o * 7;
      const d = Math.abs(c - deg);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  }
  return best;
}

function makeMotif(rng: Rng, def: SynthTrackDef, startBar: number, center: number): MotifNote[] {
  const notes: MotifNote[] = [];
  let deg = nearestChordTone(center, chordDegreeAt(def, startBar));
  for (let b = 0; b < 2; b++) {
    const rhythm = rng.pick(RHYTHMS);
    const onsets: number[] = [];
    rhythm.forEach((v, i) => v && onsets.push(i));
    onsets.forEach((s, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : STEPS_PER_BAR;
      const dur = Math.min(4, next - s);
      const step = b * STEPS_PER_BAR + s;
      if (s % 8 === 0) deg = nearestChordTone(deg + rng.int(-2, 2), chordDegreeAt(def, startBar + b));
      else deg += rng.pick([-2, -1, -1, 1, 1, 2]);
      deg = Math.max(center - 5, Math.min(center + 6, deg));
      notes.push({ step, dur, deg });
    });
  }
  return notes;
}

/** Re-harmonizes a motif over the chords of the bars it's placed on. */
function placeMotif(out: NoteEvent[], motif: MotifNote[], def: SynthTrackDef, bar: number, transpose: number, variant: boolean, rng: Rng): void {
  for (const n of motif) {
    let deg = n.deg + transpose;
    const b = bar + Math.floor(n.step / STEPS_PER_BAR);
    if (n.step % 8 === 0) deg = nearestChordTone(deg, chordDegreeAt(def, b));
    if (variant && n.step >= STEPS_PER_BAR && rng.chance(0.5)) deg += rng.pick([-2, 2, 1]);
    out.push({ step: bar * STEPS_PER_BAR + n.step, dur: n.dur, midi: degreeToMidi(def.root + 24, def.scale, deg), voice: 'lead', vel: n.step % 4 === 0 ? 1 : 0.8 });
  }
}

export function generateSong(def: SynthTrackDef): Song {
  const rng = new Rng(def.seed);
  const events: NoteEvent[] = [];
  const motifA = makeMotif(rng, def, 0, 2);
  const motifB = makeMotif(rng, def, 4, 4);
  const motifC = makeMotif(rng, def, 8, 6);

  // Melody structure over 16 bars (8 two-bar slots). The first slot is an intro (no lead).
  const plan: [MotifNote[] | null, number, boolean][] = [
    [null, 0, false],
    [motifA, 0, true],
    [motifB, 0, false],
    [motifA, 0, true],
    [motifC, 0, false],
    [motifC, 0, true],
    [motifB, 2, false],
    [motifA, 0, true],
  ];
  plan.forEach(([motif, tr, variant], slot) => motif && placeMotif(events, motif, def, slot * 2, tr, variant, rng));

  for (let bar = 0; bar < BARS; bar++) {
    const base = bar * STEPS_PER_BAR;
    const chord = chordDegreeAt(def, bar);
    const rootMidi = degreeToMidi(def.root, def.scale, chord);
    const third = degreeToMidi(def.root, def.scale, chord + 2);
    const fifth = degreeToMidi(def.root, def.scale, chord + 4);

    // Bass
    const bass = (step: number, dur: number, midi: number, vel = 1) => events.push({ step: base + step, dur, midi, voice: 'bass', vel });
    switch (def.bass) {
      case 'pulse':
        for (let s = 0; s < 16; s += 2) bass(s, 2, rootMidi, s % 4 === 0 ? 1 : 0.75);
        break;
      case 'octave':
        for (let s = 0; s < 16; s += 2) bass(s, 2, s % 4 === 0 ? rootMidi : rootMidi + 12, 0.9);
        break;
      case 'walk':
        [rootMidi, third, fifth, bar % 2 ? fifth + 2 : third].forEach((m, i) => bass(i * 4, 4, m));
        break;
      case 'syncop':
        [0, 3, 6, 8, 11, 14].forEach((s, i) => bass(s, s === 6 || s === 14 ? 2 : 3, i === 4 ? fifth : rootMidi));
        break;
    }

    // Arpeggio (quiet sparkle, two octaves up)
    if (def.arp !== 'none' && bar % 8 !== 0) {
      const tones = [rootMidi, third, fifth, rootMidi + 12].map((m) => m + 24);
      const order =
        def.arp === 'up' ? [0, 1, 2, 3] : def.arp === 'updown' ? [0, 1, 2, 3, 2, 1] : [0, 2, 1, 2, 3, 2];
      for (let s = 0; s < 16; s += 2) events.push({ step: base + s, dur: 1, midi: tones[order[(s / 2) % order.length]], voice: 'arp', vel: 1 });
    }

    // Drums
    const hit = (voice: Voice, step: number, vel = 1) => events.push({ step: base + step, dur: 1, midi: 0, voice, vel });
    const fill = bar % 4 === 3;
    switch (def.drums) {
      case 'drive':
        [0, 4, 8, 12].forEach((s) => hit('kick', s));
        [4, 12].forEach((s) => hit('snare', s));
        for (let s = 2; s < 16; s += 4) hit('hat', s, 1);
        for (let s = 0; s < 16; s += 4) hit('hat', s, 0.5);
        break;
      case 'half':
        [0, 10].forEach((s) => hit('kick', s));
        hit('snare', 8);
        for (let s = 0; s < 16; s += 2) hit('hat', s, s % 4 === 2 ? 0.9 : 0.5);
        break;
      case 'break':
        [0, 6, 10].forEach((s) => hit('kick', s));
        [4, 12].forEach((s) => hit('snare', s));
        for (let s = 0; s < 16; s++) hit('hat', s, s % 2 ? 0.35 : 0.7);
        break;
      case 'gallop':
        [0, 3, 8, 11].forEach((s) => hit('kick', s));
        [4, 12].forEach((s) => hit('snare', s));
        for (let s = 0; s < 16; s += 2) hit('hat', s, 0.7);
        break;
    }
    if (fill) [13, 14, 15].forEach((s) => hit('snare', s, 0.6));
  }

  const steps = BARS * STEPS_PER_BAR;
  const byStep: NoteEvent[][] = Array.from({ length: steps }, () => []);
  for (const e of events) byStep[e.step % steps].push(e);
  return { def, steps, stepDur: 60 / def.bpm / 4, byStep };
}

export const SYNTH_TRACKS: SynthTrackDef[] = [
  { id: 'liftoff', name: 'LIFTOFF', bpm: 138, root: 48, scale: 'major', progression: [0, 4, 5, 3], barsPerChord: 1, drums: 'drive', bass: 'octave', arp: 'up', lead: 'square', seed: 11, loops: 3 },
  { id: 'nebula', name: 'NEBULA DRIFT', bpm: 108, root: 45, scale: 'minor', progression: [0, 5, 2, 6], barsPerChord: 2, drums: 'half', bass: 'syncop', arp: 'updown', lead: 'triangle', seed: 23, loops: 2 },
  { id: 'asteroid', name: 'ASTEROID RUN', bpm: 152, root: 52, scale: 'minor', progression: [0, 0, 5, 6], barsPerChord: 1, drums: 'gallop', bass: 'pulse', arp: 'broken', lead: 'pulse25', seed: 37, loops: 3 },
  { id: 'menace', name: 'PURPLE MENACE', bpm: 126, root: 50, scale: 'harmonic', progression: [0, 3, 4, 0], barsPerChord: 1, drums: 'break', bass: 'walk', arp: 'broken', lead: 'sawtooth', seed: 51, loops: 3 },
  { id: 'coinrush', name: 'COIN RUSH', bpm: 128, root: 53, scale: 'mixolydian', progression: [0, 6, 3, 0], barsPerChord: 1, drums: 'drive', bass: 'syncop', arp: 'up', lead: 'pulse25', seed: 67, loops: 3 },
];
