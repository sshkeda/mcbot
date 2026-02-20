import type { BotInstance } from "./_helpers";
import { getStatus } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  const base = getStatus(instance.bot, instance.mcData);
  const m = instance.bot.pathfinder?.movements;
  if (m) {
    (base as any).movements = {
      canDig: m.canDig,
      allowSprinting: m.allowSprinting,
      allowParkour: m.allowParkour,
      allow1by1towers: m.allow1by1towers,
      maxDropDown: m.maxDropDown,
      scafoldingBlocks: (m.scafoldingBlocks || []).map((id: number) => instance.mcData.blocks?.[id]?.name || id),
    };
    (base as any).pathfinderConfig = {
      thinkTimeout: instance.bot.pathfinder.thinkTimeout,
      tickTimeout: instance.bot.pathfinder.tickTimeout,
      enablePathShortcut: instance.bot.pathfinder.enablePathShortcut,
    };
  }
  return base;
}
