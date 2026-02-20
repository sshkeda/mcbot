import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const { x, y, z } = params;
  if (!x || !y || !z) return { error: "need x, y, z params" };
  const block = bot.blockAt(new Vec3(Number(x), Number(y), Number(z)));
  if (!block) return { error: "unloaded chunk" };
  return {
    name: block.name,
    type: block.type,
    metadata: block.metadata,
    hardness: block.hardness,
    diggable: block.diggable,
    position: { x: block.position.x, y: block.position.y, z: block.position.z },
    boundingBox: block.boundingBox,
  };
}
