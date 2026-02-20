// Craft an item. Auto-places crafting table if needed.
// Context: bot, mcData, Vec3, GoalNear, sleep, signal, log
// Params: ITEM_NAME (string), COUNT (number, default 1)

const itemName = typeof ITEM_NAME !== 'undefined' ? ITEM_NAME : '';
const count = typeof COUNT !== 'undefined' ? COUNT : 1;

if (!itemName) return { crafted: 0, error: "no item name specified" };

const item = mcData.itemsByName[itemName];
if (!item) return { crafted: 0, item: itemName, error: `unknown item "${itemName}"` };

// Check recipes without table first
let recipes = bot.recipesFor(item.id, null, 1, null);
let table = null;

if (recipes.length === 0) {
  table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 32 });

  if (!table) {
    const tableItem = bot.inventory.items().find(i => i.name === "crafting_table");
    if (!tableItem) return { crafted: 0, item: itemName, error: "no crafting table nearby or in inventory" };

    const offsets = [
      [1,0,0],[-1,0,0],[0,0,1],[0,0,-1],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [2,0,0],[-2,0,0],[0,0,2],[0,0,-2],
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
          log(`Placed crafting table at ${abovePos}`);
        } catch (err) {
          log(`Table placement failed: ${err.message}`);
          continue;
        }
        table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 8 });
        if (table) break;
      }
    }
  }

  if (!table) return { crafted: 0, item: itemName, error: "could not place crafting table" };

  try {
    await bot.pathfinder.goto(new GoalNear(table.position.x, table.position.y, table.position.z, 3));
  } catch (err) {
    return { crafted: 0, item: itemName, error: `can't reach crafting table: ${err.message}` };
  }
  recipes = bot.recipesFor(item.id, null, 1, table);
}

if (recipes.length === 0) return { crafted: 0, item: itemName, error: "missing ingredients" };

try {
  await bot.craft(recipes[0], count, table);
} catch (err) {
  return { crafted: 0, item: itemName, error: err.message };
}

log(`Crafted ${itemName} x${count}`);
return { crafted: count, item: itemName };
