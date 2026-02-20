// Collect nearby dropped items.
// Context: bot, Vec3, GoalNear, sleep, signal, log
// Params: RADIUS (number, default 40)

const radius = typeof RADIUS !== 'undefined' ? RADIUS : 40;
const collected = [];

for (let round = 0; round < 2; round++) {
  if (signal.aborted) break;
  const drops = Object.values(bot.entities)
    .filter(e => e.name === "item" && e.position.distanceTo(bot.entity.position) < radius)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
    .slice(0, 10);

  if (drops.length === 0) break;
  log(`Round ${round + 1}: ${drops.length} items nearby`);

  for (const item of drops) {
    if (signal.aborted || !item.isValid) continue;
    try {
      await bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 2));
    } catch {
      bot.pathfinder.stop();
      continue;
    }
    const start = Date.now();
    while (Date.now() - start < 900) {
      if (!item.isValid || signal.aborted) break;
      await sleep(100);
    }
    bot.pathfinder.stop();
    if (!item.isValid) collected.push("item");
  }
  await sleep(120);
}

log(`Collected ${collected.length} items`);
return { collected: collected.length };
