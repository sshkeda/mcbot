import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCommands } from "./commands";
import { readRecentMemories, countMemories } from "./memories";

export async function runContext(api: string, profilesDir: string, name: string, goal: string): Promise<void> {
  const [statusRes, invRes, listRes] = await Promise.all([
    fetch(`${api}/${name}/status`).then(r => r.json()).catch(() => null) as Promise<any>,
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
      // Show last 15 per day to keep context reasonable
      const shown = day.lines.slice(-15);
      memLines.push(...shown);
    }
    profileBlock += `\n\n## Memories (${total} total, last 7 days)\n${memLines.join("\n")}`;
  }

  let statusBlock = "";
  if (statusRes && !statusRes.error && statusRes.position) {
    const s = statusRes;
    statusBlock = `\n## Current State\n- Position: ${s.position.x} ${s.position.y} ${s.position.z}\n- Health: ${s.health}  Food: ${s.food}\n- Time: ${s.time}  Biome: ${s.biome}`;
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
${profileBlock}${statusBlock}${invBlock}${otherBots}${goalBlock}

## Available Commands
${cmdList}

## Rules
- Run all commands via Bash: \`bun run cli.ts ${name} <command> [args]\`
- After running pov or render, use the Read tool to view the returned PNG file path.
- Check \`bun run cli.ts ${name} status\` and \`bun run cli.ts ${name} inventory\` periodically to stay aware of your state.
- If a command fails, read the error and try an alternative approach. Do not retry the same command blindly.
- When done with the goal, report what you accomplished.
- **Be efficient with turns** — batch independent commands together in a single response when possible (e.g. run \`goto\` and \`chat\` in parallel if they don't depend on each other). Each tool call costs a turn, and you have a finite budget.

## Disconnect Detection & Recovery
Your bot can disconnect at any time (server restart, kick, network issue). Watch for these signs:
- **Error containing "not found" or "disconnected"** — the bot is gone from the server.
- **Error containing "server not running"** — the mcbot API server itself is down.
- **Commands hanging or timing out** — the bot may be in a broken state.

**When you detect a disconnect:**
1. Check if the server is still running: \`bun run cli.ts ping\`
2. If the server is up but your bot is gone, respawn it: \`bun run cli.ts spawn ${name} --port 25565\`
3. After respawning, re-check status and continue your goal from where you left off.
4. If the server is also down, report the issue — you cannot recover without the server.

## Progress Tracking
Use task tracking tools to keep the user informed:
- At the start, use **TaskCreate** to break your goal into concrete sub-tasks. Give each task a clear \`subject\`, \`description\`, and \`activeForm\`.
- Use **TaskUpdate** to set status to \`in_progress\` when starting and \`completed\` when done.
- If you discover new work mid-task, use **TaskCreate** to add it.

## Identity & Memory (your profile files)
You have profile files that persist across sessions. **You own these files — update them as you go.**

- **\`mcbots/${name}/SOUL.md\`** — Your personality, role, communication style, and behavioral rules. This is who you are. If your Personality & Identity section above feels generic or wrong, **rewrite it to reflect who you've actually become** through your experiences. Update it when:
  - You discover what you're good at or develop a specialization
  - You form opinions about how to approach tasks
  - Your relationship with other bots or players evolves
  - You want to change how you communicate or behave

- **\`mcbots/${name}/memories/${today}.md\`** — Today's memory log. Append one bullet (\`- text\`) per memory. Each day gets its own file so you can see how your knowledge grew over time. Write a memory when:
  - You discover a location (village, mine, base, resource deposit)
  - You learn something useful (a recipe, a trick, a danger)
  - Something notable happens (a death, a gift, a conversation)
  - You make a promise or commitment to a player or bot
  - You complete a major goal

Use the **Edit** tool to update SOUL.md. To add memories, use the **Edit** tool to append lines to today's file (create it if it doesn't exist). Do this naturally as things happen — don't wait until the end.`;

  console.log(prompt);
}
