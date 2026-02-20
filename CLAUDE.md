Use Bun, not Node.js. The CLI is `bun run cli.ts` from `/srv/blockgame-server`.

## Quick Reference

```sh
# Start the server (must be running before any bot commands)
bun run server.ts

# Spawn and manage bots
bun run cli.ts spawn Scout --port 25565
bun run cli.ts spawn Scout Miner Lumberjack --port 25565  # batch (concurrent)
bun run cli.ts list
bun run cli.ts kill Scout
bun run cli.ts killall

# Bot commands (always: bun run cli.ts <botName> <command>)
bun run cli.ts Scout status
bun run cli.ts Scout state           # fast poll (position, velocity, collision)
bun run cli.ts Scout survey          # scan area for resources
bun run cli.ts Scout screenshot --radius 64

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
- Visual commands (screenshot, pov, render, map)
- Bot profiles and personality system

## Structure

- `server.ts` — HTTP API server, manages multiple bot instances
- `cli.ts` — CLI that talks to the server via HTTP
- `lib/commands.ts` — shared command/tool registry (help, parsing, validation, routing)
- `lib/executor.ts` — code execution engine (AsyncFunction + AbortController)
- `lib/action-queue.ts` — per-bot sequential action queue
- `lib/skill-manager.ts` — load/save skills from `skills/` directory
- `lib/locks.ts` — cross-terminal bot locking via `/tmp/mcbot-locks/`
- `skills/` — reusable JS code templates (chop, mine, craft, smelt, pickup, fight, farm, build, goto)
- `render.cjs` — Node-only headless 3D renderer (uses gl/THREE.js, incompatible with Bun)
- `mcbots/` — bot profiles (personality, memories, metadata per bot)
- `.claude/skills/mcbot/SKILL.md` — `/mcbot` slash command (subagent launcher + dashboard)

## Notes

- The `gl` native module only works under Node.js (uses NAN/V8 bindings). Bun crashes on it. The render command works around this by spawning a Node subprocess.
- Default MC version is 1.21.11. Use `--version` flag on spawn if connecting to a different version.
- The server stores each bot's host/port/version so render can reconnect to the same server.
- All commands must be run from `/srv/blockgame-server` (working directory matters for `bun run cli.ts`).
