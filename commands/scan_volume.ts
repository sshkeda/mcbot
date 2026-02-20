import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";

/** Scan a rectangular volume and return a sparse block list (non-air only). */
export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const x1 = Number(params.x1), y1 = Number(params.y1), z1 = Number(params.z1);
  const x2 = Number(params.x2), y2 = Number(params.y2), z2 = Number(params.z2);
  if ([x1, y1, z1, x2, y2, z2].some(isNaN))
    return { error: "need x1 y1 z1 x2 y2 z2 (two corners of the volume)" };

  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

  const vol = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  if (vol > 10000) return { error: `volume too large: ${vol} blocks (max 10000)` };

  const blocks: { x: number; y: number; z: number; name: string }[] = [];
  const counts: Record<string, number> = {};

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.name !== "air" && block.name !== "cave_air") {
          blocks.push({ x, y, z, name: block.name });
          counts[block.name] = (counts[block.name] || 0) + 1;
        }
      }
    }
  }

  return {
    from: { x: minX, y: minY, z: minZ },
    to: { x: maxX, y: maxY, z: maxZ },
    volume: vol,
    filled: blocks.length,
    air: vol - blocks.length,
    counts,
    blocks,
  };
}
