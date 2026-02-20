import { sleep, withTimeout } from "../lib/utils";

export async function fightMobs(bot: any, pathfinder: any, opts: { radius?: number; count?: number } = {}) {
  const { GoalNear } = pathfinder.goals;
  const radius = opts.radius || 16;
  const maxKills = opts.count || 10;

  await equipBestWeapon(bot);

  const killed: string[] = [];

  for (let i = 0; i < maxKills; i++) {
    const hostile = findNearestHostile(bot, radius);
    if (!hostile) {
      console.log("[FIGHT] No hostiles nearby");
      break;
    }

    console.log(`[FIGHT] Targeting ${hostile.name} (${hostile.position.distanceTo(bot.entity.position).toFixed(1)}m away)`);

    try {
      await withTimeout(bot.pathfinder.goto(new GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 3)), 10000);
    } catch (err: any) {
      bot.pathfinder.stop();
      console.log(`[FIGHT] Can't reach ${hostile.name}: ${err.message}`);
      continue;
    }

    // Attack until dead or gone
    while (hostile.isValid && hostile.position.distanceTo(bot.entity.position) < radius) {
      if (hostile.position.distanceTo(bot.entity.position) > 4) {
        bot.pathfinder.setGoal(new GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 3));
      }
      await bot.attack(hostile);
      await sleep(500);
    }

    bot.pathfinder.stop();
    if (!hostile.isValid) {
      killed.push(hostile.name);
      console.log(`[FIGHT] Killed ${hostile.name} (${killed.length}/${maxKills})`);
    }
  }

  console.log(`[FIGHT] Done, killed ${killed.length} mobs`);
  return killed;
}

function findNearestHostile(bot: any, radius: number) {
  const entities = Object.values(bot.entities) as any[];
  return entities
    .filter((e: any) => e.type === "hostile" && e.position.distanceTo(bot.entity.position) < radius)
    .sort((a: any, b: any) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] || null;
}

async function equipBestWeapon(bot: any) {
  const weapons = bot.inventory.items().filter((i: any) =>
    i.name.includes("sword") || i.name.includes("axe")
  );
  if (weapons.length === 0) return;

  const tier = ["netherite", "diamond", "iron", "golden", "stone", "wooden"];
  // Prefer swords over axes
  weapons.sort((a: any, b: any) => {
    const aIsSword = a.name.includes("sword") ? 0 : 1;
    const bIsSword = b.name.includes("sword") ? 0 : 1;
    if (aIsSword !== bIsSword) return aIsSword - bIsSword;
    const ai = tier.findIndex((t) => a.name.includes(t));
    const bi = tier.findIndex((t) => b.name.includes(t));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  await bot.equip(weapons[0], "hand").catch(() => {});
}
