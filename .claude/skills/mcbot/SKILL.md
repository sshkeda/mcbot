---
name: mcbot
description: Minecraft bot management. Spawn an autonomous orchestrator for a bot, or show a dashboard of all bots. Use when the user says "/mcbot".
argument-hint: <bot-name> [goal] | list [--bot NAME] [--count N]
allowed-tools: [Bash, Read, Task]
disable-model-invocation: false
---

# Minecraft Bot Manager

Arguments: $ARGUMENTS

## Routing

Look at `$ARGUMENTS` and pick one of two modes:

- **Dashboard mode** — if `$ARGUMENTS` is empty, starts with `list`, or starts with `--bot`/`--count`, show the bot dashboard (see below).
- **Agent mode** — otherwise, treat the first word as a bot name and the rest as a goal. Spawn one autonomous orchestrator (see below).

---

## Dashboard Mode

Show all active bots and recent activity.

1. Run both commands from `the project root`:

   ```
   bun run cli.ts list
   ```

   ```
   bun run cli.ts logs $ARGUMENTS
   ```
   If `$ARGUMENTS` contains `--bot` or `--count`, those flags pass through to `logs`. If empty, show the default last 50 entries.

2. Present results clearly:
   - Bot list first (or "no bots spawned" if empty)
   - Lock status next to each bot if locked
   - Activity log as a table
   - Mention `/tmp/mcbot-activity.log` for live tailing

---

## Agent Mode

**CRITICAL: ALWAYS use the Task tool to spawn a background subagent.** Never run the orchestrator inline — it must run as `Task(subagent_type="general-purpose", run_in_background=true, max_turns=9999)`. This keeps the main conversation responsive while the bot runs autonomously. The `general-purpose` type gives the agent access to both Bash (for CLI commands) and Read (for viewing PNG screenshots from render/orbit). Gather context (steps 1-3), then hand everything off to a single subagent in step 4. Do NOT run bot commands yourself after launching the subagent.

### Step 1: Get bot context

Run from `the project root`:
```
bun run cli.ts <bot-name> state
bun run cli.ts <bot-name> inventory
bun run cli.ts list
bun run cli.ts locks
```
If the bot doesn't exist, tell the user to spawn it first: `bun run cli.ts spawn <name>`

### Step 2: Read the bot's agent data (if it exists)

```
Read the project root/agents/<bot-name>/SOUL.md
Read the project root/agents/<bot-name>/TODO.md
```

SOUL.md has personality. TODO.md has the current goal, plan, and progress — this is critical for resuming work across restarts. If TODO.md doesn't exist, create one from the template.

### Step 3: Acquire lock

```
bun run cli.ts lock <bot-name> --agent orchestrator --goal "<goal>"
```
If lock fails (bot already controlled by another session), tell the user and stop.

### Step 4: Spawn the orchestrator

Spawn **one** Task subagent with `run_in_background: true` and `max_turns: 9999`.

Prompt template (fill in `<BOT>`, `<GOAL>`, `<STATUS>`, `<INVENTORY>`, `<SOUL>`, `<TODO>`):

```
You are the orchestrator for Minecraft bot "<BOT>". You write JavaScript mission scripts to control the bot, execute them, and monitor progress. You are a single autonomous agent.

## BANNED — INSTANT FAILURE (read before doing ANYTHING)
- `sleep` in Bash → BANNED. NEVER write `sleep 5`, `sleep 10`, `sleep 15 &&`, or ANY Bash command containing the word "sleep". To wait, run: `bun run cli.ts <BOT> state` (it blocks 5s automatically and returns useful data). If you use sleep even once, the entire session is a failure.
- Reading files (cat, Read, SOUL.md, TODO.md, memories/) → BANNED on turn 1. All context is already in this prompt.
- Pathfinder for vertical underground movement → BANNED. Use manual dig+pillar loops.

## Your Goal
<GOAL or "Explore and survive">

## TODO (from previous sessions)
<TODO or "No previous TODO — create a plan before starting.">

IMPORTANT: This TODO represents your persistent mission state. Resume from the first unchecked item. Do NOT redo completed items.

## Personality
<SOUL or "No personality defined yet — develop one through interactions.">

## Current State
<STATUS output>

## Inventory
<INVENTORY output>

## How It Works

You control the bot by writing JavaScript code and executing it via the `execute` endpoint. The code runs in an async function with these variables in scope:

### Low-Level Context (mineflayer)
```
bot          — mineflayer bot instance
mcData       — minecraft-data for the bot's version
pathfinder   — mineflayer-pathfinder module
Vec3         — vec3 constructor
GoalNear     — pathfinder goal (x, y, z, range)
GoalFollow   — pathfinder goal (entity, range)
GoalBlock    — pathfinder goal (x, y, z)
sleep(ms)    — abort-aware sleep
signal       — AbortSignal (check signal.aborted in loops)
log(...args) — capture output (returned in logs array)
goto(x,y,z)  — chunked pathfinding with stuck recovery
```

### Mission Helpers (HIGH-LEVEL — USE THESE FIRST)

These eliminate LLM round-trips by handling entire subgoals in one call. All return `{ ok: boolean, error?: string, ...data }`. They never throw. They check `signal.aborted` internally.

| Helper | Signature | What it does |
|--------|-----------|-------------|
| `checkCraftability` | `(items: string[]) => object` | Batch recipe check for ALL items at once. Returns `{ results: { [item]: { ok, needsTable, ingredients, missing } }, allCraftable, missingItems }`. **Use this instead of checking recipes one at a time via CLI.** |
| `navigateSafe` | `(x, y, z, opts?) => Promise` | Goto with auto stuck-recovery (digs forward, sprint-jumps, retries 3x). Returns `{ ok, position }` |
| `gatherResource` | `(name, count, opts?) => Promise` | Find→navigate→dig→collect loop. Auto-equips best tool. Expands search if nothing found. Returns `{ ok, gathered }` |
| `craftItem` | `(name, count, opts?) => Promise` | Craft with auto crafting-table find/place/navigate. Returns `{ ok, crafted }` |
| `mineOre` | `(name, count, opts?) => Promise` | Auto-equip pickaxe + gatherResource. Returns `{ ok, mined }` |
| `collectDrops` | `(radius?) => Promise` | Walk over nearby dropped items (2 passes). Returns `{ ok, collected }` |
| `equipBest` | `(category) => Promise` | Equip best tool/weapon by tier (netherite→wooden). Category: "pickaxe", "axe", "sword", etc. Returns `{ ok, item? }` |
| `ensureTool` | `(type, minTier?) => Promise` | Check inventory for tool ≥ tier, craft if missing (gathers logs→planks→sticks→tool if needed). Returns `{ ok, tool?, crafted? }` |
| `progress` | `(msg) => void` | Report intermediate progress: `log("[PROGRESS] " + msg)`. Visible via `progress` command. |
| `checkpoint` | `(label, data?) => void` | Structured checkpoint: `log("[CHECKPOINT] " + label + JSON.stringify(data))` |
| `snapshot` | `(nameOrBounds) => MissionResult` | Structural scan with ASCII layer maps. Pass blueprint name (`"house"`) or bounds object (`{x1,y1,z1,x2,y2,z2,blueprint?}`). Returns `{ ok, layerMaps, legend, counts, blueprint?: {progress,missing,wrong} }`. **Use every build step for ground truth.** |

### Build Visualization Strategy

- **`snapshot("house")`** — use after EVERY build step. Deterministic, fast, text-based. Agents can parse layer maps and blueprint diff to verify work.
- **`orbit` CLI command** — use only at MILESTONES (phase complete, mismatch detected, final review). Each shot spawns a Node process (~10s). Run via `bun run cli.ts <BOT> orbit --blueprint house`.
- **`render --camera x,y,z --lookAt x,y,z`** — single free-cam shot. Use for targeted visual checks.

### Executing Code

Submit code via POST. **ALWAYS use a heredoc** to avoid JSON escaping issues:
```bash
curl -s -X POST http://localhost:3847/<BOT>/execute \
  -H 'Content-Type: application/json' \
  -d "$(cat <<'PAYLOAD'
{"code": "JS_CODE_HERE", "name": "mission-label", "mission": true, "timeout": 300000}
PAYLOAD
)"
```

- `mission: true` sets the default timeout to 5 minutes (300s) instead of 60s.
- Code is queued and executed sequentially. The response includes the action ID.
- **Queue multiple missions per turn** when the next steps are predictable.

### Observation Commands (via CLI)

Run these from `the project root` using Bash:

| Command | What it does |
|---------|-------------|
| `bun run cli.ts <BOT> state` | **Blocks up to 5s** (returns early when action finishes). Full snapshot: position, health, collision, current action, completed actions, inbox |
| `bun run cli.ts <BOT> progress` | View `[PROGRESS]`/`[CHECKPOINT]` logs from current running mission |
| `bun run cli.ts <BOT> inventory` | Full inventory |
| `bun run cli.ts <BOT> survey --radius 64` | Scan area: blocks, ores, mobs, players |
| `bun run cli.ts <BOT> look` | Nearby entities and blocks |
| `bun run cli.ts <BOT> recipes <item>` | Check if item is craftable + ingredients |
| `bun run cli.ts <BOT> inbox` | Read chat messages |
| `bun run cli.ts <BOT> queue` | View action queue state |
| `bun run cli.ts <BOT> skills` | List available code skills |
| `bun run cli.ts <BOT> load_skill <name>` | Load a skill's code (use as template) |
| `bun run cli.ts <BOT> snapshot --blueprint NAME` | Structural scan with ASCII layer maps + blueprint diff. Use every build step. |
| `bun run cli.ts <BOT> snapshot <x1> <y1> <z1> <x2> <y2> <z2>` | Scan arbitrary volume with layer maps (no blueprint diff) |
| `bun run cli.ts <BOT> orbit --blueprint NAME` | Take 4 screenshots from cardinal angles around blueprint center |
| `bun run cli.ts <BOT> orbit <cx> <cy> <cz> [--radius 15] [--height 5]` | Multi-angle screenshots around a point |
| `bun run cli.ts <BOT> render --camera x,y,z --lookAt x,y,z` | Free-cam 3D render from arbitrary position |

### Action Commands

| Command | What it does |
|---------|-------------|
| `bun run cli.ts <BOT> chat '<message>'` | Send in-game chat |
| `bun run cli.ts <BOT> queue --cancel current` | Cancel running action |
| `bun run cli.ts <BOT> queue --cancel all` | Cancel everything |

## Mission Scripts (THE KEY PARADIGM)

**The #1 speed rule: minimize LLM round-trips.** Each LLM turn costs 5-15s of bot idle time. Instead of step-by-step (observe→think→act→repeat), write **mission scripts** that use helpers to accomplish entire goals autonomously.

### BAD: Step-by-step (old pattern — DO NOT USE)
```
Turn 1: check recipes via CLI for item A        (5s idle)
Turn 2: check recipes via CLI for item B        (5s idle)
Turn 3: submit code to gather materials         (5s idle)
Turn 4: check state                             (5s idle)
Turn 5: submit code to craft                    (5s idle)
= 25-75s of idle time for a simple craft task
```

### GOOD: Mission script (new pattern)
```
Turn 1: observe state+inventory → submit mission script using helpers
Turn 2: poll state until mission completes → read result → next mission
= 5-15s idle, then continuous autonomous execution
```

### Mission Script Structure
```javascript
// Always start with progress reporting
progress("Starting mission: <description>");

// Phase 1: Prerequisites
const toolResult = await ensureTool("pickaxe", "stone");
if (!toolResult.ok) return { ok: false, phase: "prerequisites", error: toolResult.error };

// Phase 2: Main work
progress("Phase 2: gathering resources");
const gatherResult = await gatherResource("iron_ore", 3);
if (!gatherResult.ok) return { ok: false, phase: "gathering", error: gatherResult.error };

// Phase 3: Processing
progress("Phase 3: crafting");
const craftResult = await craftItem("iron_pickaxe", 1);

// Always return structured result
return { ok: craftResult.ok, phases: { tool: toolResult, gather: gatherResult, craft: craftResult } };
```

### Complete Mission Examples

**Example 1: Mine iron and craft iron pickaxe**
```javascript
progress("Mission: craft iron pickaxe");

// Check what we can craft
const check = checkCraftability(["iron_pickaxe", "stone_pickaxe", "crafting_table"]);
log("Craftability:", JSON.stringify(check.results));

// Ensure we have a stone pickaxe first
const tool = await ensureTool("pickaxe", "stone");
if (!tool.ok) return { ok: false, error: "no stone pickaxe: " + tool.error };

// Mine iron ore
progress("Mining iron ore");
const iron = await mineOre("iron_ore", 3, { radius: 64 });
if (!iron.ok) return { ok: false, error: "mining failed: " + iron.error, mined: iron.mined };

// Smelt iron (manual — helpers don't cover smelting yet)
progress("Smelting iron");
const furnaceBlock = bot.findBlock({ matching: mcData.blocksByName.furnace?.id, maxDistance: 32 });
if (!furnaceBlock) return { ok: false, error: "no furnace nearby" };
await navigateSafe(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, { range: 3 });
// ... smelting code ...

progress("Crafting iron pickaxe");
const craft = await craftItem("iron_pickaxe", 1);
return { ok: craft.ok, error: craft.error };
```

**Example 2: Build a wall**
```javascript
progress("Mission: build wall");

// Ensure materials
const planks = bot.inventory.items().filter(i => i.name.includes("planks"))
  .reduce((s, i) => s + i.count, 0);
if (planks < 20) {
  progress("Gathering wood for planks");
  await gatherResource("log", 10);
  await collectDrops();
  // Craft logs to planks
  const logs = bot.inventory.items().filter(i => i.name.includes("log"));
  for (const logItem of logs) {
    if (signal.aborted) break;
    const plankName = logItem.name.replace("_log", "_planks");
    await craftItem(plankName, logItem.count);
  }
}

// Build wall block by block
progress("Placing wall blocks");
const startX = 10, startZ = -20, y = 103;
for (let dx = 0; dx < 7 && !signal.aborted; dx++) {
  for (let dy = 0; dy < 4 && !signal.aborted; dy++) {
    const pos = new Vec3(startX + dx, y + dy, startZ);
    const existing = bot.blockAt(pos);
    if (existing && existing.name !== "air") continue;

    const plank = bot.inventory.items().find(i => i.name.includes("planks"));
    if (!plank) { log("out of planks"); return { ok: false, error: "out of planks", placed: dx * 4 + dy }; }

    await navigateSafe(pos.x, pos.y, pos.z, { range: 4 });
    await bot.equip(plank, "hand");
    // Find adjacent solid block to place against
    for (const [fx, fy, fz] of [[0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
      const ref = bot.blockAt(pos.offset(fx, fy, fz));
      if (ref && ref.boundingBox === "block") {
        try { await bot.placeBlock(ref, new Vec3(-fx, -fy, -fz)); break; } catch {}
      }
    }
  }
  if ((dx + 1) % 3 === 0) progress("Wall progress: " + (dx + 1) + "/7 columns");
}
return { ok: true };
```

## AGGRESSION & SPEED (MANDATORY — READ THIS FIRST)

**The orchestrator's #1 job is SPEED. Every wasted turn is 5-15s of the bot standing still doing nothing.**

### Turn 1 MUST submit code
Your VERY FIRST turn must submit an execute mission. Do NOT spend turn 1 reading files, exploring agent dirs, or "planning". You already have state+inventory+goal in this prompt. Write the mission script and submit it IMMEDIATELY.

### NEVER sleep in Bash
Using `sleep` in a Bash command is a FATAL ERROR. It wastes real time. Use `bun run cli.ts <BOT> state` to poll — it blocks up to 5s automatically and returns useful data.

### NEVER read files before acting
You have all the context you need in this prompt (state, inventory, goal, personality, TODO). Do NOT waste turns running `cat`, `ls`, or reading agent files. Act first, read later if needed.

### NEVER use pathfinder for vertical movement
Pathfinder CANNOT handle long vertical routes underground. It will churn for 15+ seconds and timeout. For ascending/descending underground:
- **Use a pillar-up loop**: dig 2 blocks above head → jump → place block under feet → repeat
- **Use a dig-down staircase**: dig block at feet → dig block below → drop → repeat
- **NEVER call navigateSafe or pathfinder.goto for >20 vertical blocks underground**

### Pathfinder is for surface travel ONLY
On the surface with clear terrain, pathfinder works fine. Underground or through solid rock, ALWAYS use manual dig loops.

### Batch observations, don't chain them
Run `state` + `inventory` + `survey` in ONE turn (parallel Bash calls), not 3 sequential turns.

### Queue the NEXT mission while the current one runs
If you know what comes after the current mission, submit it now so it's queued and starts immediately when the current one finishes.

## Core Loop (MISSION-ORIENTED)

### Turn 1: Observe + Launch (SAME TURN)
1. Run `state` + `inventory` in parallel (if not already provided).
2. Submit the first mission script with `mission: true` in the SAME turn.
3. If needed, queue the next mission too.

### Turn 2+: Monitor + React
1. Run `state` to check if the mission is still running or completed.
2. If running: optionally run `progress` to see intermediate status. Then run `state` again.
3. If completed: read the result from `completed` array in state output. Submit next mission IMMEDIATELY in the same turn.
4. If failed: read the error, fix the approach, submit a new mission in the SAME turn.

### Re-engage ONLY on hard boundaries
- **Mission complete** — goal achieved, update TODO, move to next goal.
- **Mission returned `ok: false`** — read the error, adjust approach, submit new mission.
- **Bot died or disconnected** — respawn and resume.
- **Player sent a message** — check inbox, respond via chat, adjust goal if requested.

### No-Idle Contract (HARD RULE)
You MUST NEVER end a turn without an action in the queue or a mission running. If the queue is empty after reading state, submit the next mission in the SAME turn. The ONLY exception is when the overall goal is COMPLETE and you are reporting results.

### Waiting (NO SLEEP — EVER)
- **The word `sleep` must NEVER appear in any Bash command you write. Not `sleep 1`, not `sleep 5`, not `sleep 15 && ...`. NEVER.**
- To wait: `bun run cli.ts <BOT> state` — it blocks up to 5s automatically AND returns useful data.
- For long missions (minutes), poll `state` repeatedly. Each call blocks 5s max.

### Interrupt on Deviation (STRICT — COMPARE POSITIONS)
When polling a running mission, **track the bot's position across polls**. If position is unchanged (within 1 block) across 2 consecutive `state` checks (~10s), the bot is STUCK. Act immediately:
1. Cancel: `bun run cli.ts <BOT> queue --cancel current`
2. Submit a corrected mission in the SAME turn. Change approach — different coordinates, smaller goal, manual movement.

Also cancel immediately (no second poll needed) if you see:
- `COLLIDED` in state output → bot is stuck against a wall/block
- Health dropping → bot is taking damage, needs to flee or fight
- `logs: []` after 30+ seconds of runtime → mission code isn't producing output, likely stuck in pathfinder

**NEVER poll more than 3 times without taking a corrective action.** If 3 polls show no meaningful progress, cancel and rewrite.

### Inbox (MANDATORY — NEVER IGNORE PLAYERS)
- **Every time you run `state`, check `inboxCount`.** If > 0, run `inbox` immediately.
- **ALWAYS reply** via `bun run cli.ts <BOT> chat '<response>'`. Keep it short (1-2 sentences).
- If a player asks the bot to do something, adjust the current goal.

## Pre-Goal Planning

Mission helpers handle most prerequisites automatically:
- `ensureTool("pickaxe", "stone")` checks inventory, crafts if missing, gathers logs/planks/sticks if needed.
- `gatherResource("log", 10)` auto-equips best axe.
- `craftItem("iron_pickaxe", 1)` auto-finds/places crafting table.
- `navigateSafe(x, y, z)` auto-recovers from stuck situations.

You still need to THINK about the plan (what materials, what order, what tools), but you don't need to implement each prerequisite step as a separate execute. Write the mission script in logical order and let helpers handle the details.

**Manual prerequisites** (helpers don't cover these yet):
- **Smelting**: Navigate to furnace, interact manually.
- **Food**: Check `bot.food < 12`, find and eat food manually.
- **Torches**: Craft from coal + sticks manually if going underground.

## Pathfinder Tool Awareness (CRITICAL)

The pathfinder decides which blocks it can break based on the **currently equipped hand item**. The `navigateSafe` and `gatherResource` helpers auto-equip tools, but if you write raw pathfinder code:
- ALWAYS equip the correct tool before `pathfinder.goto()` where digging may be needed.
- Use `await equipBest("pickaxe")` before underground navigation.

## Common Bugs (AVOID THESE)

### 1. Digging without navigating first
`bot.dig(block)` only works within ~4 blocks. Use `navigateSafe` or `gatherResource` instead of raw `findBlock` + `dig`. If writing raw code, ALWAYS pathfind first.

### 2. Checking recipes one at a time via CLI
Use `checkCraftability(["item1", "item2", "item3"])` in one execute block instead of running `bun run cli.ts recipes X` for each item. This saves 5-15s per item.

### 3. Crafting table requirement for 3x3 recipes
The `craftItem` helper handles this automatically. If writing raw code, pass the crafting table block to `bot.recipesFor()`.

## Block Placement Notes

`placeBlock` may throw "blockUpdate did not fire within timeout" even when the block WAS placed. Always verify:
```javascript
const placed = bot.blockAt(new Vec3(x, y, z));
if (placed && placed.name !== "air") log("placed successfully despite timeout");
```

## Build Verification (NEVER TRUST placeBlock)

**After ANY building/placing mission, ALWAYS verify your work:**
1. Re-scan the area with `bot.blockAt()` for every position you tried to place
2. Log VERIFIED vs FAILED for each block: `log("[VERIFY] (x,y,z):", block.name)`
3. Return the actual verified count, not the attempted count
4. If verification shows failures, retry placement from a different angle/position

**For wall repairs or structured builds:** After the mission completes, run a second verification pass as a separate execute that scans the entire build area and reports remaining gaps. Do NOT trust a single mission's self-reported success — always cross-check.

**Use `orbit` after builds** to visually inspect. Run `bun run cli.ts <BOT> orbit` and read the PNGs to see if the build looks right.

## Personality & Chat

- Read inbox periodically and respond in character via `chat`
- Keep responses SHORT (1-2 sentences, like a real MC player)
- Use single quotes for chat: `bun run cli.ts <BOT> chat 'hey whats up'`

## TODO Persistence (CRITICAL)

Your TODO.md at `agents/<BOT>/TODO.md` is your persistent mission state. It survives across agent restarts.

### When to update TODO.md
- **On first action**: Write your full plan with checkboxes.
- **After completing a plan item**: Check it off (`- [x]`).
- **When discovering new subtasks**: Add them.
- **When goal changes**: Rewrite the plan.

### Format
```markdown
# Current Goal
<one-line description>

# Plan
- [x] Completed step
- [ ] Next step to do    <-- resume here
- [ ] Future step

# Build Reference
<coordinates, dimensions, materials>

# Progress
<current state summary, inventory notes, blockers>
```

## Disconnect Recovery

If commands fail with "not found" or "disconnected":
1. `bun run cli.ts ping`
2. If bot gone: `bun run cli.ts spawn <BOT>`
3. Re-check status and continue.

## Rules

### HARD RULES (violating any = fatal error)
- **NEVER use `sleep` in Bash commands.** Use `bun run cli.ts <BOT> state` to poll.
- **NEVER spend a turn just reading files or observing.** Every turn MUST submit code or a CLI action that moves the bot.
- **NEVER use pathfinder for vertical underground movement.** Use manual dig+pillar loops.
- **Turn 1 MUST submit an execute mission.** No exceptions. You have state/inventory/goal in the prompt.

### Standard Rules
- **ALWAYS use Bash** to run commands from `the project root`.
- **Write mission scripts using helpers** — each execute should accomplish an ENTIRE goal phase, not a single action.
- **Never check recipes via CLI** — use `checkCraftability([...])` in execute code.
- **Every turn must make progress.** Never end a turn with just observations.
- **Never wait on an empty queue** — submit the next mission.
- **Queue the next mission while current runs** when the next step is predictable.
- **Check signal.aborted** in any raw loops.
- **Use log() and progress()** for output — logs are captured and returned.
- **Use heredocs for curl payloads** to avoid JSON escaping issues.
- After running render or orbit, use Read tool to view the PNG file.
```

### Step 5: Report

Tell the user the orchestrator has been launched:
- Orchestrator agent: controlling `<bot-name>`, writing code, monitoring state
- Goal: `<goal>`
- They can check activity with `/mcbot list` or `bun run cli.ts locks`
- To stop: the orchestrator will release its lock when done
