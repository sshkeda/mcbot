// Harvest mature crops and replant.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log
// Params: RADIUS (number, default 16)

const radius = typeof RADIUS !== 'undefined' ? RADIUS : 16;

const CROP_INFO = {
  wheat: { maxAge: 7, seed: "wheat_seeds" },
  carrots: { maxAge: 7, seed: "carrot" },
  potatoes: { maxAge: 7, seed: "potato" },
  beetroots: { maxAge: 3, seed: "beetroot_seeds" },
};

const cropIds = Object.keys(CROP_INFO)
  .map(name => mcData.blocksByName[name]?.id)
  .filter(Boolean);

const positions = bot.findBlocks({ matching: cropIds, maxDistance: radius, count: 100 });
const mature = positions.filter(pos => {
  const block = bot.blockAt(pos);
  if (!block) return false;
  const info = CROP_INFO[block.name];
  return info && block.metadata === info.maxAge;
});

if (mature.length === 0) return { harvested: 0, replanted: 0, message: "no mature crops" };
log(`Found ${mature.length} mature crops`);

let harvested = 0;
let replanted = 0;

for (const pos of mature) {
  if (signal.aborted) break;
  const block = bot.blockAt(pos);
  if (!block || block.name === "air") continue;
  const info = CROP_INFO[block.name];
  if (!info) continue;

  try {
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 3));
  } catch (err) {
    bot.pathfinder.stop();
    continue;
  }

  try {
    await bot.dig(block);
    harvested++;
    log(`Harvested ${block.name}`);
  } catch (err) {
    log(`Failed to dig: ${err.message}`);
    continue;
  }

  // Replant
  await sleep(200);
  const seed = bot.inventory.items().find(i => i.name === info.seed);
  if (seed) {
    const farmland = bot.blockAt(pos.offset(0, -1, 0));
    if (farmland && farmland.name === "farmland") {
      try {
        await bot.equip(seed, "hand");
        await bot.placeBlock(farmland, new Vec3(0, 1, 0));
        replanted++;
      } catch (err) {
        log(`Replant failed: ${err.message}`);
      }
    }
  }
}

log(`Done — harvested ${harvested}, replanted ${replanted}`);
return { harvested, replanted };
