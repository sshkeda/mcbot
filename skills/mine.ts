/**
 * @skill mine
 * @description Mine blocks by name with auto tool equip and drop collection
 * @tags gathering, mining
 */

// Mine blocks by name. Set BLOCK_NAME and COUNT before executing.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log
// Params: BLOCK_NAME (string), COUNT (number, default 1), RADIUS (number, default 32)

const blockName = typeof BLOCK_NAME !== 'undefined' ? BLOCK_NAME : 'stone';
const count = typeof COUNT !== 'undefined' ? COUNT : 1;
const radius = typeof RADIUS !== 'undefined' ? RADIUS : 32;

const matchIds = Object.values(mcData.blocksByName)
  .filter(b => b.name.includes(blockName))
  .map(b => b.id);

if (matchIds.length === 0) return { mined: 0, error: `no block type matching "${blockName}"` };

// Equip best pickaxe
const picks = bot.inventory.items().filter(i => i.name.includes("pickaxe"));
if (picks.length > 0) {
  const tier = ["netherite", "diamond", "iron", "golden", "stone", "wooden"];
  picks.sort((a, b) => {
    const ai = tier.findIndex(t => a.name.includes(t));
    const bi = tier.findIndex(t => b.name.includes(t));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  await bot.equip(picks[0], "hand").catch(() => {});
}

const mined = [];
for (let i = 0; i < count; i++) {
  if (signal.aborted) break;
  const target = bot.findBlock({ matching: matchIds, maxDistance: radius });
  if (!target) { log(`No more "${blockName}" within ${radius} blocks`); break; }

  log(`Found ${target.name} at ${target.position.x}, ${target.position.y}, ${target.position.z}`);

  try {
    await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 4));
  } catch (err) {
    bot.pathfinder.stop();
    log(`Can't reach: ${err.message}`);
    continue;
  }

  if (bot.canDigBlock(target)) {
    const digPos = target.position.clone();
    await bot.dig(target);
    mined.push(target.name);
    log(`Mined ${target.name} (${mined.length}/${count})`);

    // Auto-collect drop
    await sleep(120);
    const drop = Object.values(bot.entities).find(
      e => e.name === "item" && e.position.distanceTo(digPos) < 3
    );
    if (drop?.isValid) {
      try {
        await bot.pathfinder.goto(new GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
        await sleep(80);
      } catch { bot.pathfinder.stop(); }
    }
  }
}

log(`Done, mined ${mined.length} blocks`);
return { mined: mined.length, blocks: mined };
