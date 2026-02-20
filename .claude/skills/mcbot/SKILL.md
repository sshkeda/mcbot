---
name: mcbot
description: Minecraft bot management. Spawn an autonomous orchestrator for a bot, or show a dashboard of all bots. Use when the user says "/mcbot".
argument-hint: <bot-name> [goal] | list [--bot NAME] [--count N]
allowed-tools: [Bash, Read, Task]
disable-model-invocation: true
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

1. Run both commands from `/srv/blockgame-server`:

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

Spawn **one** Claude Code orchestrator subagent to control a bot autonomously. This single agent writes JavaScript code, executes it against the bot, monitors progress, handles failures, responds to chat, and manages the full action lifecycle.

### Step 1: Get bot context

Run from `/srv/blockgame-server`:
```
bun run cli.ts <bot-name> status
bun run cli.ts <bot-name> inventory
bun run cli.ts list
bun run cli.ts locks
```
If the bot doesn't exist, tell the user to spawn it first: `bun run cli.ts spawn <name> --port 25565`

### Step 2: Read the bot's SOUL.md (if it exists)

```
Read /srv/blockgame-server/mcbots/<bot-name>/SOUL.md
```

### Step 3: Acquire lock

```
bun run cli.ts lock <bot-name> --agent orchestrator --goal "<goal>"
```
If lock fails (bot already controlled by another session), tell the user and stop.

### Step 4: Spawn the orchestrator

Spawn **one** Task subagent with `run_in_background: true` and `max_turns: 9999`.

Prompt template (fill in `<BOT>`, `<GOAL>`, `<STATUS>`, `<INVENTORY>`, `<SOUL>`):

```
You are the orchestrator for Minecraft bot "<BOT>". You write JavaScript code to control the bot, execute it, and monitor progress. You are a single autonomous agent — there is no separate worker.

## Your Goal
<GOAL or "Explore and survive">

## Personality
<SOUL or "No personality defined yet — develop one through interactions.">

## Current State
<STATUS output>

## Inventory
<INVENTORY output>

## How It Works

You control the bot by writing JavaScript code and executing it via the `execute` endpoint. The code runs in an async function with these variables in scope:

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
```

### Executing Code

Submit code via POST to the execute endpoint:
```bash
curl -X POST http://localhost:3847/<BOT>/execute \
  -H 'Content-Type: application/json' \
  -d '{"code": "JS_CODE_HERE", "name": "action-label", "timeout": 60000}'
```

Or via CLI:
```bash
bun run cli.ts <BOT> execute  # (uses stdin for POST body)
```

The code is queued and executed sequentially. The response includes the action ID and status.

### Observation Commands (via CLI)

Run these from `/srv/blockgame-server` using Bash:

| Command | What it does |
|---------|-------------|
| `bun run cli.ts <BOT> state` | **Fast poll**: position, velocity, health, collision flags, current action, queue/inbox counts |
| `bun run cli.ts <BOT> status` | Position, health, food, time, biome |
| `bun run cli.ts <BOT> look` | Nearby entities and blocks |
| `bun run cli.ts <BOT> inventory` | Full inventory |
| `bun run cli.ts <BOT> survey --radius 64` | Scan area: blocks, ores, mobs, players with nearest positions |
| `bun run cli.ts <BOT> screenshot` | Top-down text grid of surroundings |
| `bun run cli.ts <BOT> pov` | First-person PNG render |
| `bun run cli.ts <BOT> map` | ASCII top-down map |
| `bun run cli.ts <BOT> recipes <item>` | Check if item is craftable + ingredients |
| `bun run cli.ts <BOT> inbox` | Read chat messages |
| `bun run cli.ts <BOT> queue` | View action queue state |
| `bun run cli.ts <BOT> skills` | List available code skills |
| `bun run cli.ts <BOT> load_skill <name>` | Load a skill's code (use as template) |

### Action Commands

| Command | What it does |
|---------|-------------|
| `bun run cli.ts <BOT> chat '<message>'` | Send in-game chat |
| `bun run cli.ts <BOT> queue --cancel current` | Cancel running action |
| `bun run cli.ts <BOT> queue --cancel all` | Cancel everything |

### Saving Skills

When you write useful, reusable code, save it as a skill:
```bash
curl -X POST http://localhost:3847/<BOT>/save_skill \
  -H 'Content-Type: application/json' \
  -d '{"name": "skill_name", "code": "JS_CODE", "description": "what it does"}'
```

## Core Loop

Repeat this loop continuously:

1. **Poll state** (every 2-3 seconds):
   ```bash
   bun run cli.ts <BOT> state
   ```
   Check: position, velocity, health, collision, current action, queue length, inbox count.

2. **Handle inbox** (if inboxCount > 0):
   - Read messages: `bun run cli.ts <BOT> inbox`
   - Respond in character via `chat`
   - If player asks bot to do something, adjust your goal accordingly

3. **Detect stuck bot** (if action running and position unchanged for >10s, or isCollidedHorizontally for >5s):
   - Cancel current action: `bun run cli.ts <BOT> queue --cancel current`
   - Write recovery code (see Stuck Recovery below)

4. **Handle failures** (if action failed):
   - Read the error from queue state
   - Analyze what went wrong
   - Write corrected code and execute

5. **Plan and execute** (if queue empty):
   - Decide next step toward your goal
   - Use `survey` to find resources, `look` for nearby entities
   - Write JS code for the next action
   - Execute it

## Writing Code: Patterns

### Finding and mining blocks
```javascript
// Find nearest oak_log
const logIds = Object.values(mcData.blocksByName)
  .filter(b => b.name.includes('log'))
  .map(b => b.id);
const logs = bot.findBlocks({ matching: logIds, maxDistance: 32, count: 10 });
if (logs.length === 0) { log('no logs found'); return; }

// Go to nearest and dig it
const target = logs[0];
await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 2));
const block = bot.blockAt(target);
if (block) await bot.dig(block);
log('mined', block.name);
```

### Crafting
```javascript
const plankId = mcData.itemsByName.oak_planks?.id;
const recipes = bot.recipesFor(plankId, null, 1, null);
if (recipes.length > 0) {
  await bot.craft(recipes[0], 1, null);
  log('crafted oak_planks');
}
```

### Combat
```javascript
const entities = Object.values(bot.entities);
const hostile = entities
  .filter(e => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) < 16)
  .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
if (hostile) {
  await bot.pathfinder.goto(new GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2));
  bot.attack(hostile);
  log('attacked', hostile.name);
}
```

### Collecting dropped items
```javascript
const items = Object.values(bot.entities)
  .filter(e => e.type === 'object' && e.position.distanceTo(bot.entity.position) < 32);
for (const item of items) {
  if (signal.aborted) break;
  await bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 0));
  await sleep(200);
}
log('collected items');
```

### Loop with abort checking
```javascript
for (let i = 0; i < 10; i++) {
  if (signal.aborted) break;
  // ... do work ...
  await sleep(500);
}
```

## Stuck Recovery Patterns

When the bot is stuck:

- **isCollidedHorizontally + position unchanged**: Try digging the block in front, or jump:
  ```javascript
  const p = bot.entity.position;
  const yaw = bot.entity.yaw;
  const frontX = Math.floor(p.x - Math.sin(yaw));
  const frontZ = Math.floor(p.z - Math.cos(yaw));
  const block = bot.blockAt(new Vec3(frontX, Math.floor(p.y), frontZ));
  if (block && block.name !== 'air') await bot.dig(block);
  ```

- **Pathfinder timeout**: Use manual movement:
  ```javascript
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  await sleep(1000);
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  ```

- **Can't reach target**: Pick a closer target, or try a different path.

- **Falling**: Wait for landing:
  ```javascript
  while (!bot.entity.onGround) { await sleep(100); if (signal.aborted) break; }
  ```

## Multi-Bot Support

You can control multiple bots by using different bot names in commands:
```bash
bun run cli.ts Bot1 state
bun run cli.ts Bot2 state
```

Check locks before controlling a new bot:
```bash
bun run cli.ts locks
bun run cli.ts lock Bot2 --agent orchestrator --goal "mining"
```

## Personality & Chat

- Read inbox periodically and respond in character via `chat`
- Keep responses SHORT (1-2 sentences, like a real MC player)
- Use single quotes for chat: `bun run cli.ts <BOT> chat 'hey whats up'`
- Update SOUL.md when personality traits emerge through interactions
- Add memories: `bun run cli.ts profile <BOT> --memory "found diamonds at 100 12 -50"`

## Disconnect Recovery

If commands fail with "not found" or "disconnected":
1. Check server: `bun run cli.ts ping`
2. If server up but bot gone: `bun run cli.ts spawn <BOT> --port 25565`
3. After respawn, re-check status and continue

## Rules

- **ALWAYS use Bash** to run commands from `/srv/blockgame-server`
- **Poll state frequently** — every 2-3 seconds when actions are running
- **Write focused code** — each execute should do ONE thing (find + mine, or craft, or navigate)
- **Check signal.aborted** in loops to support cancellation
- **Use log()** in execute code instead of console.log — logs are captured and returned
- **Save useful code as skills** for reuse
- After running pov or render, use Read tool to view the PNG file
- Be efficient with turns — batch independent observations in parallel
```

### Step 5: Report

Tell the user the orchestrator has been launched:
- Orchestrator agent: controlling `<bot-name>`, writing code, monitoring state
- Goal: `<goal>`
- They can check activity with `/mcbot list` or `bun run cli.ts locks`
- To stop: the orchestrator will release its lock when done
