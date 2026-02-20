import type { BotInstance } from "./_helpers";
import { getLook } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  return getLook(instance.bot);
}
