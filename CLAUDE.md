Use Bun, not Node.js. The CLI is `bun run cli.ts` from the project root.

## Quick Reference

```sh
# Server (auto-starts on first command, or manage explicitly)
bun run cli.ts serve               # start in foreground
bun run cli.ts status              # show PID, uptime, port, bots
bun run cli.ts stop                # graceful shutdown
bun run cli.ts restart             # stop + start in background

# Spawn and manage bots
bun run cli.ts spawn Scout
bun run cli.ts spawn Scout Miner Lumberjack  # batch (concurrent)
bun run cli.ts list
bun run cli.ts kill Scout
bun run cli.ts killall

# Bot commands (always: bun run cli.ts <botName> <command>)
bun run cli.ts Scout state           # waits up to 5s, full snapshot
bun run cli.ts Scout survey          # scan area for resources

# Code execution (orchestrator writes JS code)
curl -X POST http://localhost:3847/Scout/execute \
  -H 'Content-Type: application/json' \
  -d '{"code": "log(bot.entity.position); return bot.health", "name": "test"}'
bun run cli.ts Scout queue           # view action queue
bun run cli.ts Scout skills          # list available skills
bun run cli.ts Scout load_skill chop # load skill code

# Blueprints (persistent build context)
bun run cli.ts Scout blueprint                              # list saved blueprints
bun run cli.ts Scout blueprint snap house 10 64 -20 20 72 -10  # scan area → save as blueprint
bun run cli.ts Scout blueprint diff house                   # diff saved blueprint vs world
bun run cli.ts Scout blueprint show house                   # show details + materials
bun run cli.ts Scout blueprint delete house                 # delete a blueprint

# Cross-terminal locking
bun run cli.ts locks                 # show all bot locks
bun run cli.ts lock Scout --agent orchestrator --goal "mining"
bun run cli.ts unlock Scout

# Bot agents
bun run cli.ts profile Scout              # view agent
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
- Visual commands (render, orbit)
- Bot agents and personality system

## Structure

- `server.ts` — HTTP API server, manages multiple bot instances
- `cli.ts` — CLI that talks to the server via HTTP
- `lib/commands.ts` — shared command/tool registry (help, parsing, validation, routing)
- `lib/executor.ts` — code execution engine (AsyncFunction + AbortController + mission helper injection)
- `lib/action-queue.ts` — per-bot sequential action queue
- `lib/mission-helpers.ts` — high-level mission helpers (gatherResource, craftItem, ensureTool, navigateSafe, scanArea, diffBlueprint, buildFromBlueprint, etc.) injected into every execute context
- `lib/blueprint-store.ts` — blueprint CRUD + shared diff logic (stores JSON in `agents/<bot>/blueprints/`)
- `lib/skill-manager.ts` — load/save skills from `skills/` directory (reads `.ts` files with JSDoc metadata headers)
- `lib/locks.ts` — cross-terminal bot locking via `/tmp/mcbot-locks/`
- `skills/` — reusable code templates as `.ts` files with embedded `@skill`/`@description`/`@tags` metadata (chop, mine, craft, smelt, pickup, fight, farm, build, goto)
- `chunky-render.cjs` — Chunky-based headless renderer wrapper (Node subprocess driving Java Chunky)
- `agents/` — bot agents (agent.config.ts for config, SOUL.md for personality, memories/ for daily memory logs)
- `.claude/skills/mcbot/SKILL.md` — `/mcbot` slash command (subagent launcher + dashboard)

## Notes

- Renders are handled by `chunky-render.cjs` via a Node subprocess that invokes Java Chunky.
- Default MC version is 1.21.11. Use `--version` flag on spawn if connecting to a different version.
- The server stores each bot's host/port/version so render can reconnect to the same server.
- All commands must be run from the project root (working directory matters for `bun run cli.ts`).

## Orchestrator Rules

See `.claude/skills/mcbot/SKILL.md` for all orchestrator aggression rules, mission-loop architecture, and hard rules. The key rules: never use `sleep` in Bash, never read files on turn 1, write mission scripts using helpers, never use pathfinder for vertical underground movement.
