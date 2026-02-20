Use Bun, not Node.js. Use `mcbot` CLI to control bots.

## Commands

- `bun run server.ts` — start the API server (port 3847)
- `mcbot spawn <name> --port <port>` — spawn a bot
- `mcbot camera <name> <x> <y> <z> --port <port>` — spawn a stationary camera bot
- `mcbot list` — list all bots
- `mcbot kill <name>` / `mcbot killall` — disconnect bots
- `mcbot tools [--scope fleet|bot]` — list discoverable tool catalog
- `mcbot tool <toolName> --param value` — generic fleet tool invocation
- `mcbot <name> status` / `look` / `inventory` — info
- `mcbot <name> tool <toolName> --param value` — generic bot tool invocation
- `mcbot <name> survey --radius 64` — scan area (logs, water, ores, mobs)
- `mcbot <name> map --radius 32` — top-down ASCII map (T=tree *=leaves ~=water !=lava o=ore .=grass #=stone @=entity B=BOT)
- `mcbot <name> screenshot --radius 64` — top-down color PNG map (returns file path)
- `mcbot <name> pov --width 160 --height 90` — first-person raycasted PNG (returns file path)
- `mcbot <name> render` — native 3D textured render via prismarine-viewer (returns file path, requires Node 22+)
- `mcbot <name> block <x> <y> <z>` — inspect block at position (name, hardness, diggable)
- `mcbot <name> recipes <item>` — check if item is craftable + ingredients needed
- `mcbot <name> chop [--count N] [--radius N]` — chop tree(s), auto-collects drops
- `mcbot <name> pickup [--radius N]` — pick up nearby items
- `mcbot <name> mine <block> [--count N] [--radius N]` — mine blocks by name (e.g. stone, iron_ore), auto-equips best pickaxe, auto-collects
- `mcbot <name> craft <item> [--count N]` — craft item, auto-places crafting table if needed
- `mcbot <name> smelt <item> [--count N]` — smelt item in furnace (e.g. raw_iron, sand, raw_beef), auto-places furnace if needed
- `mcbot <name> place <block> <x> <y> <z>` — place block at coordinates
- `mcbot <name> place <block> front|back|left|right|up|down` — place block relative to bot
- `mcbot <name> fight [--radius N] [--count N]` — fight hostile mobs, auto-equips best weapon
- `mcbot <name> farm [--radius N]` — harvest mature crops and replant
- `mcbot <name> give <player> [item]` — walk to player and drop items
- `mcbot <name> goto <x> <y> <z>` / `follow <player>` / `stop` — movement
- `mcbot <name> chat <message>` — chat or run `/commands`

## Visual Commands — When to Use Which

All visual commands return `{ "file": "/tmp/mcbot-..." }` with a PNG path. **Always use the Read tool to view the returned image file.**

| Command | What it shows | Speed | Best for |
|---------|--------------|-------|----------|
| `screenshot` | Top-down color map (like a minimap) | Fast (~1s) | Surveying terrain layout, finding structures, seeing where things are relative to the bot |
| `pov` | First-person raycasted view (flat colors, no textures) | Fast (~2s) | Quick look at what the bot sees, checking surroundings directionally |
| `render` | Native 3D textured render (real Minecraft textures) | Slow (~15s) | Detailed visual inspection, verifying builds, seeing exactly what the world looks like |
| `map` | ASCII art top-down map | Instant | Quick spatial awareness when you don't need an image |

### Screenshot workflow

1. Run the command: `bun run cli.ts <name> screenshot`
2. The output is a file path like `/tmp/mcbot-Scout-1234567890.png`
3. Read the image with the Read tool to see it: `Read { file_path: "/tmp/mcbot-Scout-1234567890.png" }`
4. The bot (magenta dot) is always at the center of the image

### Render workflow (native 3D)

1. Run: `bun run cli.ts <name> render`
2. This spawns a temporary Node.js subprocess (render.cjs) that connects a camera bot, teleports to the bot's position, renders one frame, and disconnects
3. Takes ~15 seconds. The MC server must have cheats/OP enabled (uses `/tp`)
4. Read the returned PNG path with the Read tool
5. Only works with MC versions up to 1.21.4 (prismarine-viewer texture limit)

## Structure

- `server.ts` — HTTP API server, manages multiple bot instances (works on Bun or Node via `node:http`)
- `cli.ts` — CLI that talks to the server
- `lib/commands.ts` — shared command/tool registry (help, parsing, validation, routing)
- `render.cjs` — Node-only headless 3D renderer (uses gl/THREE.js, incompatible with Bun)
- `skills/` — bot skills (chop, pickup, mine, craft, build, fight, farm)

## Notes

- The `gl` native module only works under Node.js (uses NAN/V8 bindings). Bun crashes on it. The render command works around this by spawning a Node subprocess.
- Default MC version is 1.21.4. Use `--version` flag on spawn if connecting to a different version.
- The server stores each bot's host/port/version so render can reconnect to the same server.
