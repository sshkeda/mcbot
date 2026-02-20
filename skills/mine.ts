import { createRequire } from "node:module";
import { sleep, withTimeout } from "../lib/utils";
const require = createRequire(import.meta.url);

export async function mineBlocks(bot: any, pathfinder: any, blockName: string, opts: { radius?: number; count?: number } = {}) {
  const { GoalNear } = pathfinder.goals;
  const mcData = require("minecraft-data")(bot.version);
  const radius = opts.radius || 32;
  const count = opts.count || 1;

  const matchIds = Object.values(mcData.blocksByName)
    .filter((b: any) => b.name.includes(blockName))
    .map((b: any) => b.id);

  if (matchIds.length === 0) {
    console.log(`[MINE] No block type matching "${blockName}"`);
    return [];
  }

  await equipBestTool(bot);

  const mined: string[] = [];
  for (let i = 0; i < count; i++) {
    const target = bot.findBlock({ matching: matchIds, maxDistance: radius });
    if (!target) {
      console.log(`[MINE] No more "${blockName}" within ${radius} blocks`);
      break;
    }

    console.log(`[MINE] Found ${target.name} at (${target.position.x}, ${target.position.y}, ${target.position.z})`);

    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 4)), 15000);
    } catch (err: any) {
      bot.pathfinder.stop();
      console.log(`[MINE] Can't reach block: ${err.message}`);
      continue;
    }

    if (bot.canDigBlock(target)) {
      const digPos = target.position.clone();
      await bot.dig(target);
      mined.push(target.name);
      console.log(`[MINE] Broke ${target.name} (${mined.length}/${count})`);

      // Auto-collect the drop
      await sleep(300);
      const drop = Object.values(bot.entities).find(
        (e: any) => e.name === "item" && e.position.distanceTo(digPos) < 3
      ) as any;
      if (drop?.isValid) {
        try {
          await withTimeout(bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)), 5000);
          await sleep(200);
        } catch {
          bot.pathfinder.stop();
        }
      }
    }
  }

  console.log(`[MINE] Done, broke ${mined.length} blocks`);
  return mined;
}

async function equipBestTool(bot: any) {
  const picks = bot.inventory.items().filter((i: any) =>
    i.name.includes("pickaxe")
  );
  if (picks.length === 0) return;

  const tier = ["netherite", "diamond", "iron", "golden", "stone", "wooden"];
  picks.sort((a: any, b: any) => {
    const ai = tier.findIndex((t) => a.name.includes(t));
    const bi = tier.findIndex((t) => b.name.includes(t));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  await bot.equip(picks[0], "hand").catch(() => {});
}
