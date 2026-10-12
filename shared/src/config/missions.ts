import type { Resources } from '../types.js';

/** Validated server events that can advance missions and achievements. */
export const PROGRESS_EVENTS = [
  'resources_collected', // amount = units collected
  'building_upgraded', // amount = 1 per completed construction / upgrade
  'troops_trained', // amount = units trained
  'pve_victory', // amount = 1
  'pvp_victory', // amount = 1
  'battle_fought', // amount = 1
  'clan_contribution', // amount = clan points contributed
  'territory_battle', // amount = 1
] as const;
export type ProgressEvent = (typeof PROGRESS_EVENTS)[number];

export interface MissionDef {
  id: string;
  period: 'daily' | 'weekly';
  title: string;
  event: ProgressEvent;
  target: number;
  reward: Resources;
  /** Participation score granted on claim (feeds the participation leaderboard; capped per day). */
  participationPoints: number;
  enabled: boolean;
}

export const MISSIONS: MissionDef[] = [
  { id: 'd_collect', period: 'daily', title: 'Collect 1,500 resources', event: 'resources_collected', target: 1500, reward: { gold: 300, wood: 300, stone: 100 }, participationPoints: 5, enabled: true },
  { id: 'd_upgrade', period: 'daily', title: 'Complete 1 construction', event: 'building_upgraded', target: 1, reward: { gold: 200, wood: 200, stone: 100 }, participationPoints: 5, enabled: true },
  { id: 'd_train', period: 'daily', title: 'Train 10 troops', event: 'troops_trained', target: 10, reward: { gold: 250, wood: 150, stone: 50 }, participationPoints: 5, enabled: true },
  { id: 'd_pve', period: 'daily', title: 'Win a campaign battle', event: 'pve_victory', target: 1, reward: { gold: 300, wood: 200, stone: 100 }, participationPoints: 5, enabled: true },
  { id: 'w_collect', period: 'weekly', title: 'Collect 25,000 resources', event: 'resources_collected', target: 25000, reward: { gold: 3000, wood: 3000, stone: 1500 }, participationPoints: 20, enabled: true },
  { id: 'w_upgrade', period: 'weekly', title: 'Complete 8 constructions', event: 'building_upgraded', target: 8, reward: { gold: 2500, wood: 2500, stone: 1500 }, participationPoints: 20, enabled: true },
  { id: 'w_battles', period: 'weekly', title: 'Fight 10 battles', event: 'battle_fought', target: 10, reward: { gold: 3000, wood: 2000, stone: 1000 }, participationPoints: 20, enabled: true },
  { id: 'w_clan', period: 'weekly', title: 'Contribute 100 clan points', event: 'clan_contribution', target: 100, reward: { gold: 2000, wood: 2000, stone: 2000 }, participationPoints: 20, enabled: true },
];

/** Clan missions: progress is the sum of all members' validated events during the week. */
export interface ClanMissionDef {
  id: string;
  title: string;
  event: ProgressEvent;
  target: number;
  /** Resources granted to every member who contributed at least once, claimable individually. */
  memberReward: Resources;
}
export const CLAN_MISSIONS: ClanMissionDef[] = [
  { id: 'c_battles', title: 'Clan: win 30 battles this week', event: 'pvp_victory', target: 30, memberReward: { gold: 2000, wood: 2000, stone: 1000 } },
  { id: 'c_pve', title: 'Clan: win 50 campaign battles this week', event: 'pve_victory', target: 50, memberReward: { gold: 1500, wood: 1500, stone: 800 } },
  { id: 'c_build', title: 'Clan: complete 60 constructions this week', event: 'building_upgraded', target: 60, memberReward: { gold: 1500, wood: 1500, stone: 1500 } },
];
