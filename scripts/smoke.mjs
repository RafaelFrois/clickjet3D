// End-to-end smoke test: builds nothing, serves `dist/` with `vite preview`, drives the
// game in headless Chromium (WebGL via SwiftShader) across several aspect ratios, checks
// for runtime errors and saves screenshots.
//   npm run build && npm run smoke            (screenshots in ./screenshots)
//   SMOKE_OUT=/tmp/shots npm run smoke
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SMOKE_OUT ?? 'screenshots';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '16x9', width: 1280, height: 720 },
  { name: '21x9', width: 1680, height: 720 },
  { name: '16x10', width: 1152, height: 720 },
  { name: 'phone-portrait-19.5x9', width: 390, height: 844, touch: true },
  { name: 'phone-landscape-18x9', width: 800, height: 400, touch: true },
  { name: 'tablet-4x3', width: 1024, height: 768, touch: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return proc;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  proc.kill();
  throw new Error('preview server did not start');
}

const errors = [];

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${vp.name}] pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[${vp.name}] console: ${m.text()}`);
      });
      await page.goto(`${BASE}?debug&seed=7`);
      await page.waitForFunction(() => window.__clickjet?.state === 'menu', null, { timeout: 20000 });
      await sleep(1200);
      await page.screenshot({ path: `${OUT}/${vp.name}-1-menu.png` });

      await page.click('#btn-play', { force: true });
      await sleep(1500);
      // Fly around with the keyboard for a bit.
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
        await page.keyboard.down(key);
        await sleep(350);
        await page.keyboard.up(key);
      }
      await sleep(2500);
      await page.screenshot({ path: `${OUT}/${vp.name}-2-play.png` });

      // Pause / resume
      await page.keyboard.press('KeyP');
      await sleep(400);
      const paused = await page.evaluate(() => window.__clickjet.state);
      if (paused !== 'paused') errors.push(`[${vp.name}] expected paused, got ${paused}`);
      await page.screenshot({ path: `${OUT}/${vp.name}-3-pause.png` });
      await page.keyboard.press('KeyP');
      await sleep(300);

      // Force a death → game over screen.
      await page.evaluate(() => window.__clickjet.session['die']('rock'));
      await sleep(2200);
      const state = await page.evaluate(() => window.__clickjet.state);
      if (state !== 'gameover') errors.push(`[${vp.name}] expected gameover, got ${state}`);
      await page.screenshot({ path: `${OUT}/${vp.name}-4-gameover.png` });

      // Restart works
      await page.click('#btn-restart', { force: true });
      await sleep(600);
      const restarted = await page.evaluate(() => window.__clickjet.state);
      if (restarted !== 'playing') errors.push(`[${vp.name}] expected playing after restart, got ${restarted}`);
      await ctx.close();
    }

    // Late game (difficulty ~0.7) with invulnerability to capture pressure + events.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[late] pageerror: ${e.message}`));
    await page.goto(`${BASE}?debug&god&seed=3&time=85`);
    await page.waitForFunction(() => window.__clickjet?.state === 'menu', null, { timeout: 20000 });
    await page.click('#btn-play', { force: true });
    await sleep(9000);
    await page.screenshot({ path: `${OUT}/late-1.png` });
    await page.evaluate(() => {
      const g = window.__clickjet;
      g.session.spawner.spawnPowerUp(false);
      g.session.powerUp.activate(false, 0, 0, 0);
      g.session.spawner.triggerEvent('meteorShower');
    });
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/late-2-powerup-shower.png` });
    const stats = await page.evaluate(() => {
      const g = window.__clickjet;
      return { fps: g.quality.fps, level: g.quality.level, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, heap: performance.memory?.usedJSHeapSize };
    });
    console.log('late-game stats', stats);
    await ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  if (errors.length) {
    console.error('SMOKE FAILED:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log(`smoke OK — screenshots in ${OUT}/`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
