/** Color language (see design brief): yellow = reward, rainbow = special, green = common
 * enemy, purple = chaser, brown/grey = danger, blue = UI / identity. */
export const PALETTE = {
  space: 0x05030f,
  fog: 0x070417,

  rocketBody: 0x3d6fe6,
  rocketLight: 0xb4d0ff,
  rocketDark: 0x2340a8,
  rocketAccent: 0xffd23a,
  rocketNozzle: 0x3a3e55,
  cockpit: 0x7ff6ff,

  flameCore: 0xfff3b0,
  flameMid: 0xffa31a,
  flameOuter: 0xff5a14,

  coinGold: 0xffc21a,
  coinLight: 0xffe680,
  coinDark: 0xd48a00,

  rock: [0x7a5234, 0x5e3d26, 0x8d6443, 0x4a2f1d, 0x6b4a33] as const,
  meteorRock: [0x3d2418, 0x512d1c, 0x2e1a12] as const,
  lava: [0xff6a1a, 0xffa03a] as const,

  alienGreen: 0x46de46,
  alienGreenDark: 0x1f9d32,
  alienGreenDeep: 0x137a24,
  alienPurple: 0x9a4dff,
  alienPurpleDark: 0x5b1fb0,
  alienPurpleEye: 0xff5cf4,
  eyeWhite: 0xffffff,
  ink: 0x111111,

  uiBlue: 0x1f2fff,
  warning: 0xff3030,
} as const;
