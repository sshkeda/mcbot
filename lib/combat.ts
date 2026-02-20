import { sleep } from "./utils";

const BASE_REACH = 3.1;

export function getAttackCooldownMs(bot: any): number {
  const held = bot.heldItem?.name || "";
  if (held.includes("sword")) return 625; // ~1.6 attacks/sec
  if (held.includes("netherite_axe") || held.includes("diamond_axe")) return 1000; // 1.0
  if (held.includes("golden_axe")) return 1000; // 1.0
  if (held.includes("iron_axe")) return 1110; // 0.9
  if (held.includes("stone_axe")) return 1250; // 0.8
  if (held.includes("wooden_axe")) return 1250; // 0.8
  return 600;
}

export function isInMeleeRange(bot: any, target: any, buffer = 0.2): boolean {
  if (!target?.position || !bot?.entity?.position) return false;
  return target.position.distanceTo(bot.entity.position) <= BASE_REACH + buffer;
}

export async function vanillaMeleeAttack(bot: any, target: any): Promise<boolean> {
  if (!target?.isValid) return false;
  if (!isInMeleeRange(bot, target)) return false;

  try {
    const aimPoint = target.position.offset(0, Math.min(1.6, target.height || 1), 0);
    await bot.lookAt(aimPoint, true);
  } catch {}

  // Emulate vanilla sprint-hit behavior for stronger knockback.
  if (bot.entity?.onGround) {
    bot.setControlState("sprint", false);
    await sleep(45);
    bot.setControlState("forward", true);
    bot.setControlState("sprint", true);
    await sleep(70);
  }

  await bot.attack(target);

  bot.setControlState("forward", false);
  return true;
}
