/**
 * Shared navigation engine: chunked pathfinding with manual fallback.
 *
 * Used by both the server.ts `goto` command and the `goto`
 * skills via the ExecuteContext. One config schema so behavior cannot drift.
 */


// ── Config ──────────────────────────────────────────────────────────

export interface GotoOptions {
  range?: number;        // horizontal acceptance radius (default 2)
  yRange?: number;       // vertical acceptance radius  (default 2)
  legSize?: number;      // max blocks per pathfinding leg (default 20)
  legTimeoutMs?: number; // timeout per leg (default 15000)
  maxLegs?: number;      // max leg iterations (default 80)
  manualMs?: number;     // manual sprint-jump duration (default 2000)
}

export const GOTO_DEFAULTS: Readonly<Required<GotoOptions>> = {
  range: 2,
  yRange: 2,
  legSize: 20,
  legTimeoutMs: 15000,
  maxLegs: 80,
  manualMs: 2000,
};

// ── Telemetry ───────────────────────────────────────────────────────

export interface LegTelemetry {
  index: number;
  ok: boolean;
  ms: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  goal: { x: number; y: number; z: number };
  fallback?: boolean;
  error?: string;
}

export interface GotoResult {
  status: "arrived" | "stuck" | "max_legs" | "aborted";
  arrived: boolean;
  legs: LegTelemetry[];
  position: { x: number; y: number; z: number };
  error?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

const posOf = (p: any) => ({
  x: +p.x.toFixed(1),
  y: +p.y.toFixed(1),
  z: +p.z.toFixed(1),
});

const isAirLike = (name: string) =>
  name === "air" || name === "cave_air" || name === "void_air";

const canClear = (block: any) =>
  block && block.boundingBox === "block" && block.diggable && !isAirLike(block.name);

// ── Engine ──────────────────────────────────────────────────────────

/**
 * Chunked pathfinding with manual fallback.
 *
 * Breaks long paths into short legs so each A* search is fast and
 * recoverable. When pathfinding fails, clears a 2×3 corridor and
 * sprint-jumps forward before retrying.
 *
 * @param deps   - bot instance, Vec3 class, GoalNear class
 * @param target - destination coordinates
 * @param opts   - navigation tuning (all optional, see GOTO_DEFAULTS)
 * @param cbs    - abort signal + log function (both optional)
 */
export async function runGoto(
  deps: { bot: any; Vec3: any; GoalNear: any },
  target: { x: number; y: number; z: number },
  opts?: GotoOptions,
  cbs?: { signal?: AbortSignal; log?: (...args: any[]) => void },
): Promise<GotoResult> {
  const { bot, Vec3, GoalNear } = deps;
  const range = opts?.range ?? GOTO_DEFAULTS.range;
  const yRange = opts?.yRange ?? GOTO_DEFAULTS.yRange;
  const LEG = Math.max(4, opts?.legSize ?? GOTO_DEFAULTS.legSize);
  const legTimeoutMs = Math.max(2000, opts?.legTimeoutMs ?? GOTO_DEFAULTS.legTimeoutMs);
  const maxLegs = Math.max(10, opts?.maxLegs ?? GOTO_DEFAULTS.maxLegs);
  const manualMs = Math.max(500, opts?.manualMs ?? GOTO_DEFAULTS.manualMs);
  const signal = cbs?.signal;
  const log = cbs?.log || (() => {});

  const tx = Number(target.x);
  const ty = Number(target.y);
  const tz = Number(target.z);
  const legs: LegTelemetry[] = [];
  let manualAttempts = 0;

  while (!signal?.aborted) {
    const pos = bot.entity.position.clone();
    const dx = tx - pos.x;
    const dy = ty - pos.y;
    const dz = tz - pos.z;
    const hDist = Math.sqrt(dx ** 2 + dz ** 2);

    // ── Arrival check ──
    if (hDist <= range && Math.abs(dy) <= yRange) {
      log(`arrived at target (${legs.length} legs)`);
      return { status: "arrived", arrived: true, legs, position: posOf(bot.entity.position) };
    }

    // ── Leg limit ──
    if (legs.length >= maxLegs) {
      log(`exceeded ${maxLegs} legs`);
      return {
        status: "max_legs",
        arrived: false,
        legs,
        position: posOf(bot.entity.position),
        error: `exceeded ${maxLegs} legs`,
      };
    }

    // ── Compute waypoint ──
    let goalX = tx, goalY = ty, goalZ = tz;
    if (hDist > range) {
      const legDist = Math.min(LEG, hDist);
      const ratio = legDist / hDist;
      goalX = Math.floor(pos.x + dx * ratio);
      goalY = Math.floor(pos.y + dy * ratio);
      goalZ = Math.floor(pos.z + dz * ratio);
    }

    log(`leg ${legs.length + 1}: h=${hDist.toFixed(1)} y=${dy.toFixed(1)} -> ${goalX},${goalY},${goalZ}`);

    const from = posOf(pos);
    const t0 = Date.now();
    try {
      // Custom timeout that properly stops the pathfinder and swallows the
      // dangling gotoUtil promise so it doesn't produce unhandled rejections.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          bot.pathfinder.stop();
          reject(new Error("timeout"));
        }, legTimeoutMs);

        bot.pathfinder.goto(new GoalNear(goalX, goalY, goalZ, 3)).then(
          () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } },
          (e: any) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
        );
      });
      const ms = Date.now() - t0;
      legs.push({
        index: legs.length, ok: true, ms, from,
        to: posOf(bot.entity.position),
        goal: { x: goalX, y: goalY, z: goalZ },
      });
      manualAttempts = 0;
      log(`leg OK ${ms}ms`);
    } catch (err: any) {
      const ms = Date.now() - t0;
      const message = err?.message || String(err);
      log(`pathfinder failed (${ms}ms): ${message}`);
      legs.push({
        index: legs.length, ok: false, ms, from,
        to: posOf(bot.entity.position),
        goal: { x: goalX, y: goalY, z: goalZ },
        fallback: true, error: message,
      });
      bot.pathfinder.stop();

      // ── Manual fallback: clear 2×3 corridor, sprint-jump ──
      const yaw = Math.atan2(-(tx - pos.x), -(tz - pos.z));
      await bot.look(yaw, 0);

      for (let step = 1; step <= 2; step++) {
        for (let side = -1; side <= 1; side++) {
          const bx = Math.floor(pos.x - Math.sin(yaw) * step + Math.cos(yaw) * side);
          const bz = Math.floor(pos.z - Math.cos(yaw) * step - Math.sin(yaw) * side);
          for (let by = 0; by <= 2; by++) {
            if (signal?.aborted) break;
            const block = bot.blockAt(new Vec3(bx, Math.floor(pos.y) + by, bz));
            if (!canClear(block)) continue;
            try { await bot.dig(block); } catch {}
          }
        }
      }

      bot.setControlState("forward", true);
      bot.setControlState("jump", true);
      bot.setControlState("sprint", true);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, manualMs);
        if (signal) {
          const onAbort = () => { clearTimeout(timer); resolve(); };
          if (signal.aborted) { clearTimeout(timer); resolve(); return; }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      bot.setControlState("forward", false);
      bot.setControlState("jump", false);
      bot.setControlState("sprint", false);

      manualAttempts++;
      if (manualAttempts >= 5) {
        log("stuck after 5 manual attempts");
        return {
          status: "stuck",
          arrived: false,
          legs,
          position: posOf(bot.entity.position),
          error: "stuck after 5 fallback attempts",
        };
      }
    }
  }

  return { status: "aborted", arrived: false, legs, position: posOf(bot.entity.position) };
}
