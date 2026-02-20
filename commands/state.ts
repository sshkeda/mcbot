import type { BotInstance } from "./_helpers";
import { posOf } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  const { bot } = instance;
  const p = bot.entity.position;
  const v = bot.entity.velocity;
  const current = instance.actionQueue.getCurrent();
  const pending = instance.actionQueue.getState().filter((a: any) => a.status === "pending").length;
  return {
    position: posOf(bot),
    velocity: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) },
    health: bot.health,
    food: bot.food,
    yaw: +bot.entity.yaw.toFixed(2),
    onGround: bot.entity.onGround,
    isCollidedHorizontally: bot.entity.isCollidedHorizontally,
    biome: (() => {
      const block = bot.blockAt(p);
      if (!block?.biome) return "unknown";
      const b = block.biome;
      const id = typeof b === "object" ? b.id : b;
      return instance.mcData.biomes?.[id]?.name || `biome:${id}`;
    })(),
    time: bot.time.isDay ? "day" : "night",
    currentAction: current ? { id: current.id, name: current.name, status: current.status } : null,
    queueLength: pending,
    inboxCount: instance.chatInbox.length,
    directiveCount: instance.directives.length,
  };
}
