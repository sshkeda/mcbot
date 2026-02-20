import type { BotInstance } from "./_helpers";
import { getInventory } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  return getInventory(instance.bot);
}
