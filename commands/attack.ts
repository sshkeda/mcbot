import type { BotInstance } from "./_helpers";
import { vanillaMeleeAttack } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const targetName = params.target;
  const entities = Object.values(bot.entities) as any[];
  if (targetName) {
    const player = entities
      .filter((e: any) => e.type === "player" && e.username?.toLowerCase() === targetName.toLowerCase())
      .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (!player) return { error: `player ${targetName} not found nearby` };
    const dist = player.position.distanceTo(bot.entity.position);
    if (dist > 3.6) return { error: `${targetName} is ${dist.toFixed(1)}m away, need to be within 3.6 blocks` };
    await vanillaMeleeAttack(bot, player);
    return { status: `attacked player ${player.username} (${dist.toFixed(1)}m)` };
  }
  const hostile = entities
    .filter((e: any) => e.type === "hostile" && e.position.distanceTo(bot.entity.position) < 5)
    .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  if (!hostile) return { error: "no hostile mobs within 5 blocks" };
  await vanillaMeleeAttack(bot, hostile);
  return { status: `attacked ${hostile.name}` };
}
