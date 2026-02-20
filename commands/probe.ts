import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const x = Number(params.x), y = Number(params.y), z = Number(params.z);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return { error: "need x, y, z" };

  const block = bot.blockAt(new Vec3(x, y, z));
  if (!block) return { position: { x, y, z }, block: null, note: "unloaded chunk" };

  return {
    position: { x, y, z },
    block: block.name,
    solid: block.boundingBox === "block",
    diggable: block.diggable,
    ...(block.metadata !== 0 && { metadata: block.metadata }),
    ...(block.getProperties && Object.keys(block.getProperties()).length > 0 && { properties: block.getProperties() }),
  };
}
