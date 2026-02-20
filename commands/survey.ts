import type { BotInstance } from "./_helpers";
import { posOf, chunkCoverage } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot, mcData } = instance;
  const radius = Number(params.radius) || 64;

  const logIds = Object.values(mcData.blocksByName)
    .filter((b: any) => b.name.includes("log"))
    .map((b: any) => b.id);
  const logs = bot.findBlocks({ matching: logIds, maxDistance: radius, count: 1000 });

  const waterId = mcData.blocksByName.water?.id;
  const water = waterId ? bot.findBlocks({ matching: waterId, maxDistance: radius, count: 1000 }) : [];

  const lavaId = mcData.blocksByName.lava?.id;
  const lava = lavaId ? bot.findBlocks({ matching: lavaId, maxDistance: radius, count: 1000 }) : [];

  const oreIds = Object.values(mcData.blocksByName)
    .filter((b: any) => b.name.includes("ore"))
    .map((b: any) => b.id);
  const ores = bot.findBlocks({ matching: oreIds, maxDistance: radius, count: 1000 });
  const oreCounts: Record<string, number> = {};
  for (const pos of ores) {
    const block = bot.blockAt(pos);
    if (block) oreCounts[block.name] = (oreCounts[block.name] || 0) + 1;
  }

  const p = bot.entity.position;
  const nearest = (positions: any[]) => {
    if (positions.length === 0) return null;
    const sorted = positions.sort((a: any, b: any) => a.distanceTo(p) - b.distanceTo(p));
    const pos = sorted[0];
    return { x: pos.x, y: pos.y, z: pos.z };
  };

  const nearestOre: Record<string, { x: number; y: number; z: number }> = {};
  for (const pos of ores) {
    const block = bot.blockAt(pos);
    if (block && !nearestOre[block.name]) {
      nearestOre[block.name] = { x: pos.x, y: pos.y, z: pos.z };
    }
  }

  const entities = Object.values(bot.entities) as any[];
  const nearby = entities.filter((e: any) => e !== bot.entity && e.position.distanceTo(p) < radius);
  const players = nearby.filter((e: any) => e.type === "player").map((e: any) => e.username || e.name);
  const hostiles = nearby.filter((e: any) => e.type === "hostile").length;
  const animals = nearby.filter((e: any) => e.type === "animal").length;

  const chunks = chunkCoverage(bot, radius);

  return {
    position: posOf(bot),
    radius,
    chunks,
    blocks: { logs: logs.length, water: water.length, lava: lava.length, ores: oreCounts },
    nearest: {
      log: nearest(logs),
      water: nearest(water),
      lava: nearest(lava),
      ores: nearestOre,
    },
    entities: { players, hostiles, animals },
  };
}
