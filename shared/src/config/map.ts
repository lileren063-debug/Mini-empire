/** Kingdom terrain. */
export const GRID_SIZE = 24;
/** Outer ring of tiles reserved for attackers to deploy; buildings may not be placed there. */
export const DEPLOY_MARGIN = 1;
/** Decorative, unbuildable tiles (a pond and a rock outcrop). Units can walk through rocks but not the pond. */
export const POND_TILES: [number, number][] = [
  [3, 18], [4, 18], [3, 19], [4, 19], [5, 19], [4, 20], [5, 20],
];
export const ROCK_TILES: [number, number][] = [
  [19, 4], [20, 4], [20, 5],
];
export const STARTING_LAYOUT = [
  { type: 'headquarters', x: 10, y: 10 },
  { type: 'archer_tower', x: 14, y: 10 },
  { type: 'wall', x: 10, y: 14 },
] as const;
