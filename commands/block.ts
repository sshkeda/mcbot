import type { BotInstance } from "./_helpers";
import { Vec3, isChunkLoaded } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const { x, y, z } = params;
  if (x == null || y == null || z == null) return { error: "need x, y, z params" };
  const nx = Number(x), ny = Number(y), nz = Number(z);
  if (!isChunkLoaded(bot, nx, nz)) return { error: "unloaded chunk", chunkLoaded: false };
  const block = bot.blockAt(new Vec3(nx, ny, nz));
  if (!block) return { error: "no block data", chunkLoaded: true };
  return {
    name: block.name,
    type: block.type,
    metadata: block.metadata,
    hardness: block.hardness,
    diggable: block.diggable,
    position: { x: block.position.x, y: block.position.y, z: block.position.z },
    boundingBox: block.boundingBox,
    chunkLoaded: true,
  };
}
