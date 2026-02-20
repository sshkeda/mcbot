import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const item = bot.inventory.items().find((i: any) => i.name === params.item);
  if (!item) return { error: `no ${params.item} in inventory` };
  await bot.tossStack(item);
  return { status: `dropped ${item.name} x${item.count}` };
}
