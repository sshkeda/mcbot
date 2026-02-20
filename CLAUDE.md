Use Bun, not Node.js. The CLI is `bun run cli.ts` from the project root.

## Quick Reference

```sh
# Start the server (must be running before any bot commands)
bun run server.ts

# Spawn and manage bots
bun run cli.ts spawn Scout
bun run cli.ts spawn Scout Miner Lumberjack  # batch (concurrent)
bun run cli.ts list
bun run cli.ts kill Scout
bun run cli.ts killall

# Bot commands (always: bun run cli.ts <botName> <command>)
bun run cli.ts Scout state           # waits up to 5s, full snapshot
bun run cli.ts Scout survey          # scan area for resources
bun run cli.ts Scout pov             # first-person PNG render

# Code execution (orchestrator writes JS code)
curl -X POST http://localhost:3847/Scout/execute \
  -H 'Content-Type: application/json' \
  -d '{"code": "log(bot.entity.position); return bot.health", "name": "test"}'
bun run cli.ts Scout queue           # view action queue
bun run cli.ts Scout skills          # list available skills
bun run cli.ts Scout load_skill chop # load skill code

# Cross-terminal locking
bun run cli.ts locks                 # show all bot locks
bun run cli.ts lock Scout --agent orchestrator --goal "mining"
bun run cli.ts unlock Scout

# Bot profiles
bun run cli.ts profile Scout              # view profile
bun run cli.ts profile Scout --init       # create from template
bun run cli.ts profile Scout --memory "found village at 350 68 -120"
```

## Slash Commands

- `/mcbot <name> [goal]` — Spawn a subagent to autonomously control a bot. Example: `/mcbot Scout mine 20 iron ore`
- `/mcbot` or `/mcbot list` — Dashboard showing all active bots and recent activity log.

## Full Command & Subagent Docs

See `.claude/skills/mcbot/SKILL.md` for the complete reference:
- All fleet and bot commands
- Single orchestrator architecture (writes JS code, executes via `execute` endpoint)
- Code execution context (bot, mcData, pathfinder, Vec3, sleep, signal, log)
- Action queue management (push, cancel, view)
- Skill system (load, save, reuse code templates)
- Cross-terminal bot locking
- Visual commands (pov, render)
- Bot profiles and personality system

## Structure

- `server.ts` — HTTP API server, manages multiple bot instances
- `cli.ts` — CLI that talks to the server via HTTP
- `lib/commands.ts` — shared command/tool registry (help, parsing, validation, routing)
- `lib/executor.ts` — code execution engine (AsyncFunction + AbortController + mission helper injection)
- `lib/action-queue.ts` — per-bot sequential action queue
- `lib/mission-helpers.ts` — high-level mission helpers (gatherResource, craftItem, ensureTool, navigateSafe, etc.) injected into every execute context
- `lib/skill-manager.ts` — load/save skills from `skills/` directory (reads `.ts` files with JSDoc metadata headers)
- `lib/locks.ts` — cross-terminal bot locking via `/tmp/mcbot-locks/`
- `skills/` — reusable code templates as `.ts` files with embedded `@skill`/`@description`/`@tags` metadata (chop, mine, craft, smelt, pickup, fight, farm, build, goto)
- `render.cjs` — Node-only headless 3D renderer (uses gl/THREE.js, incompatible with Bun)
- `profiles/` — bot profiles (profile.config.ts for config, SOUL.md for personality, memories/ for daily memory logs)
- `.claude/skills/mcbot/SKILL.md` — `/mcbot` slash command (subagent launcher + dashboard)

## Notes

- The `gl` native module only works under Node.js (uses NAN/V8 bindings). Bun crashes on it. The render command works around this by spawning a Node subprocess.
- Default MC version is 1.21.11. Use `--version` flag on spawn if connecting to a different version.
- The server stores each bot's host/port/version so render can reconnect to the same server.
- All commands must be run from the project root (working directory matters for `bun run cli.ts`).

## Orchestrator Aggression Rules

Bot orchestrators must be RELENTLESSLY AGGRESSIVE. Never hesitate. Never passively observe. Every single turn must make progress.

### Mission-Loop Architecture (THE #1 SPEED RULE)
Each LLM turn costs ~5-15s of bot idle time. The biggest bottleneck is round-trips, NOT Minecraft actions. **Write mission scripts using high-level helpers that run autonomously for minutes.**

Mission helpers available in every execute block: `checkCraftability`, `navigateSafe`, `gatherResource`, `craftItem`, `mineOre`, `collectDrops`, `equipBest`, `ensureTool`, `progress`, `checkpoint`. All return `{ ok, error?, ...data }` and never throw.

- **Write mission scripts, not micro-steps.** Use `gatherResource("log", 20)` instead of writing a manual find→navigate→dig loop. Use `ensureTool("pickaxe", "stone")` instead of manually checking inventory, gathering logs, crafting planks, crafting sticks, crafting the tool.
- **Use `checkCraftability([...])` in execute code** instead of running `bun run cli.ts recipes X` for each item. One execute replaces 10+ CLI calls.
- **Set `mission: true`** on execute payloads for 5-minute timeout (vs 60s default).
- **Use `progress("msg")`** in mission code for intermediate status. Check via `bun run cli.ts <BOT> progress`.

### No-Idle Contract
- **ALWAYS be executing something.** If the queue is empty, submit the next mission IMMEDIATELY.
- **Never end a turn without an action in the queue** unless the goal is COMPLETE.
- **Batch observations in parallel** — run `state` + `inventory` + `survey` in one turn, not sequentially.

### Interrupt on Deviation (ZERO TOLERANCE)
Mission helpers handle stuck recovery internally (`navigateSafe` retries 3x with dig+sprint-jump). For raw code or when missions fail:
- Position unchanged on `state` check: **cancel + submit corrected mission in SAME turn.**
- `isCollidedHorizontally`: **cancel + recover immediately.**
- Recovery = cancel + submit new code. Both in the same turn. Never end a turn with just a cancellation.

### Failure Recovery
- Mission returned `ok: false` → **read error + submit corrected mission in the same turn.**
- Same approach fails twice → **change strategy entirely.** Different location, method, or resource.

### Polling Discipline
- **NEVER use `sleep` in Bash commands.** Use `bun run cli.ts <BOT> state` — it blocks up to 5s automatically.
- **Never wait on an empty queue.** Submit the next mission instead.
- For long-running missions, poll `state` repeatedly. Use `progress` command to check intermediate status.
