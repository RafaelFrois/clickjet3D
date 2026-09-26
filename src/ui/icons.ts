/**
 * Pixel-art icons defined as ASCII grids and rendered to crisp SVG. Keeps the retro
 * identity of the original UI (outlined speaker, pixel clock, restart arrow…).
 * Legend: '#' = currentColor, 'w' = white, 'k' = black, 'y' = yellow, '.' = empty.
 */
const PALETTE: Record<string, string> = { '#': 'currentColor', w: '#ffffff', k: '#000000', y: '#ffe600', r: '#ff2a2a', p: '#c56bff' };

const ICONS: Record<string, string[]> = {
  soundOn: [
    '................',
    '.....#..........',
    '....##.......#..',
    '...#.#....#...#.',
    '####.#.....#..#.',
    '#....#..#..#...#',
    '#....#...#..#..#',
    '#....#...#..#..#',
    '#....#...#..#..#',
    '#....#..#..#...#',
    '####.#.....#..#.',
    '...#.#....#...#.',
    '....##.......#..',
    '.....#..........',
    '................',
    '................',
  ],
  soundOff: [
    '................',
    '.....#..........',
    '....##..........',
    '...#.#..........',
    '####.#..........',
    '#....#..#....#..',
    '#....#...#..#...',
    '#....#....##....',
    '#....#....##....',
    '#....#...#..#...',
    '####.#..#....#..',
    '...#.#..........',
    '....##..........',
    '.....#..........',
    '................',
    '................',
  ],
  clock: [
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kwwwwwwwwwwk..',
    '.kwwwwwkkwwwwwk.',
    '.kwwwwwkkwwwwwk.',
    'kwwwwwwkkwwwwwwk',
    'kwwwwwwkkwwwwwwk',
    'kwwwwwwkkkkkwwwk',
    'kwwwwwwkkkkkwwwk',
    'kwwwwwwwwwwwwwwk',
    'kwwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
  ],
  pause: [
    '................',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '................',
  ],
  music: [
    '................',
    '..############..',
    '.#............#.',
    '#..............#',
    '#.....#........#',
    '#.....##.......#',
    '#.....#.#......#',
    '#.....#..#.....#',
    '#.....#..#.....#',
    '#.....#.#......#',
    '#.....##.......#',
    '#.....#........#',
    '#..............#',
    '.#............#.',
    '..############..',
    '................',
  ],
  restart: [
    '................',
    '.....#####......',
    '...##.....##.#..',
    '..#.........##..',
    '.#.........###..',
    '.#.......####...',
    '#...............',
    '#...............',
    '#...............',
    '#...............',
    '.#.............#',
    '.#............#.',
    '..#..........#..',
    '...##......##...',
    '.....######.....',
    '................',
  ],
  gear: [
    '.......##.......',
    '...#..####..#...',
    '..###.####.###..',
    '...##########...',
    '....###..###....',
    '.####......####.',
    '#####......#####',
    '.###........###.',
    '.###........###.',
    '#####......#####',
    '.####......####.',
    '....###..###....',
    '...##########...',
    '..###.####.###..',
    '...#..####..#...',
    '.......##.......',
  ],
  play: [
    '................',
    '...##...........',
    '...####.........',
    '...######.......',
    '...########.....',
    '...##########...',
    '...############.',
    '...#############',
    '...#############',
    '...############.',
    '...##########...',
    '...########.....',
    '...######.......',
    '...####.........',
    '...##...........',
    '................',
  ],
  home: [
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '.##############.',
    '################',
    '..############..',
    '..############..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '................',
  ],
  warn: [
    '.......rr.......',
    '......rrrr......',
    '......rwwr......',
    '.....rrwwrr.....',
    '.....rrwwrr.....',
    '....rrrwwrrr....',
    '....rrrwwrrr....',
    '...rrrrwwrrrr...',
    '...rrrrwwrrrr...',
    '..rrrrrwwrrrrr..',
    '..rrrrrrrrrrrr..',
    '.rrrrrrwwrrrrrr.',
    '.rrrrrrwwrrrrrr.',
    'rrrrrrrrrrrrrrrr',
    'rrrrrrrrrrrrrrrr',
    '................',
  ],
  eye: [
    '................',
    '................',
    '.....pppppp.....',
    '...pp......pp...',
    '..p...wwww...p..',
    '.p...wkkkkw...p.',
    'p...wkkkkkkw...p',
    'p...wkkwwkkw...p',
    'p...wkkwwkkw...p',
    'p...wkkkkkkw...p',
    '.p...wkkkkw...p.',
    '..p...wwww...p..',
    '...pp......pp...',
    '.....pppppp.....',
    '................',
    '................',
  ],
  star: [
    '.......yy.......',
    '.......yy.......',
    '......yyyy......',
    '......yyyy......',
    'yyyyyyyyyyyyyyyy',
    '.yyyyyyyyyyyyyy.',
    '...yyyyyyyyyy...',
    '....yyyyyyyy....',
    '....yyyyyyyy....',
    '...yyyyyyyyyy...',
    '...yyyy..yyyy...',
    '..yyy......yyy..',
    '..yy........yy..',
    '.y............y.',
    '................',
    '................',
  ],
};

const cache = new Map<string, string>();

export type IconName = keyof typeof ICONS;

/** Returns an inline SVG string for a pixel icon. */
export function icon(name: IconName | string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const rows = ICONS[name];
  if (!rows) return '';
  const h = rows.length;
  const w = rows[0].length;
  const byColor = new Map<string, string[]>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && row[x + run] === ch) run++;
      const fill = PALETTE[ch] ?? 'currentColor';
      const list = byColor.get(fill) ?? [];
      list.push(`M${x} ${y}h${run}v1h-${run}z`);
      byColor.set(fill, list);
      x += run;
    }
  });
  const paths = [...byColor.entries()].map(([fill, d]) => `<path fill="${fill}" d="${d.join('')}"/>`).join('');
  const svg = `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${paths}</svg>`;
  cache.set(name, svg);
  return svg;
}

/** Replaces every [data-icon] placeholder inside root with its SVG. */
export function hydrateIcons(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon as IconName);
  });
}
