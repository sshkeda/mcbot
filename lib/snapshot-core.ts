/**
 * Shared snapshot logic used by both CLI command and mission helper.
 * Single source of truth — no drift between the two surfaces.
 */

import * as blueprintStore from "./blueprint-store";
import type { BlueprintData } from "./blueprint-store";

export interface SnapshotBounds {
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
}

export interface SnapshotOptions {
  /** Blueprint name to load + diff against */
  blueprint?: string;
  /** Max Y-layers to include in ASCII output (default: 20, 0 = skip layerMaps) */
  maxLayers?: number;
}

export interface LayerData {
  y: number;
  grid: string[][]; // rows[z][x] of block codes
}

export interface SnapshotResult {
  ok: boolean;
  error?: string;
  from?: { x: number; y: number; z: number };
  to?: { x: number; y: number; z: number };
  volume?: number;
  filled?: number;
  air?: number;
  unknown?: number;
  counts?: Record<string, number>;
  layerMaps?: string;
  legend?: Record<string, string>;
  blueprint?: {
    name: string;
    progress: string;
    missing: number;
    wrong: number;
    next?: any[];
    wrongBlocks?: any[];
  };
}

/**
 * Generate collision-safe 2-char block codes.
 * First block named "spruce_planks" gets "SP", second gets "S2", etc.
 */
function buildBlockCodes(blockNames: string[]): { codeMap: Record<string, string>; legend: Record<string, string> } {
  const codeMap: Record<string, string> = {};
  const legend: Record<string, string> = {};
  const usedCodes = new Set<string>([".", "??"]);

  for (const name of blockNames) {
    if (codeMap[name]) continue;

    // Try 2-char uppercase prefix
    const parts = name.split("_");
    let code: string;

    if (parts.length >= 2) {
      code = (parts[0][0] + parts[1][0]).toUpperCase();
    } else {
      code = name.slice(0, 2).toUpperCase();
    }

    // Collision resolution
    if (usedCodes.has(code)) {
      for (let i = 2; i <= 99; i++) {
        const alt = code[0] + String(i);
        if (!usedCodes.has(alt)) { code = alt; break; }
      }
    }

    usedCodes.add(code);
    codeMap[name] = code;
    legend[code] = name;
  }

  return { codeMap, legend };
}

/**
 * Derive bounding box from a blueprint's blocks when bounds field is missing.
 */
function deriveBoundsFromBlueprint(bp: BlueprintData): SnapshotBounds {
  if (bp.bounds) {
    // bounds are already absolute coordinates, not offsets
    return {
      x1: bp.bounds.min.x - 1,
      y1: bp.bounds.min.y - 1,
      z1: bp.bounds.min.z - 1,
      x2: bp.bounds.max.x + 1,
      y2: bp.bounds.max.y + 1,
      z2: bp.bounds.max.z + 1,
    };
  }

  // Fallback: compute from block offsets
  if (!bp.blocks || bp.blocks.length === 0) {
    return {
      x1: bp.origin.x - 1, y1: bp.origin.y - 1, z1: bp.origin.z - 1,
      x2: bp.origin.x + 1, y2: bp.origin.y + 1, z2: bp.origin.z + 1,
    };
  }

  let minDx = Infinity, maxDx = -Infinity;
  let minDy = Infinity, maxDy = -Infinity;
  let minDz = Infinity, maxDz = -Infinity;
  for (const b of bp.blocks) {
    if (b.dx < minDx) minDx = b.dx;
    if (b.dx > maxDx) maxDx = b.dx;
    if (b.dy < minDy) minDy = b.dy;
    if (b.dy > maxDy) maxDy = b.dy;
    if (b.dz < minDz) minDz = b.dz;
    if (b.dz > maxDz) maxDz = b.dz;
  }

  return {
    x1: bp.origin.x + minDx - 1,
    y1: bp.origin.y + minDy - 1,
    z1: bp.origin.z + minDz - 1,
    x2: bp.origin.x + maxDx + 1,
    y2: bp.origin.y + maxDy + 1,
    z2: bp.origin.z + maxDz + 1,
  };
}

/**
 * Core snapshot function — used by both CLI handler and mission helper.
 *
 * @param bot       mineflayer bot instance
 * @param Vec3      vec3 constructor
 * @param bounds    bounding box coordinates (or null if using blueprint-only mode)
 * @param agentDir  bot's agent directory (needed for blueprint loading)
 * @param opts      blueprint name, maxLayers
 */
export function takeSnapshot(
  bot: any,
  Vec3: any,
  bounds: SnapshotBounds | null,
  agentDir: string | undefined,
  opts: SnapshotOptions = {},
): SnapshotResult {
  const maxLayers = opts.maxLayers ?? 20;

  // Resolve bounds from blueprint if needed
  let bpData: BlueprintData | null = null;
  if (opts.blueprint) {
    if (!agentDir) return { ok: false, error: "no agent directory configured" };
    bpData = blueprintStore.loadBlueprint(agentDir, opts.blueprint);
    if (!bpData) return { ok: false, error: `blueprint "${opts.blueprint}" not found` };
    if (!bpData.blocks || bpData.blocks.length === 0) {
      return { ok: false, error: `blueprint "${opts.blueprint}" has no blocks` };
    }
    if (!bounds) {
      bounds = deriveBoundsFromBlueprint(bpData);
    }
  }

  if (!bounds) {
    return { ok: false, error: "need bounds (x1 y1 z1 x2 y2 z2) or --blueprint NAME" };
  }

  const minX = Math.min(bounds.x1, bounds.x2), maxX = Math.max(bounds.x1, bounds.x2);
  const minY = Math.min(bounds.y1, bounds.y2), maxY = Math.max(bounds.y1, bounds.y2);
  const minZ = Math.min(bounds.z1, bounds.z2), maxZ = Math.max(bounds.z1, bounds.z2);

  const vol = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  if (vol > 10_000) return { ok: false, error: `volume too large: ${vol} blocks (max 10000)` };

  // Scan volume
  const blocksByLayer: Map<number, { x: number; z: number; name: string }[]> = new Map();
  const counts: Record<string, number> = {};
  const allBlockNames: string[] = [];
  let air = 0, unknown = 0, filled = 0;

  for (let y = minY; y <= maxY; y++) {
    const layer: { x: number; z: number; name: string }[] = [];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
          unknown++;
          layer.push({ x, z, name: "??" });
          continue;
        }
        if (block.name === "air" || block.name === "cave_air") {
          air++;
          layer.push({ x, z, name: "air" });
          continue;
        }
        filled++;
        counts[block.name] = (counts[block.name] || 0) + 1;
        if (!allBlockNames.includes(block.name)) allBlockNames.push(block.name);
        layer.push({ x, z, name: block.name });
      }
    }
    blocksByLayer.set(y, layer);
  }

  // Build block codes + legend
  const { codeMap, legend } = buildBlockCodes(allBlockNames);

  // Build ASCII layer maps (minY → maxY, bottom to top)
  let layerMaps = "";
  const totalLayers = maxY - minY + 1;
  const layersToRender = maxLayers === 0 ? 0 : Math.min(totalLayers, maxLayers);

  if (layersToRender > 0) {
    // Build x-axis header
    const xCoords: number[] = [];
    for (let x = minX; x <= maxX; x++) xCoords.push(x);
    const colWidth = 2;
    const xHeader = "  z\\x " + xCoords.map(x => String(x).padStart(colWidth)).join(" ");

    // Render layers from minY to maxY
    const startY = minY;
    const endY = Math.min(maxY, minY + layersToRender - 1);

    for (let y = startY; y <= endY; y++) {
      layerMaps += `=== Layer Y=${y} ===\n`;
      layerMaps += xHeader + "\n";

      const layer = blocksByLayer.get(y) || [];
      // Group by z
      const byZ: Map<number, Map<number, string>> = new Map();
      for (const b of layer) {
        if (!byZ.has(b.z)) byZ.set(b.z, new Map());
        byZ.get(b.z)!.set(b.x, b.name);
      }

      for (let z = minZ; z <= maxZ; z++) {
        const row = byZ.get(z);
        let line = String(z).padStart(4) + ": ";
        for (let x = minX; x <= maxX; x++) {
          const name = row?.get(x) || "air";
          let code: string;
          if (name === "air") code = " .";
          else if (name === "??") code = "??";
          else code = (codeMap[name] || "??").padStart(colWidth);
          line += code + " ";
        }
        layerMaps += line.trimEnd() + "\n";
      }
      layerMaps += "\n";
    }

    if (layersToRender < totalLayers) {
      layerMaps += `... ${totalLayers - layersToRender} more layers omitted (use --maxLayers to show more)\n\n`;
    }

    // Legend
    layerMaps += "Legend: .=air ??=unknown/unloaded";
    for (const [code, name] of Object.entries(legend)) {
      layerMaps += ` ${code}=${name}`;
    }
    layerMaps += "\n";
  }

  // Blueprint diff
  let blueprintResult: SnapshotResult["blueprint"] = undefined;
  if (bpData) {
    const diff = blueprintStore.diffBlueprintBlocks(bot, Vec3, bpData.origin, bpData.blocks, 20);
    blueprintResult = {
      name: opts.blueprint!,
      progress: diff.progress,
      missing: diff.missing,
      wrong: diff.wrong,
      next: diff.next,
      wrongBlocks: diff.wrongBlocks,
    };
  }

  return {
    ok: true,
    from: { x: minX, y: minY, z: minZ },
    to: { x: maxX, y: maxY, z: maxZ },
    volume: vol,
    filled,
    air,
    unknown,
    counts,
    layerMaps: layerMaps || undefined,
    legend: Object.keys(legend).length > 0 ? legend : undefined,
    blueprint: blueprintResult,
  };
}
