/**
 * Cross-terminal bot locking. Prevents multiple Claude Code sessions from
 * accidentally controlling the same bot. Uses lock files in /tmp/mcbot-locks/.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCKS_DIR = "/tmp/mcbot-locks";

export interface BotLock {
  bot: string;
  pid: number;
  terminal?: string;
  agent?: string;
  goal?: string;
  lockedAt: string;
}

function ensureDir() {
  if (!existsSync(LOCKS_DIR)) mkdirSync(LOCKS_DIR, { recursive: true });
}

function lockPath(bot: string): string {
  return join(LOCKS_DIR, `${bot}.lock`);
}

/** Check if a process is still alive. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Acquire a lock on a bot. Returns the lock, or null if already locked by another live process. */
export function acquireLock(bot: string, meta: Omit<BotLock, "bot" | "lockedAt">): BotLock | null {
  ensureDir();
  const path = lockPath(bot);

  // Check existing lock
  if (existsSync(path)) {
    try {
      const existing: BotLock = JSON.parse(readFileSync(path, "utf-8"));
      if (processAlive(existing.pid) && existing.pid !== meta.pid) {
        return null; // locked by another live process
      }
      // Stale lock or same process — overwrite
    } catch {}
  }

  const lock: BotLock = {
    bot,
    ...meta,
    lockedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(lock, null, 2));
  return lock;
}

/** Release a lock on a bot. Only succeeds if we own it (same PID). */
export function releaseLock(bot: string, pid?: number): boolean {
  const path = lockPath(bot);
  if (!existsSync(path)) return false;
  if (pid) {
    try {
      const existing: BotLock = JSON.parse(readFileSync(path, "utf-8"));
      if (existing.pid !== pid) return false;
    } catch {}
  }
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Get all active locks (stale locks from dead processes are cleaned up). */
export function getLocks(): BotLock[] {
  ensureDir();
  const locks: BotLock[] = [];
  for (const file of readdirSync(LOCKS_DIR)) {
    if (!file.endsWith(".lock")) continue;
    const path = join(LOCKS_DIR, file);
    try {
      const lock: BotLock = JSON.parse(readFileSync(path, "utf-8"));
      if (processAlive(lock.pid)) {
        locks.push(lock);
      } else {
        // Clean up stale lock
        try { unlinkSync(path); } catch {}
      }
    } catch {
      try { unlinkSync(path); } catch {}
    }
  }
  return locks;
}

/** Check if a bot is locked by another process. */
export function isLocked(bot: string, myPid?: number): BotLock | null {
  const path = lockPath(bot);
  if (!existsSync(path)) return null;
  try {
    const lock: BotLock = JSON.parse(readFileSync(path, "utf-8"));
    if (!processAlive(lock.pid)) {
      try { unlinkSync(path); } catch {}
      return null;
    }
    if (myPid && lock.pid === myPid) return null; // we own it
    return lock;
  } catch {
    return null;
  }
}

/** Remove all stale locks (dead PIDs). Returns count removed. */
export function cleanStaleLocks(): number {
  ensureDir();
  let removed = 0;
  for (const file of readdirSync(LOCKS_DIR)) {
    if (!file.endsWith(".lock")) continue;
    const path = join(LOCKS_DIR, file);
    try {
      const lock: BotLock = JSON.parse(readFileSync(path, "utf-8"));
      if (!processAlive(lock.pid)) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      try { unlinkSync(path); removed++; } catch {}
    }
  }
  return removed;
}
