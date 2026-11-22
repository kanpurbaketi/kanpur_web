/*
 The game's stages. Stage 1 is open to every player; the admin opens others for a player (admin.html → Players).
 Only the built ones can be played: an unlocked stage that isn't built yet says so.
 Titles, descriptions and goals are i18n keys (stage.<n>.title / .desc / .goal).
*/

export interface Stage {
  n: number;
  built: boolean;
  /** the part of Kanpur it plays in */
  area?: string;
}

export const STAGE_COUNT = 10;

export const STAGES: Stage[] = Array.from({ length: STAGE_COUNT }, (_, i) =>
  i === 0 ? { n: 1, built: true, area: 'moti_jheel' } : { n: i + 1, built: false });

export const stage = (n: number): Stage | undefined => STAGES.find((s) => s.n === n);

/**
 The Testing menu (development only): where a stage can be started, by mission. `from` goes in the URL (?debug&stage=
 &from=); `n` is the mission shown, `key` its title, `sub` a note (a second start within the same mission).
*/
export interface TestStart { from: number; n: number; key: string; sub?: string }
export const TEST_STARTS: Record<number, TestStart[]> = {
  1: [
    { from: 1, n: 1, key: 'm.s1.food' }, { from: 2, n: 2, key: 'm.s1.gate' }, { from: 3, n: 3, key: 'm.s1.way' },
    { from: 4, n: 4, key: 'm.s1.stage' }, { from: 5, n: 5, key: 'm.s1.seat' }, { from: 6, n: 6, key: 'm.s1.run' },
    { from: 7, n: 7, key: 'm.s1.flee' }, { from: 8, n: 8, key: 'm.s1.wheel' }, { from: 9, n: 9, key: 'm.s1.hold' },
    { from: 10, n: 10, key: 'm.s1.kuan' }, { from: 11, n: 11, key: 'm.s1.girl' },
  ],
};
