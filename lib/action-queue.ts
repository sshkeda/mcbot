/**
 * Per-bot action queue. The orchestrator pushes named code actions, the queue
 * executes them sequentially, and the orchestrator can cancel/view/clear at
 * any time.
 */

import { executeCode, type ExecuteContext, type ExecuteResult } from "./executor";

export interface QueuedAction {
  id: string;
  name: string;
  code: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  result?: any;
  error?: string;
  logs?: string[];
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  timeoutMs: number;
}

// Serializable view (strips internal AbortController)
export type ActionView = Omit<QueuedAction, never>;

const HISTORY_MAX = 20;

type ActionEntry = QueuedAction & { _ac?: AbortController; _waiters?: ((view: ActionView) => void)[] };

export class ActionQueue {
  private queue: ActionEntry[] = [];
  private processing = false;
  private _onFinish: (() => void)[] = [];

  /**
   * buildContext is called at execution time to get a fresh ExecuteContext
   * with the bot's current state and the action's AbortSignal.
   */
  constructor(private buildContext: (signal: AbortSignal) => ExecuteContext) {}

  /** Push a new action onto the queue. Starts processing if idle. */
  push(name: string, code: string, timeoutMs = 60_000): ActionView {
    const action: QueuedAction & { _ac?: AbortController } = {
      id: crypto.randomUUID(),
      name,
      code,
      status: "pending",
      queuedAt: new Date().toISOString(),
      timeoutMs,
    };
    this.queue.push(action);
    this.processLoop(); // fire-and-forget
    return this.viewOf(action);
  }

  /** Cancel a specific action by ID. Aborts if running, removes if pending. */
  cancel(actionId: string): boolean {
    const action = this.queue.find((a) => a.id === actionId);
    if (!action) return false;
    if (action.status === "running") {
      action.status = "cancelled";
      action.finishedAt = new Date().toISOString();
      action._ac?.abort();
      return true;
    }
    if (action.status === "pending") {
      action.status = "cancelled";
      action.finishedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  /** Cancel whatever is currently running. Returns true if something was running. */
  cancelCurrent(): boolean {
    const current = this.queue.find((a) => a.status === "running");
    if (!current) return false;
    current.status = "cancelled";
    current.finishedAt = new Date().toISOString();
    current._ac?.abort();
    return true;
  }

  /** Cancel all pending + abort current. Returns count of affected actions. */
  clear(): number {
    let count = 0;
    for (const action of this.queue) {
      if (action.status === "running") {
        action.status = "cancelled";
        action.finishedAt = new Date().toISOString();
        action._ac?.abort();
        count++;
      } else if (action.status === "pending") {
        action.status = "cancelled";
        action.finishedAt = new Date().toISOString();
        count++;
      }
    }
    return count;
  }

  /** Get serializable view of the queue (recent history + pending + running). */
  getState(): ActionView[] {
    this.trimHistory();
    return this.queue.map((a) => this.viewOf(a));
  }

  /** Get the currently running action, or null. */
  getCurrent(): ActionView | null {
    const current = this.queue.find((a) => a.status === "running");
    return current ? this.viewOf(current) : null;
  }

  /** Get actions that finished since lastPollAt (done/failed/cancelled). */
  getCompletedSince(lastPollAt: string | null): ActionView[] {
    return this.queue
      .filter((a) => {
        if (a.status !== "done" && a.status !== "failed" && a.status !== "cancelled") return false;
        if (!a.finishedAt) return false;
        if (!lastPollAt) return true;
        return a.finishedAt > lastPollAt;
      })
      .map((a) => this.viewOf(a));
  }

  /** Block until action completes. Returns the final action view, or null if not found. */
  waitFor(actionId: string, timeoutMs = 120_000): Promise<ActionView | null> {
    const action = this.queue.find((a) => a.id === actionId);
    if (!action) return Promise.resolve(null);
    if (action.status === "done" || action.status === "failed" || action.status === "cancelled") {
      return Promise.resolve(this.viewOf(action));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(this.viewOf(action));
      }, timeoutMs);
      if (!action._waiters) action._waiters = [];
      action._waiters.push((view) => {
        clearTimeout(timer);
        resolve(view);
      });
    });
  }

  /** Returns a promise that resolves when any action finishes, or after timeoutMs (max 15s). */
  waitAny(timeoutMs = 5_000): Promise<void> {
    timeoutMs = Math.min(timeoutMs, 15_000);
    // If nothing is running or pending, resolve immediately
    const hasActive = this.queue.some((a) => a.status === "running" || a.status === "pending");
    if (!hasActive) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._onFinish.indexOf(cb);
        if (idx >= 0) this._onFinish.splice(idx, 1);
        resolve();
      }, timeoutMs);
      const cb = () => {
        clearTimeout(timer);
        resolve();
      };
      this._onFinish.push(cb);
    });
  }

  private notifyFinish() {
    const cbs = this._onFinish.splice(0);
    for (const cb of cbs) cb();
  }

  private viewOf(a: ActionEntry): ActionView {
    const { _ac, _waiters, ...view } = a;
    return view;
  }

  private trimHistory() {
    // Keep only the last HISTORY_MAX completed/failed/cancelled + all pending/running
    const completed = this.queue.filter(
      (a) => a.status === "done" || a.status === "failed" || a.status === "cancelled",
    );
    if (completed.length > HISTORY_MAX) {
      const toRemove = new Set(completed.slice(0, completed.length - HISTORY_MAX).map((a) => a.id));
      this.queue = this.queue.filter((a) => !toRemove.has(a.id));
    }
  }

  private async processLoop() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const next = this.queue.find((a) => a.status === "pending");
        if (!next) break;

        // Skip if cancelled between finding and starting (defensive)
        if (next.status !== "pending") continue;

        next.status = "running";
        next.startedAt = new Date().toISOString();
        const ac = new AbortController();
        next._ac = ac;

        let result: ExecuteResult;
        try {
          const ctx = this.buildContext(ac.signal);
          // Safety timeout: if executeCode hangs past its timeout (e.g. mineflayer
          // promise never resolves after abort), force-resolve so the queue doesn't
          // deadlock with processing=true forever.
          const safetyMs = next.timeoutMs + 10_000;
          result = await Promise.race([
            executeCode(next.code, ctx, next.timeoutMs),
            new Promise<ExecuteResult>((resolve) =>
              setTimeout(() => {
                if (!ac.signal.aborted) ac.abort();
                resolve({ success: false, error: "queue safety timeout — executeCode hung", logs: [], result: undefined });
              }, safetyMs),
            ),
          ]);
        } catch (e: any) {
          // executeCode should never throw, but guard against it
          result = { success: false, error: `processLoop caught: ${e.message}`, logs: [], result: undefined };
        }

        // Abort lingering async code from timed-out/failed actions
        if (!ac.signal.aborted) ac.abort();

        next.logs = result.logs;
        next.finishedAt = new Date().toISOString();

        // If it was cancelled during execution, keep cancelled status
        if (next.status === "cancelled") {
          // already set by cancel/cancelCurrent/clear
        } else if (result.success) {
          next.status = "done";
          next.result = result.result;
        } else {
          next.status = "failed";
          next.error = result.error;
        }

        next._ac = undefined; // cleanup
        if (next._waiters) {
          const view = this.viewOf(next);
          for (const cb of next._waiters) cb(view);
          next._waiters = undefined;
        }
        this.trimHistory();
        this.notifyFinish();
      }
    } finally {
      this.processing = false;
      // Re-check: if new actions were pushed while we were finishing up,
      // restart the loop (avoids race where push() saw processing=true
      // but the loop was about to exit).
      const hasPending = this.queue.some((a) => a.status === "pending");
      if (hasPending) {
        // Use queueMicrotask to avoid deep recursive stacks
        queueMicrotask(() => this.processLoop().catch(() => {}));
      }
    }
  }
}
