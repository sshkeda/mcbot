import type { BotInstance } from "./_helpers";
import { Vec3 } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const radius = Number(params.radius) || 32;
  const p = bot.entity.position;
  const cx = Math.floor(p.x);
  const cz = Math.floor(p.z);

  const charFor = (name: string) => {
    if (name.includes("log")) return "T";
    if (name.includes("leaves")) return "*";
    if (name === "water" || name === "flowing_water") return "~";
    if (name === "lava" || name === "flowing_lava") return "!";
    if (name.includes("ore")) return "o";
    if (name === "grass_block" || name === "dirt" || name === "podzol" || name === "mycelium") return ".";
    if (name === "sand" || name === "red_sand") return ":";
    if (name === "stone" || name === "deepslate" || name === "cobblestone") return "#";
    if (name === "gravel") return "%";
    if (name.includes("plank") || name.includes("fence") || name.includes("door")) return "=";
    if (name === "air" || name === "cave_air") return " ";
    return "-";
  };

  const rows: string[] = [];
  const entities = Object.values(bot.entities) as any[];

  rows.push(`MAP (${cx}, ${cz}) radius=${radius}  N=up`);
  rows.push(`Legend: T=tree *=leaves ~=water !=lava o=ore .=grass #=stone @=entity B=BOT`);
  rows.push("");

  for (let dz = -radius; dz <= radius; dz += 2) {
    let row = "";
    for (let dx = -radius; dx <= radius; dx += 2) {
      const x = cx + dx;
      const z = cz + dz;

      const entityHere = entities.find((e: any) =>
        e !== bot.entity &&
        Math.abs(Math.floor(e.position.x) - x) < 2 &&
        Math.abs(Math.floor(e.position.z) - z) < 2
      );
      if (dx === 0 && dz === 0) {
        row += "B";
        continue;
      }
      if (entityHere) {
        row += "@";
        continue;
      }

      let ch = " ";
      for (let y = Math.min(Math.floor(p.y) + 20, 319); y >= Math.max(Math.floor(p.y) - 20, -64); y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.name !== "air" && block.name !== "cave_air") {
          ch = charFor(block.name);
          break;
        }
      }
      row += ch;
    }
    rows.push(row);
  }

  return { map: rows.join("\n") };
}
