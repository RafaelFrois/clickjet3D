/**
 * Synthesized retro sound effects (Web Audio). No samples to download, tiny footprint.
 */
export type SfxName =
  | 'coin'
  | 'rainbow'
  | 'combo'
  | 'powerup'
  | 'bonusTick'
  | 'powerupEnd'
  | 'explosion'
  | 'warning'
  | 'whoosh'
  | 'chaserAppear'
  | 'lunge'
  | 'uiMove'
  | 'uiClick'
  | 'start'
  | 'pause'
  | 'highscore'
  | 'event'
  | 'gameover';

export interface SfxContext {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  pulse25: PeriodicWave;
}

type Wave = OscillatorType | 'pulse25';

function tone(s: SfxContext, t: number, freq: number, dur: number, wave: Wave, vol: number, freqEnd?: number, attack = 0.004): void {
  const { ctx } = s;
  const osc = ctx.createOscillator();
  if (wave === 'pulse25') osc.setPeriodicWave(s.pulse25);
  else osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(s.out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(s: SfxContext, t: number, dur: number, vol: number, filter: BiquadFilterType, f0: number, f1?: number, q = 0.8): void {
  const { ctx } = s;
  const src = ctx.createBufferSource();
  src.buffer = s.noise;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bq).connect(g).connect(s.out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const arp = (s: SfxContext, t: number, freqs: number[], step: number, wave: Wave, vol: number, last = step * 1.8): void => {
  freqs.forEach((f, i) => tone(s, t + i * step, f, i === freqs.length - 1 ? last : step * 1.4, wave, vol));
};

export const SFX: Record<SfxName, (s: SfxContext, t: number) => void> = {
  coin: (s, t) => {
    tone(s, t, 988, 0.06, 'square', 0.12);
    tone(s, t + 0.055, 1319, 0.16, 'square', 0.12);
  },
  rainbow: (s, t) => {
    arp(s, t, [1047, 1319, 1568, 2093], 0.045, 'square', 0.1, 0.2);
    arp(s, t + 0.02, [1568, 2093, 2637], 0.05, 'triangle', 0.1, 0.25);
  },
  combo: (s, t) => {
    tone(s, t, 880, 0.07, 'pulse25', 0.1);
    tone(s, t + 0.07, 1175, 0.14, 'pulse25', 0.1);
  },
  powerup: (s, t) => {
    tone(s, t, 300, 0.4, 'square', 0.11, 1500);
    arp(s, t + 0.3, [1047, 1319, 1568, 2093, 2637], 0.05, 'triangle', 0.12, 0.3);
  },
  bonusTick: (s, t) => tone(s, t, 1760, 0.07, 'triangle', 0.1),
  powerupEnd: (s, t) => tone(s, t, 900, 0.3, 'triangle', 0.08, 300),
  explosion: (s, t) => {
    noise(s, t, 0.9, 0.55, 'lowpass', 2800, 120, 0.7);
    tone(s, t, 120, 0.45, 'sine', 0.5, 35, 0.002);
    tone(s, t, 70, 0.5, 'square', 0.12, 30, 0.002);
  },
  warning: (s, t) => {
    tone(s, t, 740, 0.07, 'square', 0.05);
    tone(s, t + 0.11, 740, 0.07, 'square', 0.05);
  },
  whoosh: (s, t) => noise(s, t, 0.55, 0.22, 'bandpass', 500, 2400, 1.4),
  chaserAppear: (s, t) => {
    tone(s, t, 260, 0.8, 'sawtooth', 0.07, 90);
    tone(s, t, 262, 0.8, 'sawtooth', 0.05, 95);
    tone(s, t + 0.1, 520, 0.5, 'triangle', 0.05, 180);
  },
  lunge: (s, t) => tone(s, t, 330, 0.18, 'square', 0.06, 620),
  uiMove: (s, t) => tone(s, t, 520, 0.03, 'triangle', 0.08),
  uiClick: (s, t) => {
    tone(s, t, 660, 0.04, 'square', 0.08);
    tone(s, t + 0.04, 990, 0.06, 'square', 0.07);
  },
  start: (s, t) => arp(s, t, [523, 659, 784, 1047], 0.06, 'square', 0.1, 0.22),
  pause: (s, t) => {
    tone(s, t, 784, 0.06, 'square', 0.08);
    tone(s, t + 0.07, 523, 0.1, 'square', 0.08);
  },
  highscore: (s, t) => {
    arp(s, t, [523, 659, 784, 1047, 1319, 1568], 0.085, 'square', 0.1, 0.45);
    arp(s, t, [262, 330, 392, 523, 659, 784], 0.085, 'triangle', 0.12, 0.45);
  },
  event: (s, t) => {
    for (let i = 0; i < 2; i++) {
      tone(s, t + i * 0.24, 660, 0.1, 'square', 0.07);
      tone(s, t + i * 0.24 + 0.12, 880, 0.1, 'square', 0.07);
    }
  },
  gameover: (s, t) => arp(s, t + 0.35, [523, 392, 311, 262], 0.16, 'square', 0.08, 0.5),
};

export const SFX_MIN_INTERVAL: Partial<Record<SfxName, number>> = {
  coin: 0.03,
  rainbow: 0.05,
  warning: 0.3,
  whoosh: 0.35,
  bonusTick: 0.1,
  uiMove: 0.04,
  lunge: 0.25,
};
