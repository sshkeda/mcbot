import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const text = params.message;
  if (!text) return { error: "need message param" };
  const interrupt = params.interrupt === "true" || params.interrupt === true;
  instance.directives.push({ text, ts: new Date().toISOString(), interrupt });
  if (instance.directives.length > 50) instance.directives.shift();
  if (interrupt) {
    bot.pathfinder.stop();
    bot.stopDigging?.();
  }
  return { status: interrupt ? "directive posted + interrupted current action" : "directive posted", pending: instance.directives.length };
}
