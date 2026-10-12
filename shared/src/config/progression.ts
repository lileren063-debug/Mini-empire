/** Permanent achievements, titles and cosmetics. These survive season resets. */

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Title unlocked with the achievement, if any. */
  title?: string;
  /** Cosmetic unlocked with the achievement, if any. */
  cosmetic?: string;
  /** Counts toward the "special" reward pool. */
  special?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_build', name: 'Architect', description: 'Complete your first construction.' },
  { id: 'hq5', name: 'Lord of the Keep', description: 'Reach Headquarters level 5.', title: 'Lord', cosmetic: 'frame_bronze' },
  { id: 'hq10', name: 'Emperor', description: 'Reach Headquarters level 10.', title: 'Emperor', cosmetic: 'skin_hq_royal', special: true },
  { id: 'first_victory', name: 'First Blood', description: 'Win your first battle.' },
  { id: 'pve_master', name: 'Conqueror', description: 'Clear all 10 campaign stages.', title: 'Conqueror', cosmetic: 'frame_silver', special: true },
  { id: 'wins_25', name: 'Veteran', description: 'Win 25 player battles.', title: 'Veteran', special: true },
  { id: 'clan_founder', name: 'Founder', description: 'Found a clan.', title: 'Founder' },
  { id: 'territory_capture', name: 'Banner Bearer', description: 'Help capture a territory.', cosmetic: 'skin_wall_banner', special: true },
  { id: 'season_participant', name: 'Seasoned', description: 'Finish a season with HQ 3 or higher.', cosmetic: 'frame_season' },
];

export interface CosmeticDef {
  id: string;
  name: string;
  slot: 'profile_frame' | 'hq_skin' | 'wall_skin' | 'tower_skin' | 'troop_skin' | 'effect';
  /** How it can be obtained. Real-money purchases are not enabled. */
  source: 'achievement' | 'season_reward' | 'store';
  description: string;
}

export const COSMETICS: CosmeticDef[] = [
  { id: 'frame_bronze', name: 'Bronze Frame', slot: 'profile_frame', source: 'achievement', description: 'A sturdy bronze portrait frame.' },
  { id: 'frame_silver', name: 'Silver Frame', slot: 'profile_frame', source: 'achievement', description: 'Gleaming silver frame for conquerors.' },
  { id: 'frame_season', name: 'Season Laurel', slot: 'profile_frame', source: 'achievement', description: 'Laurels for finishing a season.' },
  { id: 'frame_champion', name: 'Champion Crown', slot: 'profile_frame', source: 'season_reward', description: 'Awarded to members of the top clan.' },
  { id: 'skin_hq_royal', name: 'Royal Keep', slot: 'hq_skin', source: 'achievement', description: 'Purple banners for your Headquarters.' },
  { id: 'skin_hq_winter', name: 'Winter Keep', slot: 'hq_skin', source: 'store', description: 'Snow-capped roofs. (Store — payments not enabled yet.)' },
  { id: 'skin_wall_banner', name: 'Banner Walls', slot: 'wall_skin', source: 'achievement', description: 'Walls flying your banner.' },
  { id: 'skin_tower_gilded', name: 'Gilded Towers', slot: 'tower_skin', source: 'store', description: 'Gold-trimmed towers. (Store — payments not enabled yet.)' },
  { id: 'effect_fireworks', name: 'Victory Fireworks', slot: 'effect', source: 'store', description: 'Fireworks on victory. (Store — payments not enabled yet.)' },
];

export const CLAN_EMBLEM_ICONS = ['lion', 'eagle', 'wolf', 'dragon', 'tower', 'sword', 'crown', 'shield'] as const;
export const CLAN_EMBLEM_COLORS = ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#7e22ce', '#0f766e', '#334155', '#c2410c'] as const;
