// Place a block at coordinates.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log
// Params: BLOCK_NAME (string), X (number), Y (number), Z (number)

const blockName = typeof BLOCK_NAME !== 'undefined' ? BLOCK_NAME : 'cobblestone';
const x = typeof X !== 'undefined' ? X : 0;
const y = typeof Y !== 'undefined' ? Y : 0;
const z = typeof Z !== 'undefined' ? Z : 0;

const item = bot.inventory.items().find(i => i.name === blockName) ||
  bot.inventory.items().find(i => i.name.includes(blockName));
if (!item) return { placed: false, error: `no ${blockName} in inventory` };

const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
const existing = bot.blockAt(targetPos);
if (existing && existing.name !== "air" && existing.boundingBox === "block") {
  return { placed: false, error: `position occupied by ${existing.name}` };
}

log(`Placing ${item.name} at ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);

try {
  await bot.pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2));
} catch (err) {
  bot.pathfinder.stop();
  return { placed: false, error: `can't reach: ${err.message}` };
}

await bot.equip(item, "hand");

const offsets = [
  [0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],
  [1,-1,0],[-1,-1,0],[0,-1,1],[0,-1,-1],
];

for (const [dx, dy, dz] of offsets) {
  if (signal.aborted) break;
  const refPos = targetPos.offset(dx, dy, dz);
  const ref = bot.blockAt(refPos);
  if (ref && ref.name !== "air" && ref.boundingBox === "block") {
    try {
      await bot.placeBlock(ref, new Vec3(-dx, -dy, -dz));
      log(`Placed ${item.name}`);
      return { placed: true, block: item.name, position: { x: targetPos.x, y: targetPos.y, z: targetPos.z } };
    } catch (err) {
      log(`Failed against ${refPos}: ${err.message}`);
      continue;
    }
  }
}

return { placed: false, error: "no adjacent solid block to place against" };
