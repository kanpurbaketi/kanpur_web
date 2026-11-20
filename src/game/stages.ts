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
