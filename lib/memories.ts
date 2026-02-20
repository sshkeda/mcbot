import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Today's date as YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return the memories/ directory for a bot agent. */
export function memoriesDir(agentDir: string): string {
  return join(agentDir, "memories");
}

/** Append a memory line to today's daily file. */
export function addMemory(agentDir: string, text: string): number {
  const dir = memoriesDir(agentDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${today()}.md`);
  appendFileSync(file, `- ${text}\n`);
  // Count total memories across all days
  return countMemories(agentDir);
}

/** Count total memory lines across all daily files. */
export function countMemories(agentDir: string): number {
  const dir = memoriesDir(agentDir);
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const f of readdirSync(dir).filter(f => f.endsWith(".md"))) {
    const content = readFileSync(join(dir, f), "utf-8");
    total += (content.match(/^- /gm) || []).length;
  }
  return total;
}

/** Read recent memories (last N days worth of daily files). Returns { date, lines }[]. */
export function readRecentMemories(agentDir: string, maxDays = 7): { date: string; lines: string[] }[] {
  const dir = memoriesDir(agentDir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .slice(-maxDays);
  return files.map(f => {
    const content = readFileSync(join(dir, f), "utf-8");
    const lines = content.split("\n").filter(l => l.startsWith("- "));
    return { date: f.replace(".md", ""), lines };
  }).filter(d => d.lines.length > 0);
}

/** Read ALL memories across all days, flat list. */
export function readAllMemories(agentDir: string): string {
  const dir = memoriesDir(agentDir);
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort();
  const sections: string[] = [];
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf-8");
    const lines = content.split("\n").filter(l => l.startsWith("- "));
    if (lines.length > 0) {
      sections.push(`### ${f.replace(".md", "")}\n${lines.join("\n")}`);
    }
  }
  return sections.join("\n\n");
}
