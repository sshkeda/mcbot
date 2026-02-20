import { createRequire } from "node:module";
import { sleep, withTimeout } from "../lib/utils";
const require = createRequire(import.meta.url);

export async function chopNearestTree(bot: any, pathfinder: any, maxDistance = 32) {
  const { GoalNear } = pathfinder.goals;
  const mcData = require("minecraft-data")(bot.version);

  const logTypes = Object.values(mcData.blocksByName)
    .filter((b: any) => b.name.includes("_log"))
    .map((b: any) => b.id);

  const logBlock = bot.findBlock({ matching: logTypes, maxDistance });
  if (!logBlock) {
    console.log(`[CHOP] No trees within ${maxDistance} blocks`);
    return [];
  }

  console.log(`[CHOP] Found ${logBlock.name} at (${logBlock.position.x}, ${logBlock.position.y}, ${logBlock.position.z})`);

  const trunk = findTrunk(bot, logBlock, logTypes);
  trunk.sort((a: any, b: any) => a.position.y - b.position.y);
  console.log(`[CHOP] ${trunk.length} logs to chop`);

  const chopped: string[] = [];
  for (const log of trunk) {
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(log.position.x, log.position.y, log.position.z, 4)), 15000);
      if (bot.canDigBlock(log)) {
        await bot.dig(log);
        chopped.push(log.name);
        console.log(`[CHOP] Broke ${log.name} at Y:${log.position.y}`);
      }
    } catch (err: any) {
      console.log(`[CHOP] Can't reach log at Y:${log.position.y}: ${err.message}`);
    }
  }

  // Auto-collect nearby drops (best-effort, capped)
  await sleep(500);
  const drops = Object.values(bot.entities)
    .filter((e: any) => e.name === "item" && e.position.distanceTo(bot.entity.position) < 12)
    .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
    .slice(0, 5) as any[];
  for (const drop of drops) {
    if (!drop.isValid) continue;
    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)), 5000);
      await sleep(200);
    } catch {
      bot.pathfinder.stop();
    }
  }

  console.log(`[CHOP] Done, broke ${chopped.length}/${trunk.length} logs`);
  return chopped;
}

function findTrunk(bot: any, start: any, logTypes: number[]) {
  const visited = new Set<string>();
  const trunk: any[] = [];
  const queue = [start.position.clone()];

  while (queue.length > 0) {
    const pos = queue.shift();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const block = bot.blockAt(pos);
    if (!block || !logTypes.includes(block.type)) continue;
    trunk.push(block);

    for (const [dx, dy, dz] of [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
      queue.push(pos.offset(dx, dy, dz));
    }
  }
  return trunk;
}
