import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";
import { join } from "node:path";
import { loadBlueprint, diffBlueprintBlocks } from "../lib/blueprint-store";

const AGENTS_DIR = join(import.meta.dirname, "..", "agents");

/**
 * Compare a blueprint against the actual world state.
 *
 * Accepts EITHER:
 *   - { name: "house" }  — load saved blueprint by name
 *   - { origin: {x,y,z}, blueprint: [{dx,dy,dz,block},...] }  — inline blueprint
 *
 * Returns: missing, wrong, placed counts + next placement candidates.
 */
export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  let origin: { x: number; y: number; z: number };
  let blueprint: { dx: number; dy: number; dz: number; block: string }[];

  if (params.name && typeof params.name === "string") {
    const agentDir = join(AGENTS_DIR, instance.name);
    const data = loadBlueprint(agentDir, params.name);
    if (!data) return { error: `blueprint "${params.name}" not found for ${instance.name}` };
    origin = data.origin;
    blueprint = data.blocks;
  } else {
    origin = params.origin;
    blueprint = params.blueprint;
    if (!origin || !blueprint || !Array.isArray(blueprint))
      return { error: "need { name: 'blueprintName' } OR { origin: {x,y,z}, blueprint: [{dx,dy,dz,block},...] }" };
  }

  const ox = Number(origin.x), oy = Number(origin.y), oz = Number(origin.z);
  if (isNaN(ox) || isNaN(oy) || isNaN(oz))
    return { error: "origin must have numeric x, y, z" };

  if (blueprint.length > 5000)
    return { error: `blueprint too large: ${blueprint.length} entries (max 5000)` };

  return diffBlueprintBlocks(bot, Vec3, { x: ox, y: oy, z: oz }, blueprint);
}
