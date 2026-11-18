import { SKY_PHASES } from "./daylight-phases.js";

// The atlas contains 108 useful rows per phase and a duplicate edge pixel
// above/below each tile to prevent seams during bilinear sampling.
const TILE = 108;
const STRIDE = TILE + 2;
const HEIGHT = SKY_PHASES.length * STRIDE;
export const atlasHeightPercent = (HEIGHT / TILE) * 100;
const position = index => `${100 * (index * STRIDE + 1) / (HEIGHT - TILE)}%`;

export function daylightAt(value) {
  const minute = Number.isFinite(value) ? ((value % 1440) + 1440) % 1440 : 720;
  const after = SKY_PHASES.findIndex(([at]) => at > minute);
  const next = after < 0 ? 0 : after;
  const previous = (next + SKY_PHASES.length - 1) % SKY_PHASES.length;
  const [start, top, bottom] = SKY_PHASES[previous];
  const mix = (minute - start) / ((next === 0 ? 1440 : SKY_PHASES[next][0]) - start);
  // Stars become visible at dusk and fade before daylight; no independent
  // animation, moving particles or continuous animation frame loop.
  const stars = Math.max(0, Math.min(1, minute < 720 ? (345 - minute) / 75 : (minute - 1140) / 90));
  return { previous, next, mix, top, bottom, stars, fromY: position(previous), toY: position(next) };
}
