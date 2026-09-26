import * as THREE from 'three';

/** Uniforms shared by every animated material (one update per frame). */
export const sharedUniforms = {
  uTime: { value: 0 },
};

let glowTexture: THREE.DataTexture | null = null;

/**
 * Soft radial glow used by additive sprites (flames, coins, power-ups, auras).
 * Generated as a DataTexture so it also works in headless tests (no canvas needed).
 */
export function getGlowTexture(): THREE.DataTexture {
  if (glowTexture) return glowTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - d, 2.2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  glowTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTexture.magFilter = THREE.LinearFilter;
  glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  return glowTexture;
}

export function makeGlowSprite(color: number, scale: number, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(scale);
  return sprite;
}

/** Tiny deterministic hash-noise used to jitter low-poly vertices consistently. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return s - Math.floor(s);
}
