import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export async function craftItem(bot: any, pathfinder: any, itemName: string, count = 1) {
  const { GoalNear } = pathfinder.goals;
  const mcData = require("minecraft-data")(bot.version);
  const Vec3 = require("vec3").Vec3;

  const item = mcData.itemsByName[itemName];
  if (!item) {
    console.log(`[CRAFT] Unknown item "${itemName}"`);
    return { crafted: 0, item: itemName, error: `unknown item "${itemName}"` };
  }

  // Check recipes without a table first
  let recipes = bot.recipesFor(item.id, null, 1, null);
  let table: any = null;

  if (recipes.length === 0) {
    // Need a crafting table — find one nearby or place from inventory
    table = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 32,
    });

    if (!table) {
      const tableItem = bot.inventory.items().find((i: any) => i.name === "crafting_table");
      if (!tableItem) {
        console.log("[CRAFT] No crafting table available");
        return { crafted: 0, item: itemName, error: "no crafting table nearby or in inventory" };
      }

      // Try multiple offsets around the bot to find a valid placement spot
      const offsets = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
        [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2],
      ];
      for (const [dx, _, dz] of offsets) {
        const floorPos = bot.entity.position.offset(dx, -1, dz).floored();
        const abovePos = floorPos.offset(0, 1, 0);
        const floor = bot.blockAt(floorPos);
        const above = bot.blockAt(abovePos);
        if (floor && floor.boundingBox === "block" && above && above.name === "air") {
          try {
            await bot.equip(tableItem, "hand");
            await bot.placeBlock(floor, new Vec3(0, 1, 0));
            console.log(`[CRAFT] Placed crafting table at ${abovePos}`);
          } catch (err: any) {
            console.log(`[CRAFT] Table placement failed at ${abovePos}: ${err.message}`);
            continue;
          }
          table = bot.findBlock({
            matching: mcData.blocksByName.crafting_table.id,
            maxDistance: 8,
          });
          if (table) break;
        }
      }
    }

    if (!table) {
      console.log("[CRAFT] Could not place crafting table");
      return { crafted: 0, item: itemName, error: "could not place crafting table" };
    }

    try {
      await bot.pathfinder.goto(new GoalNear(table.position.x, table.position.y, table.position.z, 3));
    } catch (err: any) {
      console.log(`[CRAFT] Can't reach crafting table: ${err.message}`);
      return { crafted: 0, item: itemName, error: "can't reach crafting table" };
    }
    recipes = bot.recipesFor(item.id, null, 1, table);
  }

  if (recipes.length === 0) {
    console.log(`[CRAFT] No recipe for "${itemName}" with current inventory`);
    return { crafted: 0, item: itemName, error: "missing ingredients" };
  }

  try {
    await bot.craft(recipes[0], count, table);
  } catch (err: any) {
    console.log(`[CRAFT] Failed: ${err.message}`);
    return { crafted: 0, item: itemName, error: err.message };
  }
  console.log(`[CRAFT] Crafted ${itemName} x${count}`);
  return { crafted: count, item: itemName };
}
