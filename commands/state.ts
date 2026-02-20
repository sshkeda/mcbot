import type { BotInstance } from "./_helpers";
import { posOf } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;

  // Always wait up to 5s for an action to finish, then snapshot.
  await instance.actionQueue.waitAny(5_000);

  const p = bot.entity.position;
  const v = bot.entity.velocity;
  const current = instance.actionQueue.getCurrent();
  const completed = instance.actionQueue.getCompletedSince(params.since || null);
  const pending = instance.actionQueue.getState().filter((a: any) => a.status === "pending").length;
  const messages = [...instance.chatInbox];
  instance.chatInbox.length = 0;
  const directives = [...instance.directives];
  instance.directives.length = 0;

  return {
    ts: new Date().toISOString(),
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
    currentAction: current ? { id: current.id, name: current.name, status: current.status, startedAt: current.startedAt } : null,
    queueLength: pending,
    completed,
    inbox: messages,
    directives,
  };
}
