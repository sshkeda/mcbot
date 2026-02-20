import { createRequire } from "node:module";
import { withTimeout } from "../lib/utils";
const require = createRequire(import.meta.url);
const Vec3 = require("vec3").Vec3;

const DIRECTIONS: Record<string, (yaw: number) => [number, number, number]> = {
  front: (yaw) => [Math.round(-Math.sin(yaw)), 0, Math.round(-Math.cos(yaw))],
  back:  (yaw) => [Math.round(Math.sin(yaw)), 0, Math.round(Math.cos(yaw))],
  left:  (yaw) => [Math.round(-Math.cos(yaw)), 0, Math.round(Math.sin(yaw))],
  right: (yaw) => [Math.round(Math.cos(yaw)), 0, Math.round(-Math.sin(yaw))],
  up:    () => [0, 1, 0],
  down:  () => [0, -1, 0],
};

export function resolveRelativePos(bot: any, direction: string): { x: number; y: number; z: number } | null {
  const fn = DIRECTIONS[direction];
  if (!fn) return null;
  const [dx, dy, dz] = fn(bot.entity.yaw);
  const p = bot.entity.position;
  return {
    x: Math.floor(p.x) + dx,
    y: Math.floor(p.y) + dy,
    z: Math.floor(p.z) + dz,
  };
}

export async function placeBlock(bot: any, pathfinder: any, blockName: string, x: number, y: number, z: number) {
  const { GoalNear } = pathfinder.goals;

  const item = bot.inventory.items().find((i: any) => i.name === blockName) ||
    bot.inventory.items().find((i: any) => i.name.includes(blockName));
  if (!item) {
    console.log(`[BUILD] No "${blockName}" in inventory`);
    return { placed: false, error: `no ${blockName} in inventory` };
  }

  const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const existing = bot.blockAt(targetPos);
  if (existing && existing.name !== "air" && existing.boundingBox === "block") {
    return { placed: false, error: `position already occupied by ${existing.name}` };
  }
  console.log(`[BUILD] Placing ${item.name} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);

  try {
    await withTimeout(bot.pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2)), 15000);
  } catch (err: any) {
    bot.pathfinder.stop();
    console.log(`[BUILD] Can't reach target: ${err.message}`);
    return { placed: false, error: `can't reach position: ${err.message}` };
  }
  await bot.equip(item, "hand");

  const offsets: Array<[number, number, number]> = [
    [0, -1, 0], [0, 1, 0],
    [1, 0, 0], [-1, 0, 0],
    [0, 0, 1], [0, 0, -1],
    [1, -1, 0], [-1, -1, 0],
    [0, -1, 1], [0, -1, -1],
  ];

  for (const [dx, dy, dz] of offsets) {
    const refPos = targetPos.offset(dx, dy, dz);
    const ref = bot.blockAt(refPos);
    if (ref && ref.name !== "air" && ref.boundingBox === "block") {
      const faceVec = new Vec3(-dx, -dy, -dz);
      try {
        await bot.placeBlock(ref, faceVec);
        console.log(`[BUILD] Placed ${item.name}`);
        return { placed: true, block: item.name, position: { x: targetPos.x, y: targetPos.y, z: targetPos.z } };
      } catch (err: any) {
        console.log(`[BUILD] Failed against (${refPos.x}, ${refPos.y}, ${refPos.z}): ${err.message}`);
        continue;
      }
    }
  }

  console.log("[BUILD] No adjacent block to place against");
  return { placed: false, error: "no adjacent solid block to place against" };
}
