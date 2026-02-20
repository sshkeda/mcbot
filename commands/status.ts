import type { BotInstance } from "./_helpers";
import { getStatus } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  return getStatus(instance.bot, instance.mcData);
}
