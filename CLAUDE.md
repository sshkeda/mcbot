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
bun run cli.ts Scout mine iron_ore --count 10
bun run cli.ts Scout screenshot --radius 64

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
- Orchestrator/worker subagent architecture
- Directive system (`direct`, `--interrupt`, `--peek`, `--clear`)
- Visual commands (screenshot, pov, render, map)
- Bot profiles and personality system

## Structure

- `server.ts` — HTTP API server, manages multiple bot instances
- `cli.ts` — CLI that talks to the server via HTTP
- `lib/commands.ts` — shared command/tool registry (help, parsing, validation, routing)
- `render.cjs` — Node-only headless 3D renderer (uses gl/THREE.js, incompatible with Bun)
- `tools/` — bot tools (chop, pickup, mine, craft, build, fight, farm)
- `mcbots/` — bot profiles (personality, memories, metadata per bot)
- `.claude/skills/mcbot/SKILL.md` — `/mcbot` slash command (subagent launcher + dashboard)

## Notes

- The `gl` native module only works under Node.js (uses NAN/V8 bindings). Bun crashes on it. The render command works around this by spawning a Node subprocess.
- Default MC version is 1.21.11. Use `--version` flag on spawn if connecting to a different version.
- The server stores each bot's host/port/version so render can reconnect to the same server.
- All commands must be run from `/srv/blockgame-server` (working directory matters for `bun run cli.ts`).
