import type { BotInstance } from "./_helpers";
import { GoalNear, withTimeout } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const player = params.player;
  if (!player) return { error: "need player param" };
  const target = bot.players[player]?.entity;
  if (!target) return { error: `player "${player}" not found or not nearby` };
  const itemName = params.item;
  const items = bot.inventory.items().filter((i: any) => itemName ? i.name === itemName : i.name.includes("log"));
  if (items.length === 0) return { error: `no ${itemName || "logs"} in inventory` };
  try {
    await withTimeout(bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2)), 15000);
  } catch (err: any) {
    bot.pathfinder.stop();
    return { error: `can't reach ${params.player}: ${err.message}` };
  }
  const given = [];
  for (const item of items) {
    await bot.tossStack(item);
    given.push({ name: item.name, count: item.count });
  }
  return { status: `gave items to ${player}`, items: given };
}
