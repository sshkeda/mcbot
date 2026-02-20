import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";
import { join } from "node:path";
import * as store from "../lib/blueprint-store";
import type { BlueprintEntry, BlueprintData } from "../lib/blueprint-store";

const AGENTS_DIR = join(import.meta.dirname, "..", "agents");

/**
 * Blueprint management subcommands:
 *   blueprint              — list saved blueprints
 *   blueprint show <name>  — show details + material counts
 *   blueprint snap <name> <x1> <y1> <z1> <x2> <y2> <z2> — scan volume and save
 *   blueprint diff <name>  — diff saved blueprint vs world
 *   blueprint delete <name>
 */
export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const agentDir = join(AGENTS_DIR, instance.name);
  const action = params.action || "list";

  // ── list ───────────────────────────────────────────────────
  if (action === "list") {
    const blueprints = store.listBlueprints(agentDir);
    return { blueprints, count: blueprints.length };
  }

  // ── show <name> ────────────────────────────────────────────
  if (action === "show") {
    const name = params.name;
    if (!name) return { error: "usage: blueprint show <name>" };
    const data = store.loadBlueprint(agentDir, name);
    if (!data) return { error: `blueprint "${name}" not found` };
    const counts: Record<string, number> = {};
    for (const b of data.blocks) counts[b.block] = (counts[b.block] || 0) + 1;
    return {
      name: data.name,
      origin: data.origin,
      blockCount: data.blocks.length,
      createdAt: data.createdAt,
      source: data.source,
      materials: counts,
      bounds: data.bounds,
    };
  }

  // ── snap <name> <x1> <y1> <z1> <x2> <y2> <z2> ────────────
  if (action === "snap") {
    const name = params.name;
    const x1 = Number(params.x1), y1 = Number(params.y1), z1 = Number(params.z1);
    const x2 = Number(params.x2), y2 = Number(params.y2), z2 = Number(params.z2);
    if (!name || [x1, y1, z1, x2, y2, z2].some(isNaN))
      return { error: "usage: blueprint snap <name> <x1> <y1> <z1> <x2> <y2> <z2>" };

    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
    const vol = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (vol > 10_000) return { error: `volume too large: ${vol} (max 10000)` };

    const origin = { x: minX, y: minY, z: minZ };
    const blocks: BlueprintEntry[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.name !== "air" && block.name !== "cave_air") {
            blocks.push({ dx: x - minX, dy: y - minY, dz: z - minZ, block: block.name });
          }
        }
      }
    }

    const data: BlueprintData = {
      name, origin, blocks,
      createdAt: new Date().toISOString(),
      source: "snap",
      bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
    };
    store.saveBlueprint(agentDir, data);
    return { status: "saved", name, blockCount: blocks.length, origin, volume: vol };
  }

  // ── diff <name> ────────────────────────────────────────────
  if (action === "diff") {
    const name = params.name;
    if (!name) return { error: "usage: blueprint diff <name>" };
    const data = store.loadBlueprint(agentDir, name);
    if (!data) return { error: `blueprint "${name}" not found` };
    return store.diffBlueprintBlocks(bot, Vec3, data.origin, data.blocks);
  }

  // ── delete <name> ──────────────────────────────────────────
  if (action === "delete") {
    const name = params.name;
    if (!name) return { error: "usage: blueprint delete <name>" };
    const deleted = store.deleteBlueprint(agentDir, name);
    return deleted ? { status: "deleted", name } : { error: `blueprint "${name}" not found` };
  }

  return { error: `unknown action: ${action}. use: list, show, snap, diff, delete` };
}
