import type { BotInstance } from "./_helpers";
import { posOf } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const timeout = Math.min(Number(params.timeout) || 5_000, 15_000);
  const lastPoll = params.since || null;

  await instance.actionQueue.waitAny(timeout);

  const v = bot.entity.velocity;
  const current = instance.actionQueue.getCurrent();
  const completed = instance.actionQueue.getCompletedSince(lastPoll);
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
    onGround: bot.entity.onGround,
    isCollidedHorizontally: bot.entity.isCollidedHorizontally,
    time: bot.time.isDay ? "day" : "night",
    currentAction: current ? { id: current.id, name: current.name, status: current.status, startedAt: current.startedAt } : null,
    queueLength: pending,
    completed,
    inbox: messages,
    directives,
  };
}
