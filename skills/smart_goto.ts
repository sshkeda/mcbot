/**
 * @skill smart_goto
 * @description Chunked pathfinding with manual fallback. Breaks long paths into ~20 block legs.
 * @tags navigation, movement
 */

// Smart navigation using the shared navigation engine.
// Context: goto, log, signal
// Params: TX, TY, TZ, RANGE=3, Y_RANGE=2, LEG_SIZE=20, LEG_TIMEOUT_MS=12000, MAX_LEGS=80, MANUAL_MS=1600

const tx = typeof TX !== "undefined" ? Number(TX) : 0;
const ty = typeof TY !== "undefined" ? Number(TY) : 0;
const tz = typeof TZ !== "undefined" ? Number(TZ) : 0;

const result = await goto(tx, ty, tz, {
  range: typeof RANGE !== "undefined" ? Number(RANGE) : 3,
  yRange: typeof Y_RANGE !== "undefined" ? Number(Y_RANGE) : 2,
  legSize: typeof LEG_SIZE !== "undefined" ? Number(LEG_SIZE) : 20,
  legTimeoutMs: typeof LEG_TIMEOUT_MS !== "undefined" ? Number(LEG_TIMEOUT_MS) : 12000,
  maxLegs: typeof MAX_LEGS !== "undefined" ? Number(MAX_LEGS) : 80,
  manualMs: typeof MANUAL_MS !== "undefined" ? Number(MANUAL_MS) : 1600,
});

return result;
