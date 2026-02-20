/**
 * Server lifecycle management. PID file, health checks, background spawn, stop.
 * Uses /tmp/mcbot-server.pid for cross-process coordination (same pattern as locks.ts).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";

const PID_FILE = "/tmp/mcbot-server.pid";
const LOG_FILE = "/tmp/mcbot-server.log";

export interface ServerInfo {
  pid: number;
  port: number;
  startedAt: string;
  logFile: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerInfo(): ServerInfo | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const info: ServerInfo = JSON.parse(readFileSync(PID_FILE, "utf-8"));
    if (processAlive(info.pid)) return info;
    // Stale PID file — clean up
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  } catch {
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

export function writeServerInfo(info: ServerInfo): void {
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

export function removeServerInfo(): void {
  try { unlinkSync(PID_FILE); } catch {}
}

/** Check if a port is in use by a non-mcbot process. */
export function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);
  });
}

/** Poll GET /ping until server responds. */
export async function waitForServer(port: number, maxAttempts = 25, intervalMs = 200): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`server did not become ready within ${(maxAttempts * intervalMs / 1000).toFixed(0)}s — check ${LOG_FILE}`);
}

/** Spawn server.ts as a detached background process. Returns PID. */
export function startBackground(port: number): number {
  const serverPath = join(import.meta.dirname, "..", "server.ts");
  const logFd = openSync(LOG_FILE, "a");

  const child = spawn("bun", ["run", serverPath], {
    env: { ...process.env, MCBOT_API_PORT: String(port) },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });

  child.unref();

  if (!child.pid) {
    throw new Error("failed to start server process");
  }

  return child.pid;
}

/** Send SIGTERM and wait for process to exit. */
export async function stopServer(info: ServerInfo): Promise<void> {
  if (!processAlive(info.pid)) {
    removeServerInfo();
    return;
  }

  process.kill(info.pid, "SIGTERM");

  // Poll for death up to 5s
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (!processAlive(info.pid)) {
      removeServerInfo();
      return;
    }
  }

  // Force kill if still alive
  try { process.kill(info.pid, "SIGKILL"); } catch {}
  removeServerInfo();
}
