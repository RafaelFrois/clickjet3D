export type GameStateId = 'boot' | 'menu' | 'playing' | 'paused' | 'dying' | 'gameover';

export type CoinKind = 'yellow' | 'rainbow';
export type HazardKind = 'meteor' | 'rock' | 'alien' | 'chaser';
export type RareEventId = 'meteorShower' | 'coinRain' | 'alienSwarm' | 'megaBonus' | 'rainbowTrail';
export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityLevel;
export type TouchMode = 'drag' | 'follow';

/**
 * Device-agnostic movement command produced by the InputManager and consumed by the
 * PlayerController. The controller never knows which device produced it.
 *  - axis:   analog direction (-1..1), x = right, z = toward the camera (screen down)
 *  - target: fly toward a point on the gameplay plane (mouse "ClickJet", touch follow)
 *  - delta:  move by a displacement in world units (relative touch drag)
 */
export interface MoveCommand {
  kind: 'none' | 'axis' | 'target' | 'delta';
  x: number;
  z: number;
}

export type UIAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'mute' | 'nextTrack' | 'debug';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
