import type { BotInstance } from "./_helpers";
import { execFileAsync } from "./_helpers";
import * as blueprintStore from "../lib/blueprint-store";

function asBool(value: any): boolean {
  if (value == null) return false;
  const normalized = String(value).toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

export default async function (instance: BotInstance, params: any) {
  const scriptPath = `${import.meta.dirname}/../chunky-render.cjs`;
  const timeout = 180000;
  const inspect = params.inspect == null ? true : asBool(params.inspect);
  const worldPath = params.world || instance.worldPath || process.env.MC_WORLD_PATH;
  const spp = Number(params.spp);
  const sppTarget = Number.isFinite(spp) && spp > 0 ? String(Math.floor(spp)) : inspect ? "40" : "32";
  if (!worldPath) {
    return { error: "chunky render requires world path. set MC_WORLD_PATH or pass --world PATH" };
  }

  // Determine center point
  let cx: number, cy: number, cz: number;

  if (params.blueprint) {
    const agentDir = `agents/${instance.name}`;
    const bp = blueprintStore.loadBlueprint(agentDir, params.blueprint);
    if (!bp) return { error: `blueprint "${params.blueprint}" not found` };
    if (!bp.blocks || bp.blocks.length === 0) return { error: `blueprint "${params.blueprint}" has no blocks` };

    // Center of blueprint
    if (bp.bounds) {
      cx = bp.origin.x + (bp.bounds.min.x + bp.bounds.max.x) / 2;
      cy = bp.origin.y + (bp.bounds.min.y + bp.bounds.max.y) / 2;
      cz = bp.origin.z + (bp.bounds.min.z + bp.bounds.max.z) / 2;
    } else {
      // Derive from blocks
      let sumDx = 0, sumDy = 0, sumDz = 0;
      for (const b of bp.blocks) { sumDx += b.dx; sumDy += b.dy; sumDz += b.dz; }
      cx = bp.origin.x + sumDx / bp.blocks.length;
      cy = bp.origin.y + sumDy / bp.blocks.length;
      cz = bp.origin.z + sumDz / bp.blocks.length;
    }
  } else {
    const hasCoords = params.cx != null && params.cy != null && params.cz != null;
    if (hasCoords) {
      cx = Number(params.cx);
      cy = Number(params.cy);
      cz = Number(params.cz);
      if (isNaN(cx) || isNaN(cy) || isNaN(cz)) {
        return { error: "cx cy cz must be numbers" };
      }
    } else {
      const p = instance.bot.entity.position;
      cx = p.x;
      cy = p.y;
      cz = p.z;
    }
  }

  const radius = Number(params.radius) || 12;
  const height = Number(params.height) || 4;
  const count = Math.min(Number(params.count) || 4, 8);
  const concurrency = 2;

  // Compute camera positions with obstruction avoidance
  const shots: { camX: number; camY: number; camZ: number; label: string }[] = [];
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const { Vec3 } = await import("vec3");
  const bot = instance.bot;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    let camX = cx + radius * Math.sin(angle);
    let camY = cy + height;
    let camZ = cz - radius * Math.cos(angle);

    // Move camera up until it has a clear line of sight (not inside blocks or tree canopy)
    for (let attempt = 0; attempt < 30; attempt++) {
      const block = bot.blockAt(new Vec3(Math.floor(camX), Math.floor(camY), Math.floor(camZ)));
      if (!block || block.name === "air" || block.name === "cave_air") {
        // Also check the block isn't surrounded by leaves (inside canopy)
        const above = bot.blockAt(new Vec3(Math.floor(camX), Math.floor(camY) + 1, Math.floor(camZ)));
        if (!above || !above.name.includes("leaves")) break;
      }
      camY += 2;
    }

    shots.push({
      camX,
      camY,
      camZ,
      label: labels[Math.round((i / count) * 8) % 8] || `${i}`,
    });
  }

  // Render with concurrency cap
  const files: string[] = [];
  const errors: string[] = [];

  for (let batch = 0; batch < shots.length; batch += concurrency) {
    const chunk = shots.slice(batch, batch + concurrency);
    const promises = chunk.map(async (shot) => {
      const file = `/tmp/mcbot-${instance.name}-orbit-${shot.label}-${Date.now()}.png`;
      const cameraArg = `${shot.camX.toFixed(1)},${shot.camY.toFixed(1)},${shot.camZ.toFixed(1)}`;
      const lookAtArg = `${cx.toFixed(1)},${cy.toFixed(1)},${cz.toFixed(1)}`;

      try {
        const args = [
          scriptPath,
          instance.host, String(instance.port), instance.version,
          "0", "0", "0", "0", "0", // placeholder positional args (overridden by --camera/--lookAt)
          file,
          "--camera", cameraArg,
          "--lookAt", lookAtArg,
        ];
        args.push("--world", worldPath, "--spp", sppTarget);
        if (inspect) args.push("--inspect");
        const { stdout } = await execFileAsync("node", args, { timeout });
        return { file: stdout.trim(), label: shot.label, error: null };
      } catch (e: any) {
        return { file: null, label: shot.label, error: e.message || "render failed" };
      }
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.file) files.push(r.file);
      if (r.error) errors.push(`${r.label}: ${r.error}`);
    }
  }

  return {
    files,
    errors: errors.length > 0 ? errors : undefined,
    center: { x: +cx.toFixed(1), y: +cy.toFixed(1), z: +cz.toFixed(1) },
    radius,
    height,
    count: files.length,
    requested: count,
  };
}
