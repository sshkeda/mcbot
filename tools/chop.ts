import { createRequire } from "node:module";
import { sleep, withTimeout } from "../lib/utils";
const require = createRequire(import.meta.url);

/** Navigate to goal, but abort early if the bot stops making progress */
async function gotoOrBail(bot: any, goal: any, timeout = 15000) {
  // Clear stale stopPathing flag from any previous failed navigation
  if (bot.pathfinder.resetStopFlag) bot.pathfinder.resetStopFlag();
  const nav = bot.pathfinder.goto(goal);
  let lastDist = Infinity;
  let stuckTicks = 0;
  const targetPos = extractGoalPosition(goal);

  const checker = setInterval(() => {
    try {
      if (!targetPos) return;
      const dist = bot.entity.position.distanceTo(targetPos as any);
      if (Math.abs(dist - lastDist) < 0.2) {
        stuckTicks++;
      } else {
        stuckTicks = 0;
      }
      lastDist = dist;
      // If stuck for ~10s, abort and let caller retry another target.
      if (stuckTicks >= 10) {
        bot.pathfinder.stop();
        clearInterval(checker);
      }
    } catch {}
  }, 1000);

  try {
    await withTimeout(nav, timeout);
  } finally {
    clearInterval(checker);
  }
}

function extractGoalPosition(goal: any): { x: number; y: number; z: number } | null {
  if (!goal) return null;
  if (typeof goal.x === "number" && typeof goal.y === "number" && typeof goal.z === "number") {
    return { x: goal.x, y: goal.y, z: goal.z };
  }
  if (goal.position && typeof goal.position.x === "number" && typeof goal.position.y === "number" && typeof goal.position.z === "number") {
    return { x: goal.position.x, y: goal.position.y, z: goal.position.z };
  }
  return null;
}

export async function chopNearestTree(bot: any, pathfinder: any, maxDistance = 32) {
  const { GoalNear } = pathfinder.goals;
  const mcData = require("minecraft-data")(bot.version);

  const logTypes = Object.values(mcData.blocksByName)
    .filter((b: any) => b.name.includes("_log"))
    .map((b: any) => b.id);

  // Find candidate logs, grouped into unique trees by trunk
  const logBlocks = bot.findBlocks({ matching: logTypes, maxDistance, count: 50 });
  if (!logBlocks.length) {
    console.log(`[CHOP] No trees within ${maxDistance} blocks`);
    return [];
  }

  // Group logs into distinct trees (by trunk connectivity)
  const visited = new Set<string>();
  const trees: { trunk: any[]; lowestY: number; basePos: any }[] = [];

  for (const pos of logBlocks) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) continue;
    const block = bot.blockAt(pos);
    if (!block) continue;
    const trunk = findTrunk(bot, block, logTypes);
    for (const t of trunk) visited.add(`${t.position.x},${t.position.y},${t.position.z}`);
    const lowestLog = trunk.reduce((a: any, b: any) => a.position.y < b.position.y ? a : b, trunk[0]);
    trees.push({ trunk, lowestY: lowestLog.position.y, basePos: lowestLog.position });
  }

  // Sort trees by distance to the lowest log (most likely reachable base)
  const botPos = bot.entity.position;
  trees.sort((a, b) => a.basePos.distanceTo(botPos) - b.basePos.distanceTo(botPos));

  console.log(`[CHOP] Found ${trees.length} trees within ${maxDistance} blocks`);

  const allChopped: string[] = [];

  // Try each tree until we chop at least one, or exhaust candidates
  for (const tree of trees) {
    const base = tree.trunk.reduce((a: any, b: any) => a.position.y < b.position.y ? a : b, tree.trunk[0]);
    console.log(`[CHOP] Trying tree at (${base.position.x}, ${base.position.y}, ${base.position.z}) with ${tree.trunk.length} logs`);

    // Try to reach the base log first
    let reachable = false;
    try {
      await gotoOrBail(bot, new GoalNear(base.position.x, base.position.y, base.position.z, 4), 15000);
      reachable = true;
    } catch (err: any) {
      console.log(`[CHOP] Can't reach tree base at (${base.position.x}, ${base.position.y}, ${base.position.z}): ${err.message}`);
      bot.pathfinder.stop();
    }

    if (!reachable) continue; // Try next tree

    // Chop this tree — start from bottom
    tree.trunk.sort((a: any, b: any) => a.position.y - b.position.y);
    for (const log of tree.trunk) {
      try {
        await gotoOrBail(bot, new GoalNear(log.position.x, log.position.y, log.position.z, 4), 10000);
        if (bot.canDigBlock(log)) {
          await bot.dig(log);
          allChopped.push(log.name);
          console.log(`[CHOP] Broke ${log.name} at Y:${log.position.y}`);
        }
      } catch (err: any) {
        console.log(`[CHOP] Can't reach log at Y:${log.position.y}: ${err.message}`);
        bot.pathfinder.stop();
        // Upper logs unreachable is normal — just move on
      }
    }

    if (allChopped.length > 0) break; // Successfully chopped at least one tree
  }

  // Auto-collect nearby drops (best-effort, capped)
  await sleep(200);
  const drops = Object.values(bot.entities)
    .filter((e: any) => e.name === "item" && e.position.distanceTo(bot.entity.position) < 12)
    .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
    .slice(0, 5) as any[];
  for (const drop of drops) {
    if (!drop.isValid) continue;
    try {
      await gotoOrBail(bot, new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1), 5000);
      await sleep(120);
    } catch {
      bot.pathfinder.stop();
    }
  }

  console.log(`[CHOP] Done, broke ${allChopped.length} logs across ${trees.length} trees tried`);
  return allChopped;
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
