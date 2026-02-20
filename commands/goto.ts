import type { BotInstance } from "./_helpers";
import { Vec3, GoalNear, runGoto } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const { x, y, z } = params;
  if (!x || !y || !z) return { error: "need x, y, z params" };
  const gotoResult = await runGoto(
    { bot, Vec3, GoalNear },
    { x: Number(x), y: Number(y), z: Number(z) },
    {
      range: Number(params.range) || undefined,
      yRange: Number(params.y_range) || undefined,
      legSize: Number(params.leg_size ?? params.leg) || undefined,
      legTimeoutMs: Number(params.leg_timeout_ms) || undefined,
      maxLegs: Number(params.max_legs) || undefined,
      manualMs: Number(params.manual_ms) || undefined,
    },
  );
  return {
    status: gotoResult.arrived ? "arrived" : (gotoResult.error || gotoResult.status),
    legs: gotoResult.legs.length,
    position: gotoResult.position,
    telemetry: gotoResult.legs,
    ...(gotoResult.error ? { error: gotoResult.error } : {}),
  };
}
