import { MUSIC_TRACKS, trackName, type MusicTrackConfig } from '../config/music';
import { ShuffleBag } from '../core/ShuffleBag';
import type { SaveManager } from '../save/SaveManager';
import { generateSong, midiToFreq, type NoteEvent, type Song } from './music';
import { SFX, SFX_MIN_INTERVAL, type SfxName, type SfxContext } from './sfx';

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

interface ChaserVoice {
  level: GainNode;
  pan: StereoPannerNode;
  lfo: OscillatorNode;
  filter: BiquadFilterNode;
}

/**
 * Audio Manager: music playlist (shuffle, no immediate repeats), SFX, volumes, mute
 * (persisted), pause ducking, and the chaser's proximity "signature" hum.
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 */
export class AudioManager {
  onTrackChange: (name: string) => void = () => {};
  currentTrackName = '';

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicDuck!: GainNode;
  private sfxBus!: GainNode;
  private sfxCtx!: SfxContext;
  private pulse12!: PeriodicWave;
  private readonly bag: ShuffleBag<MusicTrackConfig>;
  private readonly songCache = new Map<string, Song>();
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private song: Song | null = null;
  private step = 0;
  private loopsLeft = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fileSource: AudioBufferSourceNode | null = null;
  private trackToken = 0;
  private readonly lastPlayed = new Map<SfxName, number>();
  private chaser: ChaserVoice | null = null;
  private paused = false;

  constructor(
    private readonly save: SaveManager,
    tracks: MusicTrackConfig[] = MUSIC_TRACKS,
  ) {
    this.bag = new ShuffleBag(tracks);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get muted(): boolean {
    return this.save.settings.muted;
  }

  /** Call from a user gesture. Creates/resumes the context and starts the music. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
    if (!this.song && !this.fileSource) this.nextTrack();
  }

  private build(): void {
    const ctx = this.ctx as AudioContext;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicDuck = ctx.createGain();
    this.musicBus.connect(this.musicDuck).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.applyVolumes(true);

    const len = ctx.sampleRate;
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.sfxCtx = { ctx, out: this.sfxBus, noise, pulse25: this.pulseWave(0.25) };
    this.pulse12 = this.pulseWave(0.125);
  }

  private pulseWave(duty: number): PeriodicWave {
    const ctx = this.ctx as AudioContext;
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
      imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
    }
    return ctx.createPeriodicWave(real, imag);
  }

  /* ----------------------------- Volume / mute ---------------------------- */

  applyVolumes(instant = false): void {
    if (!this.ctx) return;
    const s = this.save.settings;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => (instant ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.05));
    set(this.master.gain, s.muted ? 0 : 1);
    set(this.musicBus.gain, s.musicVolume * 0.55);
    set(this.sfxBus.gain, s.sfxVolume);
    set(this.musicDuck.gain, this.paused ? 0.3 : 1);
  }

  setMuted(muted: boolean): void {
    this.save.updateSettings({ muted });
    this.applyVolumes();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMusicVolume(v: number): void {
    this.save.updateSettings({ musicVolume: v });
    this.applyVolumes();
  }

  setSfxVolume(v: number): void {
    this.save.updateSettings({ sfxVolume: v });
    this.applyVolumes();
  }

  /** Pause ducks the music and silences the chaser; resume restores. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.setChaser(0, 0);
    this.applyVolumes();
  }

  /** Page hidden → suspend everything; visible → resume. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /* --------------------------------- SFX ---------------------------------- */

  play(name: SfxName, pan = 0): void {
    if (!this.ready || this.muted) return;
    const now = this.ctx!.currentTime;
    const min = SFX_MIN_INTERVAL[name] ?? 0;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < min) return;
    this.lastPlayed.set(name, now);
    if (pan !== 0) {
      const p = this.ctx!.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.sfxBus);
      SFX[name]({ ...this.sfxCtx, out: p }, now);
      setTimeout(() => p.disconnect(), 2000);
    } else {
      SFX[name](this.sfxCtx, now);
    }
  }

  /** Continuous tension hum for the purple chaser: louder and faster when close. */
  setChaser(level: number, pan: number): void {
    if (!this.ready) return;
    const ctx = this.ctx as AudioContext;
    if (!this.chaser) {
      if (level <= 0.001) return;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 55;
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 82.6;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      filter.Q.value = 6;
      const trem = ctx.createGain();
      trem.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(trem.gain);
      const mix = ctx.createGain();
      mix.gain.value = 0.35;
      o1.connect(mix);
      o2.connect(mix);
      const levelGain = ctx.createGain();
      levelGain.gain.value = 0;
      const panner = ctx.createStereoPanner();
      mix.connect(filter).connect(trem).connect(levelGain).connect(panner).connect(this.sfxBus);
      o1.start();
      o2.start();
      lfo.start();
      this.chaser = { level: levelGain, pan: panner, lfo, filter };
    }
    const t = ctx.currentTime;
    const l = Math.max(0, Math.min(1, level));
    this.chaser.level.gain.setTargetAtTime(l * l * 0.5, t, 0.12);
    this.chaser.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
    this.chaser.lfo.frequency.setTargetAtTime(2.5 + l * 9, t, 0.2);
    this.chaser.filter.frequency.setTargetAtTime(260 + l * 700, t, 0.2);
  }

  /* -------------------------------- Music --------------------------------- */

  /** Skips to the next track of the shuffle bag. */
  nextTrack(): void {
    if (!this.ctx) return;
    this.stopMusic();
    const track = this.bag.next();
    const token = ++this.trackToken;
    this.currentTrackName = trackName(track);
    this.onTrackChange(this.currentTrackName);
    if (track.kind === 'synth') {
      let song = this.songCache.get(track.def.id);
      if (!song) {
        song = generateSong(track.def);
        this.songCache.set(track.def.id, song);
      }
      this.song = song;
      this.step = 0;
      this.loopsLeft = track.def.loops;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.tick(), TICK_MS);
    } else {
      void this.playFile(track, token);
    }
  }

  private stopMusic(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
    if (this.fileSource) {
      this.fileSource.onended = null;
      try {
        this.fileSource.stop();
      } catch {
        /* already stopped */
      }
      this.fileSource = null;
    }
  }

  private async playFile(track: { name: string; url: string }, token: number): Promise<void> {
    const ctx = this.ctx as AudioContext;
    try {
      let buffer = this.bufferCache.get(track.url);
      if (!buffer) {
        const res = await fetch(track.url);
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        this.bufferCache.set(track.url, buffer);
      }
      if (token !== this.trackToken) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.musicBus);
      src.onended = () => token === this.trackToken && this.nextTrack();
      src.start();
      this.fileSource = src;
    } catch {
      if (token === this.trackToken) setTimeout(() => this.nextTrack(), 200);
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song) return;
    // After a long suspension, don't try to catch up on missed notes.
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      for (const ev of song.byStep[this.step]) this.playNote(ev, this.nextTime, song);
      this.nextTime += song.stepDur;
      this.step++;
      if (this.step >= song.steps) {
        this.step = 0;
        this.loopsLeft--;
        if (this.loopsLeft <= 0) {
          // Short breath, then the next song.
          const wait = Math.max(0, (this.nextTime - ctx.currentTime) * 1000) + 600;
          this.stopMusic();
          const token = this.trackToken;
          setTimeout(() => token === this.trackToken && this.nextTrack(), wait);
          return;
        }
      }
    }
  }

  private playNote(ev: NoteEvent, t: number, song: Song): void {
    const ctx = this.ctx as AudioContext;
    const out = this.musicBus;
    const dur = ev.dur * song.stepDur;
    switch (ev.voice) {
      case 'lead':
      case 'bass':
      case 'arp': {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        let vol: number;
        let release: number;
        if (ev.voice === 'lead') {
          const w = song.def.lead;
          if (w === 'pulse25') osc.setPeriodicWave(this.sfxCtx.pulse25);
          else osc.type = w;
          vol = (w === 'triangle' ? 0.2 : w === 'sawtooth' ? 0.07 : 0.085) * ev.vel;
          release = 0.05;
          if (dur > 0.25) {
            // Tiny pitch lift on long notes for a livelier chiptune lead.
            osc.detune.setValueAtTime(0, t + 0.12);
            osc.detune.linearRampToValueAtTime(12, t + dur);
          }
        } else if (ev.voice === 'bass') {
          osc.type = 'triangle';
          vol = 0.26 * ev.vel;
          release = 0.03;
        } else {
          osc.setPeriodicWave(this.pulse12);
          vol = 0.028;
          release = 0.02;
        }
        osc.frequency.setValueAtTime(midiToFreq(ev.midi), t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.006);
        g.gain.setValueAtTime(vol * 0.75, t + Math.max(0.01, dur * 0.7));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + dur + release + 0.02);
        break;
      }
      case 'kick': {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.42 * ev.vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.18);
        break;
      }
      case 'snare':
      case 'hat': {
        const src = ctx.createBufferSource();
        src.buffer = this.sfxCtx.noise;
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        const snare = ev.voice === 'snare';
        f.type = snare ? 'bandpass' : 'highpass';
        f.frequency.value = snare ? 1800 : 7000;
        f.Q.value = snare ? 0.7 : 0.5;
        const len = snare ? 0.13 : 0.035;
        g.gain.setValueAtTime((snare ? 0.2 : 0.05) * ev.vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        src.connect(f).connect(g).connect(out);
        src.start(t, Math.random() * 0.5);
        src.stop(t + len + 0.02);
        break;
      }
    }
  }
}
