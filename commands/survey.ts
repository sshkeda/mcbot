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

  // Non-mutating nearest helper
  const nearest = (positions: any[]) => {
    if (positions.length === 0) return null;
    let best = positions[0];
    let bestDist = best.distanceTo(p);
    for (let i = 1; i < positions.length; i++) {
      const d = positions[i].distanceTo(p);
      if (d < bestDist) { best = positions[i]; bestDist = d; }
    }
    return { x: best.x, y: best.y, z: best.z };
  };

  const nearestOre: Record<string, { x: number; y: number; z: number }> = {};
  for (const pos of ores) {
    const block = bot.blockAt(pos);
    if (block && !nearestOre[block.name]) {
      nearestOre[block.name] = { x: pos.x, y: pos.y, z: pos.z };
    }
  }

  // ── Entity tracking ──
  // Build lookup for "mob" type entities that are actually hostile (e.g. slime, ghast, phantom)
  const hostileMobs = new Set(
    Object.values(mcData.entitiesByName)
      .filter((e: any) => e.category === "Hostile mobs" && e.type === "mob")
      .map((e: any) => e.name),
  );
  const isHostile = (e: any) => e.type === "hostile" || hostileMobs.has(e.name);
  const isAnimal = (e: any) => e.type === "animal" || e.type === "passive" || e.type === "ambient";

  const entities = Object.values(bot.entities) as any[];
  const nearby = entities.filter((e: any) => e !== bot.entity && e.position.distanceTo(p) < radius);

  const players = nearby
    .filter((e: any) => e.type === "player")
    .map((e: any) => ({
      name: e.username || e.name,
      position: { x: +e.position.x.toFixed(1), y: +e.position.y.toFixed(1), z: +e.position.z.toFixed(1) },
      distance: +e.position.distanceTo(p).toFixed(1),
    }));

  const hostiles = nearby
    .filter(isHostile)
    .sort((a: any, b: any) => a.position.distanceTo(p) - b.position.distanceTo(p))
    .slice(0, 10)
    .map((e: any) => ({
      name: e.name || e.type,
      position: { x: +e.position.x.toFixed(1), y: +e.position.y.toFixed(1), z: +e.position.z.toFixed(1) },
      distance: +e.position.distanceTo(p).toFixed(1),
    }));

  const animals = nearby
    .filter(isAnimal)
    .sort((a: any, b: any) => a.position.distanceTo(p) - b.position.distanceTo(p))
    .slice(0, 10)
    .map((e: any) => ({
      name: e.name || e.type,
      position: { x: +e.position.x.toFixed(1), y: +e.position.y.toFixed(1), z: +e.position.z.toFixed(1) },
      distance: +e.position.distanceTo(p).toFixed(1),
    }));

  // ── Dropped items on the ground ──
  const items = nearby
    .filter((e: any) => e.name === "item" || e.name === "item_stack")
    .sort((a: any, b: any) => a.position.distanceTo(p) - b.position.distanceTo(p))
    .slice(0, 15)
    .map((e: any) => {
      // prismarine-entity exposes getDroppedItem() on item entities
      const dropped = e.getDroppedItem?.();
      const itemName = dropped?.name || "unknown";
      const count = dropped?.count || 1;
      return {
        name: itemName,
        count,
        position: { x: +e.position.x.toFixed(1), y: +e.position.y.toFixed(1), z: +e.position.z.toFixed(1) },
        distance: +e.position.distanceTo(p).toFixed(1),
      };
    });

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
    entities: {
      players,
      hostiles: { count: nearby.filter(isHostile).length, nearest: hostiles },
      animals: { count: nearby.filter(isAnimal).length, nearest: animals },
      items: { count: nearby.filter((e: any) => e.name === "item" || e.name === "item_stack").length, nearest: items },
    },
  };
}
