/**
 * @skill fight
 * @description Fight nearby hostile mobs with auto weapon equip
 * @tags combat
 */

// Fight nearby hostile mobs. Auto-equips best weapon.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log
// Params: RADIUS (number, default 16), MAX_KILLS (number, default 10)

const radius = typeof RADIUS !== 'undefined' ? RADIUS : 16;
const maxKills = typeof MAX_KILLS !== 'undefined' ? MAX_KILLS : 10;

// Equip best weapon (prefer swords)
const weapons = bot.inventory.items().filter(i => i.name.includes("sword") || i.name.includes("axe"));
if (weapons.length > 0) {
  const tier = ["netherite", "diamond", "iron", "golden", "stone", "wooden"];
  weapons.sort((a, b) => {
    const aS = a.name.includes("sword") ? 0 : 1;
    const bS = b.name.includes("sword") ? 0 : 1;
    if (aS !== bS) return aS - bS;
    const ai = tier.findIndex(t => a.name.includes(t));
    const bi = tier.findIndex(t => b.name.includes(t));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  await bot.equip(weapons[0], "hand").catch(() => {});
}

// Attack cooldown by weapon type (ms)
function getCooldown() {
  const held = bot.heldItem;
  if (!held) return 250;
  if (held.name.includes("sword")) return 625;
  if (held.name.includes("axe")) return 1000;
  return 250;
}

let lastAttack = 0;
const killed = [];

for (let i = 0; i < maxKills; i++) {
  if (signal.aborted) break;

  const hostile = Object.values(bot.entities)
    .filter(e => e.type === "hostile" && e.position.distanceTo(bot.entity.position) < radius)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];

  if (!hostile) { log("No hostiles nearby"); break; }
  log(`Targeting ${hostile.name} (${hostile.position.distanceTo(bot.entity.position).toFixed(1)}m)`);

  try {
    await bot.pathfinder.goto(new GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 3));
  } catch (err) {
    bot.pathfinder.stop();
    log(`Can't reach ${hostile.name}: ${err.message}`);
    continue;
  }

  while (hostile.isValid && hostile.position.distanceTo(bot.entity.position) < radius && !signal.aborted) {
    const dist = hostile.position.distanceTo(bot.entity.position);
    if (dist > 3.3) {
      bot.pathfinder.setGoal(new GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2), true);
    } else {
      bot.pathfinder.stop();
    }

    const now = Date.now();
    if (now - lastAttack >= getCooldown() && dist <= 3.5) {
      await bot.lookAt(hostile.position.offset(0, hostile.height * 0.85, 0), true);
      bot.setControlState("sprint", true);
      bot.attack(hostile);
      bot.setControlState("sprint", false);
      lastAttack = Date.now();
    }
    await sleep(50);
  }

  bot.pathfinder.stop();
  if (!hostile.isValid) {
    killed.push(hostile.name);
    log(`Killed ${hostile.name} (${killed.length}/${maxKills})`);
  }
}

log(`Done, killed ${killed.length} mobs`);
return { killed: killed.length, mobs: killed };
