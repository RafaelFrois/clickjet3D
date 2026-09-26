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
      if (vp === VIEWPORTS[0]) {
        // Settings screen + persisted mute toggle
        await page.click('#btn-settings', { force: true });
        await sleep(400);
        await page.screenshot({ path: `${OUT}/${vp.name}-1b-settings.png` });
        await page.click('#set-mute', { force: true });
        const muted = await page.evaluate(() => JSON.parse(localStorage.getItem('clickjet3d:save:v1')).settings.muted);
        if (muted !== true) errors.push(`[${vp.name}] mute was not persisted`);
        await page.click('#set-mute', { force: true });
        await page.keyboard.press('Escape');
        await sleep(300);
        const back = await page.evaluate(() => window.__clickjet.ui.current);
        if (back !== 'menu') errors.push(`[${vp.name}] settings did not return to menu (${back})`);
      }

      const logoOk = await page.evaluate(() => document.querySelector('.domus').naturalWidth > 0);
      if (!logoOk) errors.push(`[${vp.name}] Domus Arcis logo failed to load`);

      await page.click('#btn-play', { force: true });
      await sleep(1500);
      const audio = await page.evaluate(() => ({ ready: window.__clickjet.audio.ready, track: window.__clickjet.audio.currentTrackName }));
      if (!audio.track || !audio.ready) errors.push(`[${vp.name}] music did not start (${JSON.stringify(audio)})`);
      if (vp === VIEWPORTS[0]) {
        // The mix must actually carry signal (music + SFX).
        const rms = await page.evaluate(async () => {
          const a = window.__clickjet.audio;
          const an = a.ctx.createAnalyser();
          an.fftSize = 2048;
          a.master.connect(an);
          const buf = new Float32Array(an.fftSize);
          let peak = 0;
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 60));
            an.getFloatTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += v * v;
            peak = Math.max(peak, Math.sqrt(sum / buf.length));
          }
          return peak;
        });
        console.log(`audio RMS peak: ${rms.toFixed(4)}`);
        if (!(rms > 0.002)) errors.push(`[${vp.name}] audio output is silent (rms ${rms})`);
      }

      if (vp.touch) {
        // Relative touch drag (default touch mode) must move the rocket.
        const before = await page.evaluate(() => window.__clickjet.world.player.pos.x);
        await page.evaluate(({ w, h }) => {
          const c = document.getElementById('game');
          const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: h * 0.7, bubbles: true }));
          ev('pointerdown', w * 0.5);
          for (let i = 1; i <= 10; i++) ev('pointermove', w * 0.5 + i * (w * 0.03));
          ev('pointerup', w * 0.8);
        }, { w: vp.width, h: vp.height });
        await sleep(200);
        const after = await page.evaluate(() => window.__clickjet.world.player.pos.x);
        if (!(after > before + 0.5)) errors.push(`[${vp.name}] touch drag did not move the rocket (${before} → ${after})`);
      }
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
    // Coin feedback: drop coins right on the rocket.
    await page.evaluate(() => {
      const g = window.__clickjet;
      const p = g.world.player.pos;
      for (let i = 0; i < 6; i++) g.world.coinPool(i % 3 === 0 ? 'rainbow' : 'yellow').acquire().spawn(p.x + (i - 2.5) * 0.3, p.z - 0.4 - i * 0.2, 0, 0);
    });
    await sleep(350);
    await page.screenshot({ path: `${OUT}/late-3-coins.png` });
    // New high score → game over celebration.
    await page.evaluate(() => {
      const g = window.__clickjet;
      g.world.invulnerable = false;
      for (let i = 0; i < 40; i++) g.session.score.addCoin('rainbow', 0, 0, 0);
      g.session['die']('meteor');
    });
    await sleep(300);
    await page.screenshot({ path: `${OUT}/late-4-explosion.png` });
    await sleep(1800);
    await page.screenshot({ path: `${OUT}/late-5-new-highscore.png` });
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
