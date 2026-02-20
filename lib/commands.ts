export type CommandScope = "fleet" | "bot";
export type CommandFamily =
  | "fleet.manage"
  | "world.observe"
  | "world.move"
  | "world.interact"
  | "inventory.manage"
  | "task.run";

export interface CommandSpec {
  name: string;
  scope: CommandScope;
  family: CommandFamily;
  tool: string;
  usage: string;
  summary: string;
  aliases?: string[];
  requiredParams?: string[];
  parsePositional?: (positional: string[], params: Record<string, string>) => void;
  validate?: (params: Record<string, string>) => string | null;
}

const PLACE_DIRECTIONS = new Set(["front", "back", "left", "right", "up", "down"]);

const FLEET_COMMANDS: CommandSpec[] = [
  {
    name: "spawn",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.spawn",
    usage: "spawn <name...> [--host H] [--version V]",
    summary: "Spawn one or more bots (space or comma separated)",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional.length > 1) {
        params.name = positional.join(",");
      } else if (positional[0]) {
        params.name = positional[0];
      }
    },
  },
  {
    name: "camera",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.camera",
    usage: "camera <name> <x> <y> <z> [--version V]",
    summary: "Spawn a camera bot at position",
    requiredParams: ["name", "x", "y", "z"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
      if (positional[1]) params.x = positional[1];
      if (positional[2]) params.y = positional[2];
      if (positional[3]) params.z = positional[3];
    },
  },
  {
    name: "list",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.list",
    usage: "list",
    summary: "List all bots (with lock status)",
  },
  {
    name: "kill",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.kill",
    usage: "kill <name>",
    summary: "Disconnect a bot",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "killall",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.killall",
    usage: "killall",
    summary: "Disconnect all bots",
  },
  {
    name: "ping",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.ping",
    usage: "ping",
    summary: "Check server status",
  },
  {
    name: "tools",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.tools",
    usage: "tools [--scope fleet|bot]",
    summary: "List tool catalog for agent discovery",
  },
  {
    name: "tool",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.tool",
    usage: "tool <toolName> [--param value ...]",
    summary: "Invoke a fleet tool by generic tool name",
    requiredParams: ["tool"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.tool = positional[0];
    },
  },
  {
    name: "logs",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.logs",
    usage: "logs [--bot NAME] [--count N]",
    summary: "View activity log (all bots or filtered)",
  },
  {
    name: "locks",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.locks",
    usage: "locks",
    summary: "Show all bot locks across terminals",
  },
  {
    name: "lock",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.lock",
    usage: "lock <name> [--agent AGENT] [--goal GOAL]",
    summary: "Acquire control lock on a bot",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "unlock",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.unlock",
    usage: "unlock <name>",
    summary: "Release control lock on a bot",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "use",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.use",
    usage: "use <name>",
    summary: "Set default bot for this terminal (prints export)",
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "context",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.context",
    usage: "context <name> [--goal GOAL]",
    summary: "Generate Claude Code subagent prompt for a bot",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "profile",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.profile",
    usage: "profile <name> [--init] [--memory TEXT]",
    summary: "View/init bot profile or add a memory",
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
];

const BOT_COMMANDS: CommandSpec[] = [
  {
    name: "look",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.look",
    usage: "look",
    summary: "Nearby entities and blocks",
  },
  {
    name: "inventory",
    scope: "bot",
    family: "inventory.manage",
    tool: "inventory.manage.list",
    usage: "inventory",
    summary: "Show inventory",
  },
  {
    name: "block",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.block",
    usage: "block <x> <y> <z>",
    summary: "Inspect block at position",
    requiredParams: ["x", "y", "z"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.x = positional[0];
      if (positional[1]) params.y = positional[1];
      if (positional[2]) params.z = positional[2];
    },
  },
  {
    name: "probe",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.probe",
    usage: "probe <x> <y> <z>",
    summary: "Quick block check at position (name, solid, properties)",
    requiredParams: ["x", "y", "z"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.x = positional[0];
      if (positional[1]) params.y = positional[1];
      if (positional[2]) params.z = positional[2];
    },
  },
  {
    name: "scan_volume",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.scan_volume",
    usage: "scan_volume <x1> <y1> <z1> <x2> <y2> <z2>",
    summary: "Scan a rectangular volume, return sparse non-air block list + counts",
    requiredParams: ["x1", "y1", "z1", "x2", "y2", "z2"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.x1 = positional[0];
      if (positional[1]) params.y1 = positional[1];
      if (positional[2]) params.z1 = positional[2];
      if (positional[3]) params.x2 = positional[3];
      if (positional[4]) params.y2 = positional[4];
      if (positional[5]) params.z2 = positional[5];
    },
  },
  {
    name: "diff_blueprint",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.diff_blueprint",
    usage: "diff_blueprint [--name NAME] (POST: {origin, blueprint} or {name})",
    summary: "Compare a blueprint against world state. Accepts saved name or inline JSON",
  },
  {
    name: "blueprint",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.blueprint",
    usage: "blueprint [list|show|snap|diff|delete] [<name>] [<x1> <y1> <z1> <x2> <y2> <z2>]",
    summary: "Manage saved blueprints (list, show, snap area, diff vs world, delete)",
    parsePositional: (positional, params) => {
      if (positional[0]) params.action = positional[0];
      if (positional[1]) params.name = positional[1];
      if (positional[2]) params.x1 = positional[2];
      if (positional[3]) params.y1 = positional[3];
      if (positional[4]) params.z1 = positional[4];
      if (positional[5]) params.x2 = positional[5];
      if (positional[6]) params.y2 = positional[6];
      if (positional[7]) params.z2 = positional[7];
    },
  },
  {
    name: "recipes",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.recipes",
    usage: "recipes <item>",
    summary: "Check if item is craftable + ingredients",
    requiredParams: ["item"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.item = positional[0];
    },
  },
  {
    name: "survey",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.survey",
    usage: "survey [--radius N]",
    summary: "Scan area for blocks, mobs, players",
  },
  {
    name: "inbox",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.inbox",
    usage: "inbox",
    summary: "Read and drain chat messages received by this bot",
  },
  {
    name: "direct",
    scope: "bot",
    family: "world.interact",
    tool: "world.interact.direct",
    usage: "direct <message> [--interrupt]",
    summary: "Post a directive for the action agent (--interrupt stops current action)",
    requiredParams: ["message"],
    parsePositional: (positional, params) => {
      params.message = positional.join(" ");
    },
  },
  {
    name: "directives",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.directives",
    usage: "directives [--peek] [--clear]",
    summary: "Read and drain pending directives (--peek to view without draining, --clear to cancel all)",
  },
  {
    name: "state",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.state",
    usage: "state",
    summary: "Wait up to 5s for action completion, then return full snapshot (position, velocity, health, collision, action, inbox, directives)",
    aliases: ["status", "fast_state", "poll"],
  },
  {
    name: "execute",
    scope: "bot",
    family: "task.run",
    tool: "task.run.execute",
    usage: "execute (POST: {code, name?, timeout?})",
    summary: "Execute arbitrary JS code against the bot",
  },
  {
    name: "queue",
    scope: "bot",
    family: "task.run",
    tool: "task.run.queue",
    usage: "queue [--cancel current|all|<id>]",
    summary: "View action queue or cancel actions",
  },
  {
    name: "progress",
    scope: "bot",
    family: "task.run",
    tool: "task.run.progress",
    usage: "progress",
    summary: "View mission progress (filtered [PROGRESS]/[CHECKPOINT] logs from current action)",
  },
  {
    name: "skills",
    scope: "bot",
    family: "task.run",
    tool: "task.run.skills",
    usage: "skills",
    summary: "List available code skills",
  },
  {
    name: "load_skill",
    scope: "bot",
    family: "task.run",
    tool: "task.run.load_skill",
    usage: "load_skill <name>",
    summary: "Load a skill's code and metadata",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "save_skill",
    scope: "bot",
    family: "task.run",
    tool: "task.run.save_skill",
    usage: "save_skill (POST: {name, code, description?})",
    summary: "Save a code skill",
  },
  {
    name: "place",
    scope: "bot",
    family: "world.interact",
    tool: "world.interact.place",
    usage: "place <block> <x> <y> <z> | place <block> front|back|left|right|up|down",
    summary: "Place a block at coordinates or relative to bot",
    requiredParams: ["block"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.block = positional[0];
      if (positional[1] && PLACE_DIRECTIONS.has(positional[1])) {
        params.dir = positional[1];
      } else {
        if (positional[1]) params.x = positional[1];
        if (positional[2]) params.y = positional[2];
        if (positional[3]) params.z = positional[3];
      }
    },
    validate: (params) => {
      const hasDir = Boolean(params.dir);
      const hasCoords = params.x != null && params.y != null && params.z != null;
      if (!hasDir && !hasCoords) return "need x,y,z or --dir front/back/left/right/up/down";
      return null;
    },
  },
  {
    name: "goto",
    scope: "bot",
    family: "world.move",
    tool: "world.move.goto",
    usage: "goto <x> <y> <z>",
    summary: "Navigate to coordinates",
    requiredParams: ["x", "y", "z"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.x = positional[0];
      if (positional[1]) params.y = positional[1];
      if (positional[2]) params.z = positional[2];
    },
  },
  {
    name: "follow",
    scope: "bot",
    family: "world.move",
    tool: "world.move.follow",
    usage: "follow <player>",
    summary: "Follow a player",
    requiredParams: ["player"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.player = positional[0];
    },
  },
  {
    name: "stop",
    scope: "bot",
    family: "world.move",
    tool: "world.move.stop",
    usage: "stop",
    summary: "Stop current action",
  },
  {
    name: "chat",
    scope: "bot",
    family: "world.interact",
    tool: "world.interact.chat",
    usage: "chat <message>",
    summary: "Send chat message",
    requiredParams: ["message"],
    parsePositional: (positional, params) => {
      params.message = positional.join(" ");
    },
  },
  {
    name: "attack",
    scope: "bot",
    family: "world.interact",
    tool: "world.interact.attack",
    usage: "attack [<player>]",
    summary: "Attack nearest hostile or a specific player",
    parsePositional: (positional: string[], params: any) => {
      if (positional.length > 0) params.target = positional.join("");
    },
  },
  {
    name: "dig",
    scope: "bot",
    family: "world.interact",
    tool: "world.interact.dig",
    usage: "dig <x> <y> <z>",
    summary: "Dig block at position",
    requiredParams: ["x", "y", "z"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.x = positional[0];
      if (positional[1]) params.y = positional[1];
      if (positional[2]) params.z = positional[2];
    },
  },
  {
    name: "drop",
    scope: "bot",
    family: "inventory.manage",
    tool: "inventory.manage.drop",
    usage: "drop <item>",
    summary: "Drop item from inventory",
    requiredParams: ["item"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.item = positional[0];
    },
  },
  {
    name: "equip",
    scope: "bot",
    family: "inventory.manage",
    tool: "inventory.manage.equip",
    usage: "equip <item> [slot]",
    summary: "Equip item",
    requiredParams: ["item"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.item = positional[0];
      if (positional[1]) params.slot = positional[1];
    },
  },
  {
    name: "give",
    scope: "bot",
    family: "world.interact",
    tool: "world.interact.give",
    usage: "give <player> [item]",
    summary: "Walk to player and drop items",
    requiredParams: ["player"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.player = positional[0];
      if (positional[1]) params.item = positional[1];
    },
  },
  {
    name: "render",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.render",
    usage: "render [--camera x,y,z] [--lookAt x,y,z] [--fov N] [--spp N] [--world PATH] [--inspect true|false]",
    summary: "Native 3D render. Chunky inspect mode is default for build review clarity",
    validate: (params) => {
      if (params.spp != null && (isNaN(Number(params.spp)) || Number(params.spp) <= 0)) {
        return "--spp must be a positive number";
      }
      return null;
    },
  },
  {
    name: "snapshot",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.snapshot",
    usage: "snapshot <x1> <y1> <z1> <x2> <y2> <z2> [--blueprint NAME] [--maxLayers N]  OR  snapshot --blueprint NAME",
    summary: "Structural scan with ASCII layer maps + optional blueprint diff",
    parsePositional: (positional, params) => {
      if (positional[0]) params.x1 = positional[0];
      if (positional[1]) params.y1 = positional[1];
      if (positional[2]) params.z1 = positional[2];
      if (positional[3]) params.x2 = positional[3];
      if (positional[4]) params.y2 = positional[4];
      if (positional[5]) params.z2 = positional[5];
    },
    validate: (params) => {
      const coordFields = [params.x1, params.y1, params.z1, params.x2, params.y2, params.z2];
      const hasAnyCoord = coordFields.some(f => f != null && f !== "");
      const hasAllCoords = coordFields.every(f => f != null && f !== "" && !isNaN(Number(f)));
      if (hasAnyCoord && !hasAllCoords) return "partial coordinates: need all of x1 y1 z1 x2 y2 z2";
      if (!hasAllCoords && !params.blueprint) return "need x1 y1 z1 x2 y2 z2 or --blueprint NAME";
      return null;
    },
  },
  {
    name: "orbit",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.orbit",
    usage: "orbit [<cx> <cy> <cz>] [--radius 15] [--height 5] [--count 4] [--spp N] [--world PATH] [--inspect true|false]  OR  orbit --blueprint NAME",
    summary: "Take screenshots around a center point (defaults to bot position)",
    parsePositional: (positional, params) => {
      if (positional[0]) params.cx = positional[0];
      if (positional[1]) params.cy = positional[1];
      if (positional[2]) params.cz = positional[2];
    },
    validate: (params) => {
      if (params.spp != null && (isNaN(Number(params.spp)) || Number(params.spp) <= 0)) {
        return "--spp must be a positive number";
      }
      const coordFields = [params.cx, params.cy, params.cz];
      const hasAnyCoord = coordFields.some(f => f != null && f !== "");
      const hasAllCoords = coordFields.every(f => f != null && f !== "" && !isNaN(Number(f)));
      if (hasAnyCoord && !hasAllCoords) return "partial coordinates: need all of cx cy cz";
      // No explicit center is valid: orbit command falls back to bot position.
      return null;
    },
  },
  {
    name: "tool",
    scope: "bot",
    family: "task.run",
    tool: "task.run.tool",
    usage: "tool <toolName> [--param value ...]",
    summary: "Invoke a bot tool by generic tool name",
    requiredParams: ["tool"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.tool = positional[0];
    },
  },
];

const ALL_COMMANDS = [...FLEET_COMMANDS, ...BOT_COMMANDS];

const byScope = {
  fleet: FLEET_COMMANDS,
  bot: BOT_COMMANDS,
} satisfies Record<CommandScope, CommandSpec[]>;

const lookup = new Map<string, CommandSpec>();
for (const spec of ALL_COMMANDS) {
  lookup.set(`${spec.scope}:${spec.name}`, spec);
  for (const alias of spec.aliases || []) {
    lookup.set(`${spec.scope}:${alias}`, spec);
  }
}

function requiredError(missing: string[]): string {
  return `need ${missing.join(", ")} param${missing.length > 1 ? "s" : ""}`;
}

export function getCommands(scope: CommandScope): CommandSpec[] {
  return [...byScope[scope]];
}

export function resolveCommand(scope: CommandScope, input: string | undefined): CommandSpec | undefined {
  if (!input) return undefined;
  return lookup.get(`${scope}:${input}`);
}

export function findByTool(scope: CommandScope, toolOrCommand: string): CommandSpec | undefined {
  const byName = resolveCommand(scope, toolOrCommand);
  if (byName) return byName;

  return byScope[scope].find((spec) => spec.tool === toolOrCommand);
}

export function applyPositional(spec: CommandSpec, positional: string[], params: Record<string, string>): void {
  spec.parsePositional?.(positional, params);
}

export function validateParams(spec: CommandSpec, params: Record<string, string>): string | null {
  if (spec.requiredParams && spec.requiredParams.length > 0) {
    const missing = spec.requiredParams.filter((param) => !params[param]);
    if (missing.length > 0) return requiredError(missing);
  }

  if (spec.validate) return spec.validate(params);
  return null;
}

export function formatCommandError(scope: CommandScope, command: string): string {
  const names = byScope[scope].map((c) => c.name).join(", ");
  return `unknown ${scope} command: ${command}. known: [${names}]`;
}
