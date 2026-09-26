import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../input/InputManager';
import { CameraController } from '../render/CameraController';
import { Effects } from '../render/Effects';
import { Models } from '../render/Models';
import { ParticleSystem } from '../render/ParticleSystem';
import { QualityManager, QUALITY_PRESETS } from '../render/Quality';
import { sharedUniforms } from '../render/shared';
import { SpaceBackground } from '../render/SpaceBackground';
import { SaveManager } from '../save/SaveManager';
import { GameSession } from '../systems/GameSession';
import { UIManager } from '../ui/UIManager';
import type { IndicatorTarget } from '../world/World';
import { World } from '../world/World';
import { EventBus } from './EventBus';
import type { GameEvents } from './events';
import { clamp } from './math';
import { Rng } from './Rng';
import type { GameStateId, MoveCommand, QualityLevel, UIAction } from './types';

const SIM_STEP = 1 / 60;
const DYING_TIME = 1.15;

export interface GameOptions {
  debug: boolean;
  god: boolean;
  seed?: number;
  /** QA: start runs at this survival time (difficulty). */
  startTime: number;
}

/**
 * Top-level orchestrator: owns every manager, drives the state machine
 * (MENU → PLAYING ⇄ PAUSED → DYING → GAME OVER) and the frame loop, and wires game
 * events to UI, audio and effects. Gameplay rules live in GameSession / World.
 */
export class GameManager {
  state: GameStateId = 'boot';
  readonly bus = new EventBus<GameEvents>();
  readonly save = new SaveManager();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: CameraController;
  readonly models = new Models();
  readonly particles = new ParticleSystem(1800);
  readonly world: World;
  readonly session: GameSession;
  readonly effects: Effects;
  readonly background: SpaceBackground;
  readonly audio: AudioManager;
  readonly ui: UIManager;
  readonly input: InputManager;
  readonly quality: QualityManager;

  private last = 0;
  private dyingTimer = 0;
  private hitStop = 0;
  private gameOverAt = 0;
  private renderedPaused = false;
  private needsRender = true;
  private width = 1;
  private height = 1;
  private hudTop = 70;
  private readonly indicatorTargets: IndicatorTarget[] = [];
  private readonly subCmd: MoveCommand = { kind: 'none', x: 0, z: 0 };
  private readonly projectFn = (x: number, y: number, z: number, out: { x: number; y: number }) =>
    this.camera.project(x, y, z, this.width, this.height, out);
  private chaserWarning: { x: number; z: number; t: number } | null = null;
  private realTime = 0;
  private debugVisible: boolean;
  private coinsThisRun = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly opts: GameOptions,
  ) {
    const settings = this.save.settings;
    this.quality = new QualityManager(settings.quality);
    this.debugVisible = opts.debug || settings.showFps;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.level !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setClearColor(0x05030f, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new CameraController(window.innerWidth / Math.max(1, window.innerHeight));
    this.camera.shakeEnabled = settings.screenShake;

    // Simple, readable lighting: sky/ground ambient + one key light + soft rim.
    this.scene.add(new THREE.HemisphereLight(0xd6e2ff, 0x3a2560, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 10, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9a7bff, 1.1);
    rim.position.set(-6, 3, -8);
    this.scene.add(rim);

    this.background = new SpaceBackground(this.scene, this.models, this.quality.level === 'low' ? 1024 : 2048);
    this.world = new World(this.models, this.particles, new Rng(opts.seed));
    this.world.invulnerable = opts.god;
    this.scene.add(this.world.root);
    this.effects = new Effects(this.models, this.particles);
    this.scene.add(this.effects.group, this.particles.points);
    this.session = new GameSession(this.world, this.bus, this.save);

    this.audio = new AudioManager(this.save);
    this.audio.onTrackChange = (name) => this.ui.trackToast(name);

    this.ui = new UIManager({
      play: () => this.play(),
      resume: () => this.resume(),
      pause: () => this.pause(),
      restart: () => this.restart(),
      menu: () => this.toMenu(),
      toggleMute: () => this.ui.setMuteIcon(this.audio.toggleMute()),
      nextTrack: () => this.audio.nextTrack(),
      openSettings: () => this.ui.openSettings(this.save.settings),
      closeSettings: () => this.ui.closeSettings(),
      setMusicVolume: (v) => this.audio.setMusicVolume(v),
      setSfxVolume: (v) => {
        this.audio.setSfxVolume(v);
        this.audio.play('coin');
      },
      setQuality: (q) => {
        this.save.updateSettings({ quality: q });
        this.quality.set(q);
      },
      setShake: (on) => {
        this.save.updateSettings({ screenShake: on });
        this.camera.shakeEnabled = on;
      },
      setTouchMode: (m) => this.save.updateSettings({ touchMode: m }),
      setShowFps: (on) => {
        this.save.updateSettings({ showFps: on });
        this.debugVisible = this.opts.debug || on;
        if (!this.debugVisible) this.ui.debug(null);
      },
      uiSound: (k) => this.audio.play(k === 'move' ? 'uiMove' : 'uiClick'),
    });
    this.ui.setMuteIcon(settings.muted);
    this.ui.setHighScore(this.save.highScore);

    this.input = new InputManager({
      element: canvas,
      screenToPlane: (cx, cy, out) => this.camera.screenToPlane(cx, cy, this.width, this.height, out),
      touchMode: () => this.save.settings.touchMode,
    });
    this.input.onAction = (a) => this.handleAction(a);

    this.quality.onChange = (level) => this.applyQuality(level);
    this.applyQuality(this.quality.level);
    this.wireEvents();
    this.wireWindow();
    this.resize();
  }

  /** Enters the menu and starts the frame loop. */
  start(): void {
    this.world.player.reset(0, this.world.arena.startZ);
    this.toMenu(true);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /* ------------------------------ State machine ---------------------------- */

  private setState(next: GameStateId): void {
    const from = this.state;
    this.state = next;
    this.input.gameplayActive = next === 'playing';
    this.renderedPaused = false;
    this.needsRender = true;
    this.bus.emit('state:change', { from, to: next });
  }

  play(): void {
    if (this.state !== 'menu') return;
    this.audio.unlock();
    this.startRun();
    this.camera.setMode('game');
    const touch = this.input.lastDevice === 'touch';
    const mode = this.save.settings.touchMode;
    this.ui.hint(
      touch
        ? mode === 'drag'
          ? 'DRAG ANYWHERE TO FLY'
          : 'TOUCH WHERE YOU WANT TO FLY'
        : this.input.lastDevice === 'gamepad'
          ? 'LEFT STICK TO FLY &nbsp; START = PAUSE'
          : 'WASD / ARROWS &nbsp;or&nbsp; HOLD CLICK TO FLY<br>P / ESC = PAUSE',
      4200,
    );
  }

  private startRun(): void {
    this.effects.clear();
    this.ui.clearFloats();
    this.session.start();
    if (this.opts.startTime > 0) this.session.time = this.opts.startTime;
    this.coinsThisRun = 0;
    this.chaserWarning = null;
    this.hitStop = 0;
    this.input.clearHeld();
    this.ui.resetHud(this.save.highScore);
    this.ui.show('hud');
    this.audio.setPaused(false);
    this.audio.play('start');
    this.setState('playing');
  }

  restart(): void {
    if (this.state !== 'gameover' && this.state !== 'paused') return;
    this.startRun();
    this.camera.setMode('game', true);
    this.camera.snapFollow(this.world.player.pos.x, this.world.player.pos.z, this.world.arena.startZ);
    this.ui.clearHint();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.clearHeld();
    this.audio.setPaused(true);
    this.audio.play('pause');
    this.ui.show('pause');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.audio.setPaused(false);
    this.ui.show('hud');
    this.last = performance.now();
    this.setState('playing');
  }

  toMenu(instant = false): void {
    this.world.clear();
    this.effects.clear();
    this.ui.clearFloats();
    this.session.alive = false;
    this.world.player.reset(0, this.world.arena.startZ);
    this.world.player.powered = false;
    this.camera.setMode('menu', instant);
    this.audio.setPaused(false);
    this.audio.setChaser(0, 0);
    this.ui.setHighScore(this.save.highScore);
    this.ui.show('menu');
    this.setState('menu');
  }

  private gameOver(): void {
    const score = this.session.score.score;
    const time = this.session.time;
    const result = this.save.submitRun(score, time);
    this.ui.showGameOver(score, time, this.save.highScore, result.newHighScore);
    this.audio.play(result.newHighScore ? 'highscore' : 'gameover');
    this.gameOverAt = this.realTime;
    this.setState('gameover');
  }

  /* --------------------------------- Input --------------------------------- */

  private handleAction(a: UIAction): void {
    this.audio.unlock();
    if (a === 'mute') {
      this.ui.setMuteIcon(this.audio.toggleMute());
      return;
    }
    if (a === 'nextTrack') {
      this.audio.nextTrack();
      return;
    }
    if (a === 'debug') {
      this.debugVisible = !this.debugVisible;
      if (!this.debugVisible) this.ui.debug(null);
      return;
    }
    if (this.ui.current === 'settings') {
      if (a === 'back' || a === 'pause') this.ui.closeSettings();
      else this.ui.navigate(a);
      return;
    }
    switch (this.state) {
      case 'playing':
        if (a === 'pause' || a === 'back') this.pause();
        break;
      case 'paused':
        if (a === 'pause' || a === 'back') this.resume();
        else this.ui.navigate(a);
        break;
      case 'menu':
        if (a === 'confirm' && !document.body.classList.contains('kbd-nav')) this.play();
        else this.ui.navigate(a);
        break;
      case 'gameover':
        if (this.realTime - this.gameOverAt < 0.6) return; // avoid accidental restarts
        if (a === 'back') this.toMenu();
        else if (a === 'confirm' && !document.body.classList.contains('kbd-nav')) this.restart();
        else this.ui.navigate(a);
        break;
      default:
        break;
    }
  }

  /* ------------------------------- Game events ------------------------------ */

  private pan(x: number): number {
    return clamp(x / this.world.arena.halfWidth, -1, 1) * 0.7;
  }

  private wireEvents(): void {
    const bus = this.bus;
    bus.on('coin:collect', (e) => {
      this.coinsThisRun++;
      const rainbow = e.kind === 'rainbow';
      this.effects.coinBurst(rainbow, e.x, e.y, e.z);
      const extra = e.multiplier > 1 ? `<small>x${e.multiplier}</small>` : '';
      this.ui.floatText(`+${e.base}${extra}`, e.x, e.y + 0.5, e.z, rainbow ? 'rainbow' : 'yellow');
      this.audio.play(rainbow ? 'rainbow' : 'coin', this.pan(e.x));
    });
    bus.on('score:change', (e) => this.ui.setScore(e.score));
    bus.on('combo:change', (e) => {
      this.ui.setCombo(e.multiplier);
      if (e.multiplier > 1) {
        const p = this.world.player.pos;
        this.ui.floatText(`COMBO x${e.multiplier}`, p.x, 1.4, p.z - 0.8, 'combo');
        this.audio.play('combo');
      }
    });
    bus.on('powerup:start', (e) => {
      this.effects.powerUpBurst(e.x, e.y, e.z);
      this.audio.play('powerup');
      const p = this.world.player.pos;
      this.ui.floatText(e.big ? 'MEGA BONUS!' : 'BONUS!', p.x, 1.6, p.z - 0.6, 'rainbow');
      this.ui.setPowerUp(true, e.rate, e.duration);
    });
    bus.on('powerup:tick', (e) => {
      this.ui.floatText(`+${e.amount}`, e.x, e.y, e.z, 'bonus');
      this.audio.play('bonusTick');
    });
    bus.on('powerup:end', () => {
      this.ui.setPowerUp(false);
      if (this.state === 'playing') this.audio.play('powerupEnd');
    });
    bus.on('meteor:warning', (e) => {
      if (e.size !== 'S') this.audio.play('warning', this.pan(e.x));
    });
    bus.on('chaser:warning', (e) => {
      this.chaserWarning = { x: e.x, z: e.z, t: 1.6 };
      this.audio.play('chaserAppear', this.pan(e.x));
    });
    bus.on('alien:lunge', (e) => this.audio.play('lunge', this.pan(e.x)));
    this.world.alienCtx.onLunge = (x, z) => this.bus.emit('alien:lunge', { x, z });
    bus.on('player:hit', (e) => {
      this.effects.explode(e.x, 0.2, e.z);
      this.camera.shake(0.85);
      this.audio.play('explosion', this.pan(e.x));
      this.audio.setChaser(0, 0);
      this.ui.setPowerUp(false);
      this.ui.clearHint();
      this.hitStop = 0.14;
      this.dyingTimer = DYING_TIME;
      this.setState('dying');
    });
    bus.on('highscore:beaten', () => {
      this.ui.banner('NEW HIGH SCORE!', 'rainbow');
      this.audio.play('highscore');
    });
    bus.on('event:start', (e) => {
      this.ui.banner(e.label, e.id === 'alienSwarm' ? 'purple' : e.id === 'rainbowTrail' || e.id === 'megaBonus' ? 'rainbow' : '');
      this.audio.play('event');
    });
  }

  private wireWindow(): void {
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
        this.audio.setHidden(true);
      } else {
        this.audio.setHidden(false);
        this.last = performance.now();
      }
    });
    window.addEventListener('blur', () => this.pause());
    window.addEventListener('pagehide', () => this.pause());
    // First gesture unlocks audio (autoplay policy) and starts the music.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });
  }

  private applyQuality(level: QualityLevel): void {
    const p = QUALITY_PRESETS[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.particles.setBudget(p.particles, p.density);
    this.background.setQuality(p.density);
    this.world.setGlowEnabled(p.glow);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.hudTop = this.ui ? this.ui.hudHeight() : 70;
    const hudNdc = clamp(1 - (2 * (this.hudTop + 6)) / h, 0.55, 0.92);
    const layout = this.camera.resize(w / h, hudNdc);
    this.world.arena.set(layout);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = layout.distance * 1.35;
      this.scene.fog.far = layout.distance * 4.2;
    }
    this.needsRender = true;
  }

  /* ------------------------------- Frame loop ------------------------------- */

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const raw = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realTime += raw;
    this.quality.sample(raw, this.state === 'playing');
    this.input.poll(raw);

    if (this.state === 'paused') {
      if (!this.renderedPaused || this.needsRender) {
        this.renderedPaused = true;
        this.render();
      }
      return;
    }

    const dt = Math.min(raw, 1 / 15);
    sharedUniforms.uTime.value += dt;
    const w = this.world;
    const p = w.player;
    const startZ = w.arena.startZ;

    switch (this.state) {
      case 'playing': {
        let simDt = dt;
        if (this.hitStop > 0) {
          this.hitStop -= raw;
          simDt *= 0.2;
        }
        const steps = Math.max(1, Math.ceil(simDt / SIM_STEP - 1e-6));
        const sub = simDt / steps;
        const cmd = this.input.getMove();
        const sc = this.subCmd;
        sc.kind = cmd.kind;
        sc.x = cmd.kind === 'delta' ? cmd.x / steps : cmd.x;
        sc.z = cmd.kind === 'delta' ? cmd.z / steps : cmd.z;
        for (let i = 0; i < steps && this.state === 'playing'; i++) this.session.step(sub, sc);
        this.ui.setTime(this.session.time);
        const pu = this.session.powerUp;
        if (pu.active) this.ui.setPowerUp(true, pu.rate, pu.remaining);
        this.updateWhooshes();
        break;
      }
      case 'dying': {
        let simDt = dt;
        if (this.hitStop > 0) {
          this.hitStop -= raw;
          simDt *= 0.2;
        }
        this.session.stepAftermath(simDt * 0.7);
        this.dyingTimer -= raw;
        if (this.dyingTimer <= 0) this.gameOver();
        break;
      }
      case 'gameover':
        this.session.stepAftermath(dt * 0.35);
        break;
      case 'menu':
        p.updateMenu(dt, sharedUniforms.uTime.value, this.particles);
        break;
      default:
        break;
    }

    if (this.state === 'playing' || this.state === 'dying' || this.state === 'gameover') {
      p.updateVisuals(dt, sharedUniforms.uTime.value, this.particles);
    }
    this.effects.update(dt);
    this.particles.update(dt);
    const cruise = this.state === 'menu' ? 1.2 : this.state === 'playing' ? w.flow : w.flow * 0.4;
    this.background.update(dt, cruise);
    this.camera.update(dt, p.pos, startZ);

    // Keep point sizes correct as the FOV animates.
    const hPx = this.height * this.renderer.getPixelRatio();
    this.particles.setViewport(hPx, this.camera.camera.fov);
    this.background.setViewport(hPx, this.camera.camera.fov);

    this.updateOverlay(dt);
    this.render();
  };

  private updateWhooshes(): void {
    const p = this.world.player.pos;
    for (const m of this.world.meteors.active) {
      if (m.whooshed || m.size === 'S') continue;
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d < m.radius + 3.2) {
        m.whooshed = true;
        this.audio.play('whoosh', this.pan(m.pos.x));
      }
    }
  }

  private updateOverlay(dt: number): void {
    this.ui.updateFloats(dt, this.projectFn);
    const playing = this.state === 'playing';
    if (playing) {
      const targets = this.world.collectIndicators(this.indicatorTargets);
      if (this.chaserWarning) {
        this.chaserWarning.t -= dt;
        if (this.chaserWarning.t <= 0 || this.world.chaser.active) this.chaserWarning = null;
        else targets.push({ kind: 'chaser', x: this.chaserWarning.x, z: this.chaserWarning.z, urgency: 1 });
      }
      this.ui.updateIndicators(targets, this.projectFn, this.width, this.height, this.hudTop);
      const ch = this.world.chaser;
      const pl = this.world.player.pos;
      this.audio.setChaser(ch.active ? ch.proximity(pl.x, pl.z) : 0, ch.active ? this.pan(ch.pos.x) : 0);
    } else if (this.state !== 'paused') {
      this.ui.hideIndicators();
    }

    if (this.debugVisible) {
      const info = this.renderer.info.render;
      const q = this.quality;
      const lines = [`FPS ${q.fps.toFixed(0)}  ${q.level.toUpperCase()}${q.current === 'auto' ? ' (AUTO)' : ''}`];
      if (this.opts.debug) {
        const s = this.session;
        lines.push(
          `calls ${info.calls}  tris ${info.triangles}`,
          `particles ${this.particles.alive}`,
          `t ${s.time.toFixed(1)}  lvl ${s.difficulty.level.toFixed(2)} ${s.difficulty.stage}`,
          `rocks ${this.world.rocks.count} met ${this.world.meteors.count} al ${this.world.aliens.count} coins ${this.world.yellowCoins.count + this.world.rainbowCoins.count}`,
        );
      }
      this.ui.debug(lines.join('\n'));
    }
  }

  private render(): void {
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera.camera);
  }
}
