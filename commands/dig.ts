import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const { x, y, z } = params;
  if (x == null || y == null || z == null) return { error: "need x, y, z params" };
  const target = bot.blockAt(new Vec3(Number(x), Number(y), Number(z)));
  if (!target || target.name === "air") return { error: "no block there" };
  await bot.dig(target);
  return { status: `dug ${target.name}` };
}
