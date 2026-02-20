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
    usage: "spawn <name> [--host H] [--port P] [--version V]",
    summary: "Spawn a new bot",
    requiredParams: ["name"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.name = positional[0];
    },
  },
  {
    name: "camera",
    scope: "fleet",
    family: "fleet.manage",
    tool: "fleet.manage.camera",
    usage: "camera <name> <x> <y> <z> [--port P]",
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
    summary: "List all bots",
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
];

const BOT_COMMANDS: CommandSpec[] = [
  {
    name: "status",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.status",
    usage: "status",
    summary: "Position, health, food, time, biome",
  },
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
    name: "chop",
    scope: "bot",
    family: "task.run",
    tool: "task.run.chop",
    usage: "chop [--count N] [--radius N]",
    summary: "Chop nearest tree(s)",
  },
  {
    name: "pickup",
    scope: "bot",
    family: "task.run",
    tool: "task.run.pickup",
    usage: "pickup [--radius N]",
    summary: "Pick up nearby items",
  },
  {
    name: "mine",
    scope: "bot",
    family: "task.run",
    tool: "task.run.mine",
    usage: "mine <block> [--count N] [--radius N]",
    summary: "Mine blocks by name",
    parsePositional: (positional, params) => {
      if (positional[0]) params.block = positional[0];
    },
  },
  {
    name: "craft",
    scope: "bot",
    family: "task.run",
    tool: "task.run.craft",
    usage: "craft <item> [--count N]",
    summary: "Craft an item",
    requiredParams: ["item"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.item = positional[0];
    },
  },
  {
    name: "smelt",
    scope: "bot",
    family: "task.run",
    tool: "task.run.smelt",
    usage: "smelt <item> [--count N]",
    summary: "Smelt an item",
    requiredParams: ["item"],
    parsePositional: (positional, params) => {
      if (positional[0]) params.item = positional[0];
    },
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
      const hasCoords = Boolean(params.x && params.y && params.z);
      if (!hasDir && !hasCoords) return "need x,y,z or --dir front/back/left/right/up/down";
      return null;
    },
  },
  {
    name: "fight",
    scope: "bot",
    family: "task.run",
    tool: "task.run.fight",
    usage: "fight [--radius N] [--count N]",
    summary: "Fight nearby hostile mobs",
  },
  {
    name: "farm",
    scope: "bot",
    family: "task.run",
    tool: "task.run.farm",
    usage: "farm [--radius N]",
    summary: "Harvest mature crops and replant",
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
    usage: "attack",
    summary: "Attack nearest hostile",
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
    name: "map",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.map",
    usage: "map [--radius N]",
    summary: "Top-down ASCII map of surroundings",
  },
  {
    name: "screenshot",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.screenshot",
    usage: "screenshot [--radius N] [--scale N]",
    summary: "Top-down color PNG map",
  },
  {
    name: "pov",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.pov",
    usage: "pov [--distance N] [--scale N]",
    summary: "First-person view PNG",
  },
  {
    name: "render",
    scope: "bot",
    family: "world.observe",
    tool: "world.observe.render",
    usage: "render [--viewDistance N] [--wait N]",
    summary: "Native 3D render (Node 22 only)",
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
