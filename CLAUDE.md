Use Bun, not Node.js. The CLI is `bun run cli.ts` from the project root.

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
- `lib/executor.ts` — code execution engine (AsyncFunction + AbortController)
- `lib/action-queue.ts` — per-bot sequential action queue
- `lib/skill-manager.ts` — load/save skills from `skills/` directory (reads `.ts` files with JSDoc metadata headers)
- `lib/locks.ts` — cross-terminal bot locking via `/tmp/mcbot-locks/`
- `skills/` — reusable code templates as `.ts` files with embedded `@skill`/`@description`/`@tags` metadata (chop, mine, craft, smelt, pickup, fight, farm, build, goto)
- `render.cjs` — Node-only headless 3D renderer (uses gl/THREE.js, incompatible with Bun)
- `mcbots/` — bot profiles (SOUL.md for personality, memories/ for daily memory logs)
- `.claude/skills/mcbot/SKILL.md` — `/mcbot` slash command (subagent launcher + dashboard)

## Notes

- The `gl` native module only works under Node.js (uses NAN/V8 bindings). Bun crashes on it. The render command works around this by spawning a Node subprocess.
- Default MC version is 1.21.11. Use `--version` flag on spawn if connecting to a different version.
- The server stores each bot's host/port/version so render can reconnect to the same server.
- All commands must be run from the project root (working directory matters for `bun run cli.ts`).

## Orchestrator Aggression Rules

Bot orchestrators must be RELENTLESSLY AGGRESSIVE. Never hesitate. Never passively observe. Every single turn must make progress.

### Action Bias
- **ALWAYS be executing something.** If the queue is empty, submit the next action IMMEDIATELY — do not wait on an empty queue.
- **One `state`, then act.** Run `state` once to check progress. If the action is still running and the bot is moving, run `state` again. If anything is wrong, act IMMEDIATELY — don't check a second time to "confirm."
- **Never say "let me keep monitoring" or "let me check again."** If you notice a problem, FIX IT in the same turn.
- **Batch observations.** Run `state`, `inventory`, `look` in parallel — never waste a turn on a single observation command.

### Stuck Detection (ZERO TOLERANCE — ACT ON FIRST SIGN)
- Position unchanged on ANY `state` check while an action is running: **cancel + recover in the SAME turn.** Do NOT wait for a second check. One is enough.
- `isCollidedHorizontally` appears even once: **cancel + recover immediately.**
- Recovery = cancel current action + submit new code that works around the obstacle. Both in the same turn. Never end a turn with just a cancellation.

### Failure Recovery
- When an action fails, **read the error and submit corrected code in the same turn.** Do not just check state after a failure.
- If the same approach fails twice, **change strategy entirely.** Don't retry the same code a third time.
- If a timeout occurs, the code was too ambitious. Break it into smaller steps.

### Polling Discipline
- **NEVER use `sleep` in Bash commands.** No `sleep 5 &&`, no `sleep 15 &&`, NEVER. Use `bun run cli.ts <BOT> state` — it blocks up to 5s automatically, returning early when an action finishes.
- **Never wait on an empty queue.** If queue is empty, submit the next action instead.
- After an action completes, check inventory/state ONCE then immediately submit the next action.
- Never assume an action succeeded — always verify via `state` before moving on.
