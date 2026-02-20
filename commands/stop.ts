import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  instance.bot.pathfinder.stop();
  return { status: "stopped" };
}
