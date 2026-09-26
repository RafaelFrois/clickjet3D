import * as THREE from 'three';
import type { MoveCommand, TouchMode, UIAction } from '../core/types';

export type InputDevice = 'keyboard' | 'mouse' | 'touch' | 'gamepad';

export interface InputDeps {
  /** Element receiving gameplay pointer input (the canvas). */
  element: HTMLElement;
  /** Screen (client px) → gameplay plane. Provided by the camera. */
  screenToPlane: (clientX: number, clientY: number, out: THREE.Vector3) => THREE.Vector3 | null;
  touchMode: () => TouchMode;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

const KEY_ACTIONS: Record<string, UIAction> = {
  Escape: 'back',
  KeyP: 'pause',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  KeyM: 'mute',
  KeyN: 'nextTrack',
  F3: 'debug',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const NAV_REPEAT_DELAY = 0.35;
const NAV_REPEAT_RATE = 0.14;
const STICK_DEADZONE = 0.2;
/** Follow-touch keeps the rocket slightly above the finger so it is never hidden. */
const FOLLOW_TOUCH_OFFSET_PX = 70;

/**
 * Collects keyboard, mouse, touch and gamepad input and turns it into ONE abstract
 * MoveCommand + UI actions. Gameplay code never knows which device is used.
 *
 *  Keyboard ─┐
 *  Mouse ────┤
 *  Touch ────┼─→ InputManager ─→ MoveCommand ─→ PlayerController
 *  Gamepad ──┘                └→ UIAction    ─→ GameManager / UI
 */
export class InputManager {
  onAction: (action: UIAction) => void = () => {};
  onDeviceChange: (device: InputDevice) => void = () => {};
  lastDevice: InputDevice = 'mouse';
  /** Pointer movement is only captured while playing. */
  gameplayActive = false;

  private readonly cmd: MoveCommand = { kind: 'none', x: 0, z: 0 };
  private readonly keys = new Set<string>();
  private pointerId: number | null = null;
  private pointerType: 'mouse' | 'touch' = 'mouse';
  private pointerDown = false;
  private readonly lastPlane = new THREE.Vector3();
  private lastPlaneValid = false;
  private readonly target = new THREE.Vector3();
  private hasTarget = false;
  private readonly delta = { x: 0, z: 0 };
  private readonly tmp = new THREE.Vector3();
  private padButtons: boolean[] = [];
  private navDir: UIAction | null = null;
  private navTimer = 0;
  private padAxisX = 0;
  private padAxisZ = 0;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly deps: InputDeps) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.clearHeld());
    const el = deps.element;
    on(el, 'pointerdown', (e) => this.onPointerDown(e));
    on(el, 'pointermove', (e) => this.onPointerMove(e));
    on(el, 'pointerup', (e) => this.onPointerUp(e));
    on(el, 'pointercancel', (e) => this.onPointerUp(e));
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(window, 'gamepadconnected', () => this.setDevice('gamepad'));
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  /** Clears held keys/pointer/targets (e.g. on state changes). */
  clearHeld(): void {
    this.keys.clear();
    this.pointerDown = false;
    this.pointerId = null;
    this.hasTarget = false;
    this.delta.x = this.delta.z = 0;
  }

  /** Per-frame: polls gamepads and emits navigation actions. */
  poll(dt: number): void {
    this.pollGamepad(dt);
  }

  /** Returns this frame's movement command (consumes accumulated drag deltas). */
  getMove(): MoveCommand {
    const c = this.cmd;
    // 1) Gamepad stick / d-pad
    if (this.padAxisX !== 0 || this.padAxisZ !== 0) {
      this.hasTarget = false;
      c.kind = 'axis';
      c.x = this.padAxisX;
      c.z = this.padAxisZ;
      return c;
    }
    // 2) Keyboard
    let kx = 0;
    let kz = 0;
    for (const code of this.keys) {
      const m = MOVE_KEYS[code];
      if (m) {
        kx += m[0];
        kz += m[1];
      }
    }
    if (kx !== 0 || kz !== 0) {
      this.hasTarget = false;
      const len = Math.hypot(kx, kz);
      c.kind = 'axis';
      c.x = kx / len;
      c.z = kz / len;
      return c;
    }
    // 3) Relative touch drag
    if (this.delta.x !== 0 || this.delta.z !== 0) {
      c.kind = 'delta';
      c.x = this.delta.x;
      c.z = this.delta.z;
      this.delta.x = this.delta.z = 0;
      return c;
    }
    // 4) Fly-to target (mouse "ClickJet" / follow-touch)
    if (this.hasTarget) {
      c.kind = 'target';
      c.x = this.target.x;
      c.z = this.target.z;
      return c;
    }
    c.kind = 'none';
    c.x = c.z = 0;
    return c;
  }

  /* ------------------------------ Keyboard ------------------------------- */

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && e.code !== 'Escape') return;
    // Avoid page scrolling and native button activation (we handle confirm ourselves).
    if (MOVE_KEYS[e.code] || e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') e.preventDefault();
    this.setDevice('keyboard');
    if (!e.repeat) this.keys.add(e.code);
    const action = KEY_ACTIONS[e.code] ?? (e.code === 'KeyW' ? 'up' : e.code === 'KeyS' ? 'down' : e.code === 'KeyA' ? 'left' : e.code === 'KeyD' ? 'right' : null);
    if (!action) return;
    if (e.repeat && action !== 'up' && action !== 'down' && action !== 'left' && action !== 'right') return;
    if (action === 'debug') e.preventDefault();
    this.onAction(action);
  }

  /* ------------------------------- Pointer ------------------------------- */

  private planeAt(clientX: number, clientY: number, out: THREE.Vector3): boolean {
    return this.deps.screenToPlane(clientX, clientY, out) !== null;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return; // single pointer
    const isMouse = e.pointerType === 'mouse';
    if (isMouse && e.button !== 0) return;
    this.pointerType = isMouse ? 'mouse' : 'touch';
    this.setDevice(this.pointerType);
    if (!this.gameplayActive) return;
    this.pointerId = e.pointerId;
    this.pointerDown = true;
    try {
      this.deps.element.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pointerType === 'touch' && this.deps.touchMode() === 'drag') {
      this.lastPlaneValid = this.planeAt(e.clientX, e.clientY, this.lastPlane);
      this.hasTarget = false;
    } else {
      this.updateTarget(e);
    }
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && !this.pointerDown) return;
    if (!this.pointerDown || e.pointerId !== this.pointerId || !this.gameplayActive) return;
    if (this.pointerType === 'touch' && this.deps.touchMode() === 'drag') {
      if (this.planeAt(e.clientX, e.clientY, this.tmp)) {
        if (this.lastPlaneValid) {
          this.delta.x += this.tmp.x - this.lastPlane.x;
          this.delta.z += this.tmp.z - this.lastPlane.z;
        }
        this.lastPlane.copy(this.tmp);
        this.lastPlaneValid = true;
      }
    } else {
      this.updateTarget(e);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerDown = false;
    this.pointerId = null;
    this.lastPlaneValid = false;
    // Mouse/follow keep their last target: the jet finishes flying to where you clicked.
  }

  private updateTarget(e: PointerEvent): void {
    const offset = this.pointerType === 'touch' ? FOLLOW_TOUCH_OFFSET_PX : 0;
    if (this.planeAt(e.clientX, e.clientY - offset, this.tmp)) {
      this.target.copy(this.tmp);
      this.hasTarget = true;
    }
  }

  /* ------------------------------- Gamepad ------------------------------- */

  private pollGamepad(dt: number): void {
    this.padAxisX = 0;
    this.padAxisZ = 0;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) return;

    let ax = pad.axes[0] ?? 0;
    let az = pad.axes[1] ?? 0;
    const mag = Math.hypot(ax, az);
    if (mag < STICK_DEADZONE) {
      ax = az = 0;
    } else {
      const k = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / mag;
      ax *= k;
      az *= k;
    }
    const b = (i: number): boolean => !!pad!.buttons[i]?.pressed;
    if (b(12)) az = -1;
    if (b(13)) az = 1;
    if (b(14)) ax = -1;
    if (b(15)) ax = 1;
    this.padAxisX = ax;
    this.padAxisZ = az;

    const pressed = pad.buttons.map((btn) => btn.pressed);
    const edge = (i: number): boolean => !!pressed[i] && !this.padButtons[i];
    const anyPressed = pressed.some(Boolean) || ax !== 0 || az !== 0;
    if (anyPressed) this.setDevice('gamepad');
    if (edge(0)) this.onAction('confirm');
    if (edge(1)) this.onAction('back');
    if (edge(9)) this.onAction('pause');
    if (edge(8)) this.onAction('mute');
    if (edge(3)) this.onAction('nextTrack');
    this.padButtons = pressed;

    // Menu navigation with repeat
    let dir: UIAction | null = null;
    if (az < -0.5) dir = 'up';
    else if (az > 0.5) dir = 'down';
    else if (ax < -0.5) dir = 'left';
    else if (ax > 0.5) dir = 'right';
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navTimer = NAV_REPEAT_DELAY;
      if (dir) this.onAction(dir);
    } else if (dir) {
      this.navTimer -= dt;
      if (this.navTimer <= 0) {
        this.navTimer = NAV_REPEAT_RATE;
        this.onAction(dir);
      }
    }
  }

  private setDevice(d: InputDevice): void {
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    this.onDeviceChange(d);
  }
}
