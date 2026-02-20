import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const item = bot.inventory.items().find((i: any) => i.name === params.item);
  if (!item) return { error: `no ${params.item} in inventory` };
  await bot.equip(item, params.slot || "hand");
  return { status: `equipped ${item.name}` };
}
