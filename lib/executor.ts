/**
 * Code execution engine for running arbitrary JS against a mineflayer bot.
 *
 * Uses AsyncFunction constructor to run code strings with the bot's context
 * variables in scope. Supports cancellation via AbortController, abort-aware
 * sleep, output capture, and configurable timeout.
 */

import { buildMissionHelpers, type MissionResult } from "./mission-helpers";

export interface ExecuteContext {
  bot: any;
  mcData: any;
  pathfinder: any;
  Vec3: any;
  GoalNear: any;
  GoalFollow: any;
  GoalBlock: any;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  log: (...args: any[]) => void;
  /** Shared navigation engine — injected by buildContext, wrapped by executor to capture logs. */
  goto?: (...args: any[]) => Promise<any>;
  /** Agent directory for this bot — needed by blueprint helpers. */
  agentDir?: string;
  // Mission helpers (optional — injected after context wrapping)
  checkCraftability?: (items: string[]) => any;
  navigateSafe?: (x: number, y: number, z: number, opts?: any) => Promise<MissionResult>;
  gatherResource?: (name: string, count: number, opts?: any) => Promise<MissionResult>;
  craftItem?: (name: string, count: number, opts?: any) => Promise<MissionResult>;
  mineOre?: (name: string, count: number, opts?: any) => Promise<MissionResult>;
  collectDrops?: (radius?: number) => Promise<MissionResult>;
  equipBest?: (category: string) => Promise<MissionResult>;
  ensureTool?: (toolType: string, minTier?: string) => Promise<MissionResult>;
  progress?: (msg: string) => void;
  checkpoint?: (label: string, data?: any) => void;
  // Blueprint helpers
  scanArea?: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => any;
  loadBlueprint?: (name: string) => any;
  saveBlueprint?: (name: string, origin: any, blocks: any[]) => any;
  diffBlueprint?: (nameOrData: string | any) => any;
  buildFromBlueprint?: (name: string, opts?: any) => Promise<any>;
}

export interface ExecuteResult {
  success: boolean;
  result: any;
  logs: string[];
  error?: string;
  durationMs: number;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Create an abort-aware sleep function. Rejects immediately if signal is
 * already aborted or becomes aborted during the sleep.
 */
function makeAbortableSleep(signal: AbortSignal) {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"));
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Run `code` as an async function body with the given execution context.
 *
 * The code string has access to all properties of `ctx` as local variables:
 *   bot, mcData, pathfinder, Vec3, GoalNear, GoalFollow, GoalBlock,
 *   sleep(ms), signal, log(...args)
 *
 * Cancellation: pass an AbortSignal via ctx.signal. When aborted:
 *   - sleep() rejects immediately
 *   - bot.pathfinder.stop() and bot.stopDigging() are called as side effects
 *   - The executing code should check signal.aborted in loops
 *
 * Returns an ExecuteResult with success flag, return value, captured logs,
 * error message (if failed), and execution duration.
 */
export async function executeCode(
  code: string,
  ctx: ExecuteContext,
  timeoutMs: number = 60_000,
): Promise<ExecuteResult> {
  const logs: string[] = [];
  const logFn = (...args: any[]) => {
    logs.push(
      args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" "),
    );
  };

  // Wire up abort-aware sleep and log capture
  const execCtx: ExecuteContext = {
    ...ctx,
    sleep: makeAbortableSleep(ctx.signal),
    log: logFn,
  };

  // Wrap goto so skill code can call goto(x, y, z, opts) — log is auto-injected
  if (ctx.goto) {
    const _baseGoto = ctx.goto;
    execCtx.goto = (x: number, y: number, z: number, opts?: any) =>
      _baseGoto(x, y, z, opts, logFn);
  }

  // Create a local AbortController that chains the parent signal.
  // This lets us abort on timeout (the parent AC may not be ours to abort).
  const localAc = new AbortController();
  const chainParent = () => { if (!localAc.signal.aborted) localAc.abort(); };
  if (ctx.signal.aborted) localAc.abort();
  else ctx.signal.addEventListener("abort", chainParent, { once: true });

  // When local signal fires (timeout or parent cancel), stop bot actions
  const onAbort = () => {
    try { ctx.bot.pathfinder?.stop(); } catch {}
    try { ctx.bot.stopDigging?.(); } catch {}
    try {
      for (const key of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
        ctx.bot.setControlState?.(key, false);
      }
    } catch {}
  };
  localAc.signal.addEventListener("abort", onAbort, { once: true });

  // Re-wire context to use local signal
  const localCtx: ExecuteContext = { ...execCtx, signal: localAc.signal, sleep: makeAbortableSleep(localAc.signal) };

  // Rewrap goto to use the local signal so timeouts propagate to navigation
  if (ctx.goto) {
    const _baseGoto = ctx.goto;
    localCtx.goto = (x: number, y: number, z: number, opts?: any) =>
      _baseGoto(x, y, z, opts, logFn, localAc.signal);
  }

  // Inject mission helpers — built here so they close over the abort-aware
  // sleep, log-capturing logFn, and the local signal.
  const helpers = buildMissionHelpers({
    bot: localCtx.bot,
    mcData: localCtx.mcData,
    Vec3: localCtx.Vec3,
    GoalNear: localCtx.GoalNear,
    sleep: localCtx.sleep,
    signal: localCtx.signal,
    log: localCtx.log,
    goto: localCtx.goto,
    agentDir: localCtx.agentDir,
  });
  Object.assign(localCtx, helpers);

  // Create AsyncFunction AFTER helpers are injected so all keys become
  // named parameters in the generated function.
  let fn: (...args: any[]) => Promise<any>;
  try {
    fn = new AsyncFunction(...Object.keys(localCtx), code);
  } catch (err: any) {
    return {
      success: false,
      result: null,
      logs,
      error: `syntax error: ${err.message}`,
      durationMs: 0,
    };
  }

  const localParamValues = Object.values(localCtx);

  const t0 = Date.now();

  // Timeout: abort the local controller so the code actually stops
  const timeoutId = setTimeout(() => {
    if (!localAc.signal.aborted) localAc.abort();
  }, timeoutMs);

  try {
    const result = await fn(...localParamValues);

    // Serialize result — drop non-JSON-safe values
    let safeResult: any;
    try {
      safeResult = JSON.parse(JSON.stringify(result ?? null));
    } catch {
      safeResult = String(result);
    }

    return { success: true, result: safeResult, logs, durationMs: Date.now() - t0 };
  } catch (err: any) {
    const msg = err.message || String(err);
    // Distinguish timeout from other errors
    const isTimeout = localAc.signal.aborted && !ctx.signal.aborted;
    return {
      success: false,
      result: null,
      logs,
      error: isTimeout ? `timeout after ${timeoutMs}ms` : msg,
      durationMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timeoutId);
    ctx.signal.removeEventListener("abort", chainParent);
    // Abort local signal to stop any lingering async code
    if (!localAc.signal.aborted) localAc.abort();
    // Cleanup: stop pathfinder and release controls between actions
    try { ctx.bot.pathfinder?.stop(); } catch {}
    try {
      for (const key of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
        ctx.bot.setControlState?.(key, false);
      }
    } catch {}
  }
}
