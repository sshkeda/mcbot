import type { BotInstance } from "./_helpers";
import { pickBestRecipe } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot, mcData } = instance;
  const itemName = params.item;
  if (!itemName) return { error: "need item param" };
  const item = mcData.itemsByName[itemName];
  if (!item) return { error: `unknown item "${itemName}"` };
  const withoutTable = bot.recipesFor(item.id, null, 1, null);
  const table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 32 });
  const withTable = table ? bot.recipesFor(item.id, null, 1, table) : [];
  const recipes = withoutTable.length > 0 ? withoutTable : withTable;

  const allRecipes = mcData.recipes[item.id];

  if (recipes.length === 0) {
    if (allRecipes && allRecipes.length > 0) {
      const r = pickBestRecipe(allRecipes, mcData);
      const ingredients: Record<string, number> = {};
      const inputs = r.inShape ? r.inShape.flat() : r.ingredients || [];
      for (const ing of inputs) {
        if (!ing) continue;
        const id = typeof ing === "object" ? ing.id : ing;
        if (id < 0) continue;
        const ingName = mcData.items[id]?.name || `id:${id}`;
        ingredients[ingName] = (ingredients[ingName] || 0) + 1;
      }
      return {
        item: itemName,
        craftable: false,
        needsTable: !r.inShape || (r.inShape.length <= 2 && r.inShape[0]?.length <= 2) ? false : true,
        ingredients,
        reason: "missing ingredients or no crafting table",
      };
    }
    return { item: itemName, craftable: false, reason: "no recipe exists" };
  }

  const recipe = recipes[0];
  const ingredients: Record<string, number> = {};
  for (const row of recipe.delta) {
    if (row.count < 0) {
      const ingName = mcData.items[row.id]?.name || `id:${row.id}`;
      ingredients[ingName] = (ingredients[ingName] || 0) + Math.abs(row.count);
    }
  }
  return {
    item: itemName,
    craftable: true,
    needsTable: withoutTable.length === 0,
    ingredients,
  };
}
