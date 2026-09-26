import '@fontsource/press-start-2p/400.css';
import './ui/styles.css';
import { GameManager } from './core/GameManager';

function showFatal(message: string): void {
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.add('active');
    boot.innerHTML = `<div class="boot-text" style="text-align:center;line-height:2;padding:24px">${message}</div>`;
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    showFatal('WEBGL IS NOT AVAILABLE<br>ON THIS DEVICE / BROWSER');
    return;
  }
  // Wait for the pixel font so the first frame of UI is already retro.
  try {
    await Promise.race([document.fonts.load('16px "Press Start 2P"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new GameManager(canvas, {
    debug: params.has('debug'),
    god: params.has('god'),
    seed: params.has('seed') ? Number(params.get('seed')) : undefined,
    startTime: Number(params.get('time') ?? 0) || 0,
  });
  game.start();
  if (params.has('debug')) (window as unknown as { __clickjet: GameManager }).__clickjet = game;
}

boot().catch((err) => {
  console.error(err);
  showFatal('SOMETHING WENT WRONG<br>PLEASE RELOAD');
});
