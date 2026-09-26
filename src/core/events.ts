import type { MeteorSize } from '../config/balance';
import type { CoinKind, GameStateId, HazardKind, RareEventId } from './types';

export interface GameEvents {
  'state:change': { from: GameStateId; to: GameStateId };
  'run:start': Record<string, never>;
  'coin:collect': { kind: CoinKind; value: number; base: number; multiplier: number; x: number; y: number; z: number };
  'score:change': { score: number; delta: number };
  'combo:change': { multiplier: number };
  'powerup:start': { duration: number; rate: number; big: boolean; x: number; y: number; z: number };
  'powerup:tick': { amount: number; x: number; y: number; z: number };
  'powerup:end': Record<string, never>;
  'meteor:warning': { size: MeteorSize; x: number; z: number };
  'meteor:spawn': { size: MeteorSize; x: number; z: number };
  'powerup:spawn': { big: boolean; x: number; z: number };
  'chaser:warning': { x: number; z: number };
  'chaser:spawn': { x: number; z: number };
  'alien:lunge': { x: number; z: number };
  'player:hit': { cause: HazardKind; x: number; y: number; z: number };
  'highscore:beaten': { score: number; previous: number };
  'event:start': { id: RareEventId; label: string };
}
