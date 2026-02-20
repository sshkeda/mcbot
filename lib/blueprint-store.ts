/**
 * Blueprint persistence layer.
 *
 * Stores/loads named blueprints as JSON files in agents/<bot>/blueprints/.
 * Also provides a shared diffBlueprintBlocks() utility used by the CLI command,
 * the HTTP diff_blueprint handler, and the in-execute mission helper.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────

export interface BlueprintEntry {
  dx: number;
  dy: number;
  dz: number;
  block: string;
}

export interface BlueprintData {
  name: string;
  origin: { x: number; y: number; z: number };
  blocks: BlueprintEntry[];
  createdAt: string;
  source?: "snap" | "manual";
  bounds?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
}

export interface BlueprintSummary {
  name: string;
  blockCount: number;
  origin: { x: number; y: number; z: number };
  createdAt: string;
  source?: string;
}

export interface DiffResult {
  total: number;
  placed: number;
  missing: number;
  wrong: number;
  progress: string;
  next: DiffCandidate[];
  wrongBlocks?: DiffWrong[];
}

export interface DiffCandidate {
  x: number;
  y: number;
  z: number;
  expected: string;
  actual: string;
  hasSupport: boolean;
  dist: number;
}

export interface DiffWrong {
  x: number;
  y: number;
  z: number;
  expected: string;
  actual: string;
}

// ── CRUD ─────────────────────────────────────────────────────────

function blueprintsDir(agentDir: string): string {
  return join(agentDir, "blueprints");
}

function ensureDir(agentDir: string): string {
  const dir = blueprintsDir(agentDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function listBlueprints(agentDir: string): BlueprintSummary[] {
  const dir = blueprintsDir(agentDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const data: BlueprintData = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      return {
        name: data.name,
        blockCount: data.blocks.length,
        origin: data.origin,
        createdAt: data.createdAt,
        source: data.source,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadBlueprint(agentDir: string, name: string): BlueprintData | null {
  const file = join(blueprintsDir(agentDir), `${name}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function saveBlueprint(agentDir: string, data: BlueprintData): void {
  const dir = ensureDir(agentDir);
  writeFileSync(join(dir, `${data.name}.json`), JSON.stringify(data, null, 2) + "\n");
}

export function deleteBlueprint(agentDir: string, name: string): boolean {
  const file = join(blueprintsDir(agentDir), `${name}.json`);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

// ── Shared diff utility ──────────────────────────────────────────

/**
 * Compare a blueprint against the actual world state.
 * Shared by diff_blueprint command, blueprint CLI command, and mission helper.
 *
 * @param bot       mineflayer bot instance
 * @param Vec3      vec3 constructor
 * @param origin    world-space origin of the blueprint
 * @param blocks    blueprint entries (dx/dy/dz offsets from origin)
 * @param maxNext   max candidates in `next` array (default 20)
 */
export function diffBlueprintBlocks(
  bot: any,
  Vec3: any,
  origin: { x: number; y: number; z: number },
  blocks: BlueprintEntry[],
  maxNext = 20,
): DiffResult {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const missing: DiffWrong[] = [];
  const wrong: DiffWrong[] = [];
  let placed = 0;

  for (const entry of blocks) {
    const wx = ox + entry.dx, wy = oy + entry.dy, wz = oz + entry.dz;
    const block = bot.blockAt(new Vec3(wx, wy, wz));
    const actual = block?.name || "air";

    if (actual === entry.block) {
      placed++;
    } else if (actual === "air" || actual === "cave_air") {
      missing.push({ x: wx, y: wy, z: wz, expected: entry.block, actual: "air" });
    } else {
      wrong.push({ x: wx, y: wy, z: wz, expected: entry.block, actual });
    }
  }

  const botPos = bot.entity.position;
  const next: DiffCandidate[] = missing
    .map(m => {
      const below = bot.blockAt(new Vec3(m.x, m.y - 1, m.z));
      const hasSupport = below ? below.boundingBox === "block" : false;
      const dist = +botPos.distanceTo(new Vec3(m.x, m.y, m.z)).toFixed(1);
      return { ...m, hasSupport, dist };
    })
    .sort((a, b) => {
      if (a.hasSupport !== b.hasSupport) return a.hasSupport ? -1 : 1;
      return a.dist - b.dist;
    })
    .slice(0, maxNext);

  return {
    total: blocks.length,
    placed,
    missing: missing.length,
    wrong: wrong.length,
    progress: `${placed}/${blocks.length} (${Math.round((placed / blocks.length) * 100)}%)`,
    next,
    ...(wrong.length > 0 ? { wrongBlocks: wrong } : {}),
  };
}
