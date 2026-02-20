import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";
import { takeSnapshot } from "../lib/snapshot-core";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;

  // Parse bounds if provided
  let bounds: { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number } | null = null;
  const x1 = Number(params.x1), y1 = Number(params.y1), z1 = Number(params.z1);
  const x2 = Number(params.x2), y2 = Number(params.y2), z2 = Number(params.z2);

  if (!isNaN(x1) && !isNaN(y1) && !isNaN(z1) && !isNaN(x2) && !isNaN(y2) && !isNaN(z2)) {
    bounds = { x1, y1, z1, x2, y2, z2 };
  }

  const agentDir = `agents/${instance.name}`;

  return takeSnapshot(bot, Vec3, bounds, agentDir, {
    blueprint: params.blueprint,
    maxLayers: params.maxLayers !== undefined ? Number(params.maxLayers) : undefined,
  });
}
