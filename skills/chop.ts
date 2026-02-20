/**
 * @skill chop
 * @description Find nearest tree, chop it down, collect dropped logs
 * @tags gathering, wood
 */

// Find nearest tree, chop it, collect drops.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log

const logTypes = Object.values(mcData.blocksByName)
  .filter(b => b.name.includes("_log"))
  .map(b => b.id);

const logBlocks = bot.findBlocks({ matching: logTypes, maxDistance: 32, count: 50 });
if (!logBlocks.length) return { chopped: 0, message: "no trees nearby" };

// Group logs into trees by trunk connectivity (BFS)
const visited = new Set();
const trees = [];

for (const pos of logBlocks) {
  const key = `${pos.x},${pos.y},${pos.z}`;
  if (visited.has(key)) continue;
  const block = bot.blockAt(pos);
  if (!block) continue;

  // BFS to find connected trunk
  const trunk = [];
  const queue = [block.position.clone()];
  while (queue.length > 0) {
    const p = queue.shift();
    const k = `${p.x},${p.y},${p.z}`;
    if (visited.has(k)) continue;
    visited.add(k);
    const b = bot.blockAt(p);
    if (!b || !logTypes.includes(b.type)) continue;
    trunk.push(b);
    for (const [dx, dy, dz] of [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
      queue.push(p.offset(dx, dy, dz));
    }
  }

  const lowest = trunk.reduce((a, b) => a.position.y < b.position.y ? a : b, trunk[0]);
  trees.push({ trunk, basePos: lowest.position });
}

// Sort trees by distance
const botPos = bot.entity.position;
trees.sort((a, b) => a.basePos.distanceTo(botPos) - b.basePos.distanceTo(botPos));
log(`Found ${trees.length} trees`);

const allChopped = [];

for (const tree of trees) {
  if (signal.aborted) break;
  const base = tree.trunk.reduce((a, b) => a.position.y < b.position.y ? a : b, tree.trunk[0]);
  log(`Trying tree at ${base.position.x}, ${base.position.y}, ${base.position.z} (${tree.trunk.length} logs)`);

  try {
    await bot.pathfinder.goto(new GoalNear(base.position.x, base.position.y, base.position.z, 4));
  } catch (err) {
    log(`Can't reach tree: ${err.message}`);
    bot.pathfinder.stop();
    continue;
  }

  // Chop bottom-up
  tree.trunk.sort((a, b) => a.position.y - b.position.y);
  for (const logBlock of tree.trunk) {
    if (signal.aborted) break;
    try {
      await bot.pathfinder.goto(new GoalNear(logBlock.position.x, logBlock.position.y, logBlock.position.z, 4));
      if (bot.canDigBlock(logBlock)) {
        await bot.dig(logBlock);
        allChopped.push(logBlock.name);
        log(`Broke ${logBlock.name} at Y:${logBlock.position.y}`);
      }
    } catch (err) {
      log(`Can't reach log at Y:${logBlock.position.y}: ${err.message}`);
      bot.pathfinder.stop();
    }
  }

  if (allChopped.length > 0) break;
}

// Auto-collect nearby drops
await sleep(200);
const drops = Object.values(bot.entities)
  .filter(e => e.name === "item" && e.position.distanceTo(bot.entity.position) < 12)
  .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
  .slice(0, 5);
for (const drop of drops) {
  if (signal.aborted || !drop.isValid) continue;
  try {
    await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
    await sleep(120);
  } catch { bot.pathfinder.stop(); }
}

log(`Done, chopped ${allChopped.length} logs`);
return { chopped: allChopped.length, logs: allChopped };
