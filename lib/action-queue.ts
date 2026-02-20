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

export class ActionQueue {
  private queue: (QueuedAction & { _ac?: AbortController })[] = [];
  private processing = false;

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

  private viewOf(a: QueuedAction & { _ac?: AbortController }): ActionView {
    const { _ac, ...view } = a;
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

        next.status = "running";
        next.startedAt = new Date().toISOString();
        const ac = new AbortController();
        next._ac = ac;

        const ctx = this.buildContext(ac.signal);
        const result: ExecuteResult = await executeCode(next.code, ctx, next.timeoutMs);

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
      }
    } finally {
      this.processing = false;
    }
  }
}
