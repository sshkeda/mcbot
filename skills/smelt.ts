/**
 * @skill smelt
 * @description Smelt items in furnace with auto furnace placement
 * @tags crafting, smelting
 */

// Smelt items in a furnace. Auto-places furnace if needed.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log
// Params: INPUT_NAME (string), COUNT (number, default 1)

const inputName = typeof INPUT_NAME !== 'undefined' ? INPUT_NAME : '';
const count = typeof COUNT !== 'undefined' ? COUNT : 1;

const SMELT_MAP = {
  raw_iron: "iron_ingot", raw_gold: "gold_ingot", raw_copper: "copper_ingot",
  iron_ore: "iron_ingot", gold_ore: "gold_ingot", copper_ore: "copper_ingot",
  cobblestone: "stone", sand: "glass", red_sand: "glass",
  clay_ball: "brick", netherrack: "nether_brick", cobbled_deepslate: "deepslate",
  wet_sponge: "sponge", cactus: "green_dye",
  raw_cod: "cooked_cod", raw_salmon: "cooked_salmon", raw_beef: "cooked_beef",
  raw_porkchop: "cooked_porkchop", raw_chicken: "cooked_chicken",
  raw_mutton: "cooked_mutton", raw_rabbit: "cooked_rabbit",
  potato: "baked_potato", kelp: "dried_kelp", ancient_debris: "netherite_scrap",
};

const FUEL_PRIORITY = [
  { name: "coal", smelts: 8 }, { name: "charcoal", smelts: 8 },
  { name: "oak_planks", smelts: 1.5 }, { name: "spruce_planks", smelts: 1.5 },
  { name: "birch_planks", smelts: 1.5 }, { name: "jungle_planks", smelts: 1.5 },
  { name: "acacia_planks", smelts: 1.5 }, { name: "dark_oak_planks", smelts: 1.5 },
  { name: "oak_log", smelts: 1.5 }, { name: "spruce_log", smelts: 1.5 },
  { name: "birch_log", smelts: 1.5 }, { name: "stick", smelts: 0.5 },
];

if (!inputName) return { smelted: 0, error: "no input name specified" };
const output = SMELT_MAP[inputName];
if (!output) return { smelted: 0, error: `no smelt recipe for "${inputName}"` };

const inputItem = bot.inventory.items().find(i => i.name === inputName);
if (!inputItem || inputItem.count < count) {
  return { smelted: 0, error: `need ${count} ${inputName}, have ${inputItem?.count || 0}` };
}

// Find fuel
let fuelItem = null;
let fuelNeeded = 0;
for (const fuel of FUEL_PRIORITY) {
  const item = bot.inventory.items().find(i => i.name === fuel.name);
  if (item) {
    fuelNeeded = Math.ceil(count / fuel.smelts);
    if (item.count >= fuelNeeded) { fuelItem = item; break; }
  }
}
if (!fuelItem) return { smelted: 0, error: "no fuel in inventory" };

// Find furnace
const furnaceIds = ["furnace", "blast_furnace", "smoker"]
  .map(n => mcData.blocksByName[n]?.id).filter(Boolean);
let furnaceBlock = bot.findBlock({ matching: furnaceIds, maxDistance: 32 });

if (!furnaceBlock) {
  const furnaceInv = bot.inventory.items().find(i =>
    i.name === "furnace" || i.name === "blast_furnace" || i.name === "smoker");
  if (!furnaceInv) return { smelted: 0, error: "no furnace nearby or in inventory" };

  const offsets = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1]];
  for (const [dx, _, dz] of offsets) {
    const floorPos = bot.entity.position.offset(dx, -1, dz).floored();
    const above = floorPos.offset(0, 1, 0);
    const floor = bot.blockAt(floorPos);
    const aboveBlock = bot.blockAt(above);
    if (floor && floor.boundingBox === "block" && aboveBlock && aboveBlock.name === "air") {
      try {
        await bot.equip(furnaceInv, "hand");
        await bot.placeBlock(floor, new Vec3(0, 1, 0));
        log(`Placed furnace`);
      } catch { continue; }
      furnaceBlock = bot.findBlock({ matching: furnaceIds, maxDistance: 8 });
      if (furnaceBlock) break;
    }
  }
  if (!furnaceBlock) return { smelted: 0, error: "could not place furnace" };
}

try {
  await bot.pathfinder.goto(new GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2));
} catch (err) {
  bot.pathfinder.stop();
  return { smelted: 0, error: `can't reach furnace: ${err.message}` };
}

const furnace = await bot.openFurnace(furnaceBlock);
await furnace.putFuel(fuelItem.type, null, fuelNeeded);
await furnace.putInput(inputItem.type, null, count);
log(`Smelting ${count} ${inputName} with ${fuelNeeded} ${fuelItem.name}`);

const timeout = (count * 12 + 15) * 1000;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("smelting timed out")), timeout);
    const onAbort = () => { clearTimeout(timer); reject(new Error("aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
    const check = () => {
      const out = furnace.outputItem();
      if (out && out.count >= count) {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        furnace.removeListener("update", check);
        resolve();
      }
    };
    furnace.on("update", check);
    check();
  });
} catch (err) {
  const partial = furnace.outputItem();
  if (partial) await furnace.takeOutput();
  furnace.close();
  return { smelted: partial?.count || 0, item: output, error: err.message };
}

await furnace.takeOutput();
furnace.close();
log(`Produced ${count} ${output}`);
return { smelted: count, item: output };
