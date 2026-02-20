import { createRequire } from "node:module";
import { sleep, withTimeout } from "../lib/utils";
const require = createRequire(import.meta.url);

const SMELT_MAP: Record<string, string> = {
  raw_iron: "iron_ingot",
  raw_gold: "gold_ingot",
  raw_copper: "copper_ingot",
  iron_ore: "iron_ingot",
  gold_ore: "gold_ingot",
  copper_ore: "copper_ingot",
  cobblestone: "stone",
  sand: "glass",
  red_sand: "glass",
  clay_ball: "brick",
  netherrack: "nether_brick",
  cobbled_deepslate: "deepslate",
  wet_sponge: "sponge",
  cactus: "green_dye",
  raw_cod: "cooked_cod",
  raw_salmon: "cooked_salmon",
  raw_beef: "cooked_beef",
  raw_porkchop: "cooked_porkchop",
  raw_chicken: "cooked_chicken",
  raw_mutton: "cooked_mutton",
  raw_rabbit: "cooked_rabbit",
  potato: "baked_potato",
  kelp: "dried_kelp",
  ancient_debris: "netherite_scrap",
};

// burn time in items smelted per fuel unit
const FUEL_PRIORITY: { name: string; smelts: number }[] = [
  { name: "coal", smelts: 8 },
  { name: "charcoal", smelts: 8 },
  { name: "oak_planks", smelts: 1.5 },
  { name: "spruce_planks", smelts: 1.5 },
  { name: "birch_planks", smelts: 1.5 },
  { name: "jungle_planks", smelts: 1.5 },
  { name: "acacia_planks", smelts: 1.5 },
  { name: "dark_oak_planks", smelts: 1.5 },
  { name: "oak_log", smelts: 1.5 },
  { name: "spruce_log", smelts: 1.5 },
  { name: "birch_log", smelts: 1.5 },
  { name: "jungle_log", smelts: 1.5 },
  { name: "acacia_log", smelts: 1.5 },
  { name: "dark_oak_log", smelts: 1.5 },
  { name: "stick", smelts: 0.5 },
];

export function getSmeltOutput(inputName: string): string | null {
  return SMELT_MAP[inputName] || null;
}

export async function smeltItem(bot: any, pathfinder: any, inputName: string, count = 1) {
  const { GoalNear } = pathfinder.goals;
  const mcData = require("minecraft-data")(bot.version);
  const Vec3 = require("vec3").Vec3;

  const output = SMELT_MAP[inputName];
  if (!output) {
    return { smelted: 0, item: inputName, error: `unknown smelt recipe for "${inputName}"` };
  }

  const inputItem = bot.inventory.items().find((i: any) => i.name === inputName);
  if (!inputItem || inputItem.count < count) {
    return { smelted: 0, item: inputName, error: `need ${count} ${inputName}, have ${inputItem?.count || 0}` };
  }

  // Find fuel
  let fuelItem: any = null;
  let fuelNeeded = 0;
  for (const fuel of FUEL_PRIORITY) {
    const item = bot.inventory.items().find((i: any) => i.name === fuel.name);
    if (item) {
      fuelNeeded = Math.ceil(count / fuel.smelts);
      if (item.count >= fuelNeeded) {
        fuelItem = item;
        break;
      }
    }
  }
  if (!fuelItem) {
    return { smelted: 0, item: inputName, error: "no fuel in inventory (need coal, charcoal, planks, or logs)" };
  }

  // Find furnace
  const furnaceIds = ["furnace", "blast_furnace", "smoker"]
    .map((n) => mcData.blocksByName[n]?.id)
    .filter(Boolean);
  let furnaceBlock = bot.findBlock({ matching: furnaceIds, maxDistance: 32 });

  if (!furnaceBlock) {
    // Try placing from inventory
    const furnaceInv = bot.inventory.items().find((i: any) => i.name === "furnace" || i.name === "blast_furnace" || i.name === "smoker");
    if (!furnaceInv) {
      return { smelted: 0, item: inputName, error: "no furnace nearby or in inventory" };
    }

    const offsets = [
      [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    ];
    for (const [dx, _, dz] of offsets) {
      const floorPos = bot.entity.position.offset(dx, -1, dz).floored();
      const abovePos = floorPos.offset(0, 1, 0);
      const floor = bot.blockAt(floorPos);
      const above = bot.blockAt(abovePos);
      if (floor && floor.boundingBox === "block" && above && above.name === "air") {
        try {
          await bot.equip(furnaceInv, "hand");
          await bot.placeBlock(floor, new Vec3(0, 1, 0));
          console.log(`[SMELT] Placed furnace at ${abovePos}`);
        } catch (err: any) {
          console.log(`[SMELT] Furnace placement failed: ${err.message}`);
          continue;
        }
        furnaceBlock = bot.findBlock({ matching: furnaceIds, maxDistance: 8 });
        if (furnaceBlock) break;
      }
    }

    if (!furnaceBlock) {
      return { smelted: 0, item: inputName, error: "could not place furnace" };
    }
  }

  // Navigate to furnace
  try {
    await withTimeout(
      bot.pathfinder.goto(new GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2)),
      15000
    );
  } catch (err: any) {
    bot.pathfinder.stop();
    return { smelted: 0, item: inputName, error: `can't reach furnace: ${err.message}` };
  }

  // Open and use furnace
  const furnace = await bot.openFurnace(furnaceBlock);

  await furnace.putFuel(fuelItem.type, null, fuelNeeded);
  await furnace.putInput(inputItem.type, null, count);

  console.log(`[SMELT] Smelting ${count} ${inputName} with ${fuelNeeded} ${fuelItem.name}`);

  // Wait for smelting to complete
  const timeout = (count * 12 + 15) * 1000;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("smelting timed out")), timeout);
      const check = () => {
        const out = furnace.outputItem();
        if (out && out.count >= count) {
          clearTimeout(timer);
          furnace.removeListener("update", check);
          resolve();
        }
      };
      furnace.on("update", check);
      check();
    });
  } catch (err: any) {
    // Take whatever output is available
    const partial = furnace.outputItem();
    if (partial) await furnace.takeOutput();
    furnace.close();
    return { smelted: partial?.count || 0, item: output, error: err.message };
  }

  await furnace.takeOutput();
  furnace.close();

  console.log(`[SMELT] Done, produced ${count} ${output}`);
  return { smelted: count, item: output };
}
