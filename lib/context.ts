import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCommands } from "./commands";
import { readRecentMemories, countMemories } from "./memories";

export async function runContext(api: string, profilesDir: string, name: string, goal: string): Promise<void> {
  const [stateRes, invRes, listRes] = await Promise.all([
    fetch(`${api}/${name}/state`).then(r => r.json()).catch(() => null) as Promise<any>,
    fetch(`${api}/${name}/inventory`).then(r => r.json()).catch(() => null) as Promise<any>,
    fetch(`${api}/list`).then(r => r.json()).catch(() => null) as Promise<any>,
  ]);

  const botCommands = getCommands("bot");
  const cmdList = botCommands.map(c => `  bun run cli.ts ${name} ${c.usage.padEnd(50)} ${c.summary}`).join("\n");

  let profileBlock = "";
  const profileDir = join(profilesDir, name);
  const soulPath = join(profileDir, "SOUL.md");

  if (existsSync(soulPath)) {
    const soul = readFileSync(soulPath, "utf-8").trim();
    if (soul) profileBlock += `\n\n## Personality & Identity\n${soul}`;
  }

  const total = countMemories(profileDir);
  const recent = readRecentMemories(profileDir, 7);
  if (recent.length > 0) {
    const memLines: string[] = [];
    for (const day of recent) {
      memLines.push(`### ${day.date}`);
      const shown = day.lines.slice(-15);
      memLines.push(...shown);
    }
    profileBlock += `\n\n## Memories (${total} total, last 7 days)\n${memLines.join("\n")}`;
  }

  let stateBlock = "";
  if (stateRes && !stateRes.error && stateRes.position) {
    const s = stateRes;
    stateBlock = `\n## Current State\n- Position: ${s.position.x} ${s.position.y} ${s.position.z}\n- Health: ${s.health}  Food: ${s.food}\n- Time: ${s.time}  Biome: ${s.biome}`;
    if (s.isCollidedHorizontally) stateBlock += `\n- **COLLIDED HORIZONTALLY**`;
    if (s.movements) {
      stateBlock += `\n- Movements: canDig=${s.movements.canDig} sprint=${s.movements.allowSprinting} parkour=${s.movements.allowParkour} towers=${s.movements.allow1by1towers} maxDrop=${s.movements.maxDropDown}`;
    }
  }

  let invBlock = "";
  if (Array.isArray(invRes) && invRes.length > 0) {
    invBlock = `\n\n## Inventory\n${invRes.map((i: any) => `- ${i.name} x${i.count}`).join("\n")}`;
  }

  let otherBots = "";
  if (Array.isArray(listRes?.bots) && listRes.bots.length > 1) {
    const others = listRes.bots.filter((b: any) => b.name !== name);
    if (others.length > 0) {
      otherBots = `\n\n## Other Active Bots\n${others.map((b: any) => `- ${b.name} at ${b.position.x} ${b.position.y} ${b.position.z}`).join("\n")}`;
    }
  }

  const goalBlock = goal
    ? `\n\n## Your Goal\n${goal}`
    : `\n\n## Your Goal\nExplore and report on your surroundings`;

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You are controlling the Minecraft bot "${name}" via CLI commands.
All commands must be run from \`/srv/blockgame-server\` using \`bun run cli.ts\`.
${profileBlock}${stateBlock}${invBlock}${otherBots}${goalBlock}

## Available Commands
${cmdList}

## Rules
- \`state\` is your primary command — it blocks up to 5s, returns early when an action finishes, and gives you everything: position, health, biome, collision, completed actions, inbox, directives, movements config.
- After running pov or render, use the Read tool to view the returned PNG file path.
- If a command fails, read the error and try a different approach. Never retry the same command blindly.
- When done with the goal, report what you accomplished.
- **Batch commands** — run \`state\` + \`inventory\` + \`look\` in parallel. Never waste a turn on a single observation.

## Hazard Awareness
Before navigating long distances (>50 blocks), run \`survey\` to check for hazards along the route:
- **Lava nearby** — route around it or pillar over. Never path through lava.
- **Hostiles** — deal with them first or avoid the area. Check the nearest hostile positions from survey.
- **Water/cliffs** — if survey shows water or large elevation changes, approach carefully.
- **Low chunk coverage** (<70%) — you're near the edge of loaded terrain. Move closer before scanning again.
- After any death, run \`survey\` immediately to understand the respawn area before acting.

## Disconnect Detection & Recovery
Watch for: "not found", "disconnected", "server not running", or commands hanging.
1. Check server: \`bun run cli.ts ping\`
2. Respawn if needed: \`bun run cli.ts spawn ${name} --port 25565\`
3. Re-check state and continue your goal.

## Progress Tracking
- Use **TaskCreate** to break your goal into sub-tasks at the start.
- Use **TaskUpdate** to mark \`in_progress\` / \`completed\`.

## Identity & Memory
- **\`profiles/${name}/SOUL.md\`** — Your personality and role. Rewrite it to reflect who you've become.
- **\`profiles/${name}/memories/${today}.md\`** — Today's memory log. Append \`- text\` bullets when you discover locations, learn something, or complete goals.

Use the **Edit** tool to update these files naturally as things happen.`;

  console.log(prompt);
}
