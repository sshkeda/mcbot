import { sleep, withTimeout } from "../lib/utils";

export async function pickupItems(bot: any, pathfinder: any, radius = 40) {
  const { GoalNear } = pathfinder.goals;
  const collected: string[] = [];

  for (let round = 0; round < 2; round++) {
    const drops = Object.values(bot.entities)
      .filter((e: any) => e.name === "item" && e.position.distanceTo(bot.entity.position) < radius)
      .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
      .slice(0, 10) as any[];

    if (drops.length === 0) break;
    console.log(`[PICKUP] Round ${round + 1}: ${drops.length} items nearby`);

    for (const item of drops) {
      if (!item.isValid) continue;
      try {
        await withTimeout(
          bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 2)),
          5000
        );
      } catch {
        bot.pathfinder.stop();
        continue;
      }
      // Wait briefly for auto-pickup
      const start = Date.now();
      while (Date.now() - start < 900) {
        if (!item.isValid) break;
        await sleep(100);
      }
      bot.pathfinder.stop();
      if (!item.isValid) collected.push("item");
    }
    await sleep(120);
  }

  console.log(`[PICKUP] Collected ${collected.length} items`);
  return collected;
}
