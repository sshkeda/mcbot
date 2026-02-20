import type { BotInstance } from "./_helpers";
import { execFileAsync } from "./_helpers";

function asBool(value: any): boolean {
  if (value == null) return false;
  const normalized = String(value).toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const p = bot.entity.position;
  const file = `/tmp/mcbot-${instance.name}-render-${Date.now()}.png`;

  // Default POV: use bot position + eye height offset
  const camX = String(p.x);
  const camY = String(p.y + 1.62);
  const camZ = String(p.z);

  const args = [
    `${import.meta.dirname}/../chunky-render.cjs`,
    instance.host, String(instance.port), instance.version,
    camX, camY, camZ,
    String(bot.entity.yaw), String(bot.entity.pitch),
    file,
  ];

  // Free-cam: append optional named args (overrides default position)
  if (params.camera) args.push("--camera", params.camera);
  if (params.lookAt) args.push("--lookAt", params.lookAt);
  if (params.fov) args.push("--fov", String(params.fov));
  const inspect = params.inspect == null ? true : asBool(params.inspect);
  const worldPath = params.world || instance.worldPath || process.env.MC_WORLD_PATH;
  if (!worldPath) {
    return { error: "chunky render requires world path. set MC_WORLD_PATH or pass --world PATH" };
  }
  args.push("--world", worldPath);

  const spp = Number(params.spp);
  args.push("--spp", Number.isFinite(spp) && spp > 0 ? String(Math.floor(spp)) : inspect ? "48" : "32");
  if (inspect) args.push("--inspect");

  const timeout = 180000;
  const { stdout } = await execFileAsync("node", args, { timeout });

  return { file: stdout.trim() };
}
