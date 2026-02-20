import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const peek = params.peek === "true" || params.peek === true;
  const clear = params.clear === "true" || params.clear === true;
  if (clear) {
    const cleared = instance.directives.length;
    instance.directives.length = 0;
    return { status: "directives cleared", cleared };
  }
  const items = [...instance.directives];
  if (!peek) instance.directives.length = 0;
  return { directives: items, count: items.length, peeked: peek };
}
