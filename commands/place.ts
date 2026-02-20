import type { BotInstance } from "./_helpers";
import { Vec3, GoalNear, withTimeout, resolveRelativePos } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  let { x, y, z } = params;
  if (params.dir) {
    const pos = resolveRelativePos(bot, params.dir);
    if (!pos) return { error: `unknown direction "${params.dir}". use: front/back/left/right/up/down` };
    x = String(pos.x); y = String(pos.y); z = String(pos.z);
  }
  if (!x || !y || !z) return { error: "need x,y,z or --dir front/back/left/right/up/down" };
  const blockName = params.block || "cobblestone";
  const item = bot.inventory.items().find((i: any) => i.name === blockName);
  if (!item) return { error: `no ${blockName} in inventory` };
  const targetPos = new Vec3(Number(x), Number(y), Number(z));
  try {
    await withTimeout(bot.pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 4)), 15000);
  } catch (err: any) {
    bot.pathfinder.stop();
    return { error: `can't reach target: ${err.message}` };
  }
  await bot.equip(item, "hand");
  const refBlock = bot.blockAt(targetPos.offset(0, -1, 0)) || bot.blockAt(targetPos.offset(0, 0, -1));
  if (!refBlock) return { error: "no reference block to place against" };
  const faceVec = targetPos.minus(refBlock.position);
  try {
    await bot.placeBlock(refBlock, faceVec);
    return { placed: true, block: blockName, position: { x: targetPos.x, y: targetPos.y, z: targetPos.z } };
  } catch (err: any) {
    return { placed: false, error: err.message };
  }
}
