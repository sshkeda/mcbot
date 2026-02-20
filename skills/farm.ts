import { createRequire } from "node:module";
import { sleep, withTimeout } from "../lib/utils";
const require = createRequire(import.meta.url);

const CROP_INFO: Record<string, { maxAge: number; seed: string }> = {
  wheat: { maxAge: 7, seed: "wheat_seeds" },
  carrots: { maxAge: 7, seed: "carrot" },
  potatoes: { maxAge: 7, seed: "potato" },
  beetroots: { maxAge: 3, seed: "beetroot_seeds" },
};

export async function farmCrops(bot: any, pathfinder: any, radius = 16) {
  const { GoalNear } = pathfinder.goals;
  const mcData = require("minecraft-data")(bot.version);

  const cropIds = Object.keys(CROP_INFO)
    .map((name) => mcData.blocksByName[name]?.id)
    .filter(Boolean);

  const positions = bot.findBlocks({ matching: cropIds, maxDistance: radius, count: 100 });
  const mature = positions.filter((pos: any) => {
    const block = bot.blockAt(pos);
    if (!block) return false;
    const info = CROP_INFO[block.name];
    return info && block.metadata === info.maxAge;
  });

  if (mature.length === 0) {
    console.log("[FARM] No mature crops nearby");
    return { harvested: 0, replanted: 0 };
  }

  console.log(`[FARM] Found ${mature.length} mature crops`);

  let harvested = 0;
  let replanted = 0;

  for (const pos of mature) {
    const block = bot.blockAt(pos);
    if (!block || block.name === "air") continue;

    const info = CROP_INFO[block.name];
    if (!info) continue;

    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 3)), 10000);
    } catch (err: any) {
      bot.pathfinder.stop();
      console.log(`[FARM] Can't reach crop at (${pos.x}, ${pos.y}, ${pos.z}): ${err.message}`);
      continue;
    }

    try {
      await bot.dig(block);
      harvested++;
      console.log(`[FARM] Harvested ${block.name} at (${pos.x}, ${pos.y}, ${pos.z})`);
    } catch (err: any) {
      console.log(`[FARM] Failed to dig ${block.name}: ${err.message}`);
      continue;
    }

    // Replant if we have seeds
    await sleep(200);
    const seed = bot.inventory.items().find((i: any) => i.name === info.seed);
    if (seed) {
      const farmland = bot.blockAt(pos.offset(0, -1, 0));
      if (farmland && farmland.name === "farmland") {
        try {
          await bot.equip(seed, "hand");
          await bot.placeBlock(farmland, new (require("vec3").Vec3)(0, 1, 0));
          replanted++;
        } catch (err: any) {
          console.log(`[FARM] Failed to replant: ${err.message}`);
        }
      }
    }
  }

  console.log(`[FARM] Done — harvested ${harvested}, replanted ${replanted}`);
  return { harvested, replanted };
}
