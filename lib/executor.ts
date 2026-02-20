/**
 * Code execution engine for running arbitrary JS against a mineflayer bot.
 *
 * Uses AsyncFunction constructor to run code strings with the bot's context
 * variables in scope. Supports cancellation via AbortController, abort-aware
 * sleep, output capture, and configurable timeout.
 */

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

  // When signal fires, stop pathfinder + digging as side effects
  const onAbort = () => {
    try {
      ctx.bot.pathfinder?.stop();
    } catch {}
    try {
      ctx.bot.stopDigging?.();
    } catch {}
    try {
      // Release all movement controls
      for (const key of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
        ctx.bot.setControlState?.(key, false);
      }
    } catch {}
  };
  ctx.signal.addEventListener("abort", onAbort, { once: true });

  const paramNames = Object.keys(execCtx);
  const paramValues = Object.values(execCtx);

  let fn: (...args: any[]) => Promise<any>;
  try {
    fn = new AsyncFunction(...paramNames, code);
  } catch (err: any) {
    ctx.signal.removeEventListener("abort", onAbort);
    return {
      success: false,
      result: null,
      logs,
      error: `syntax error: ${err.message}`,
      durationMs: 0,
    };
  }

  const t0 = Date.now();

  // Timeout: abort the signal and reject
  const timeoutId = setTimeout(() => {
    // If the caller provided their own AbortController, we can't abort it
    // from here. Instead we just let the race reject with a timeout error.
  }, timeoutMs);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    const result = await Promise.race([fn(...paramValues), timeoutPromise]);

    // Serialize result — drop non-JSON-safe values
    let safeResult: any;
    try {
      safeResult = JSON.parse(JSON.stringify(result ?? null));
    } catch {
      safeResult = String(result);
    }

    return { success: true, result: safeResult, logs, durationMs: Date.now() - t0 };
  } catch (err: any) {
    return {
      success: false,
      result: null,
      logs,
      error: err.message || String(err),
      durationMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timeoutId);
    ctx.signal.removeEventListener("abort", onAbort);
    // Cleanup: stop pathfinder and release controls between actions
    try {
      ctx.bot.pathfinder?.stop();
    } catch {}
    try {
      for (const key of ["forward", "back", "left", "right", "jump", "sprint", "sneak"]) {
        ctx.bot.setControlState?.(key, false);
      }
    } catch {}
  }
}
