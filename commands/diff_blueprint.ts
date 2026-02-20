import type { BotInstance } from "./_helpers";
import { Vec3, posOf } from "./_helpers";

/**
 * Compare a blueprint against the actual world state.
 *
 * POST JSON body:
 * {
 *   "origin": { "x": 10, "y": 64, "z": -20 },
 *   "blueprint": [
 *     { "dx": 0, "dy": 0, "dz": 0, "block": "spruce_planks" },
 *     { "dx": 1, "dy": 0, "dz": 0, "block": "spruce_planks" },
 *     ...
 *   ]
 * }
 *
 * dx/dy/dz are offsets from origin. "block" is the expected block name.
 *
 * Returns:
 * - missing: blocks that should exist but don't (air/wrong block)
 * - wrong: blocks that exist but are the wrong type
 * - placed: blocks that match the blueprint
 * - next: the best candidates to place next (sorted by: has support below, then distance to bot)
 */
export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;

  const origin = params.origin;
  const blueprint = params.blueprint;
  if (!origin || !blueprint || !Array.isArray(blueprint))
    return { error: "need JSON body: { origin: {x,y,z}, blueprint: [{dx,dy,dz,block},...] }" };

  const ox = Number(origin.x), oy = Number(origin.y), oz = Number(origin.z);
  if (isNaN(ox) || isNaN(oy) || isNaN(oz))
    return { error: "origin must have numeric x, y, z" };

  if (blueprint.length > 5000)
    return { error: `blueprint too large: ${blueprint.length} entries (max 5000)` };

  const missing: { x: number; y: number; z: number; expected: string; actual: string }[] = [];
  const wrong: { x: number; y: number; z: number; expected: string; actual: string }[] = [];
  const placed: number[] = []; // indices into blueprint

  for (let i = 0; i < blueprint.length; i++) {
    const entry = blueprint[i];
    const wx = ox + Number(entry.dx);
    const wy = oy + Number(entry.dy);
    const wz = oz + Number(entry.dz);
    const block = bot.blockAt(new Vec3(wx, wy, wz));
    const actual = block?.name || "air";
    const expected = entry.block;

    if (actual === expected) {
      placed.push(i);
    } else if (actual === "air" || actual === "cave_air") {
      missing.push({ x: wx, y: wy, z: wz, expected, actual: "air" });
    } else {
      wrong.push({ x: wx, y: wy, z: wz, expected, actual });
    }
  }

  // Sort missing by placeability: blocks with solid support below first, then by distance to bot
  const botPos = bot.entity.position;
  const next = missing
    .map((m) => {
      const below = bot.blockAt(new Vec3(m.x, m.y - 1, m.z));
      const hasSupport = below ? below.boundingBox === "block" : false;
      const dist = botPos.distanceTo(new Vec3(m.x, m.y, m.z));
      return { ...m, hasSupport, dist: +dist.toFixed(1) };
    })
    .sort((a, b) => {
      // Supported blocks first, then by distance
      if (a.hasSupport !== b.hasSupport) return a.hasSupport ? -1 : 1;
      return a.dist - b.dist;
    })
    .slice(0, 20); // Top 20 candidates

  return {
    total: blueprint.length,
    placed: placed.length,
    missing: missing.length,
    wrong: wrong.length,
    progress: `${placed.length}/${blueprint.length} (${Math.round((placed.length / blueprint.length) * 100)}%)`,
    next,
    ...(wrong.length > 0 && { wrongBlocks: wrong }),
  };
}
