import type { BotInstance } from "./_helpers";
import { execFileAsync } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  const { bot } = instance;
  const p = bot.entity.position;
  const file = `/tmp/mcbot-${instance.name}-render-${Date.now()}.png`;

  const { stdout } = await execFileAsync("node", [
    `${import.meta.dirname}/../render.cjs`,
    instance.host, String(instance.port), instance.version,
    String(p.x), String(p.y + 1.62), String(p.z),
    String(bot.entity.yaw), String(bot.entity.pitch),
    file,
  ], { timeout: 55000 });

  return { file: stdout.trim() };
}
