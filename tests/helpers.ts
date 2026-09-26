import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/events';
import { Rng } from '../src/core/Rng';
import { computeLayout } from '../src/render/CameraController';
import { Models } from '../src/render/Models';
import { NullParticles } from '../src/render/ParticleSystem';
import { GameSession } from '../src/systems/GameSession';
import { World } from '../src/world/World';

let models: Models | null = null;
/** Models are pure geometry (no WebGL), so they can be built once in Node. */
export function sharedModels(): Models {
  if (!models) models = new Models();
  return models;
}

export function makeSession(seed: number, aspect = 16 / 9, highScore = 0) {
  const bus = new EventBus<GameEvents>();
  const world = new World(sharedModels(), new NullParticles(), new Rng(seed));
  world.arena.set(computeLayout(aspect, 0.8));
  const session = new GameSession(world, bus, { highScore });
  return { bus, world, session };
}
