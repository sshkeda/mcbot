import type { BotInstance } from "./_helpers";
import { Vec3, posOf } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const requestedSize = Number(params.size || params.radius) || 16;
  return buildTokenContext(bot, requestedSize);
}

function buildTokenContext(bot: any, requestedSize: number) {
  const p = bot.entity.position;
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  const cz = Math.floor(p.z);

  const size = Math.max(8, Math.min(48, Math.floor(requestedSize)));
  const half = Math.floor(size / 2);
  const topY = Math.min(cy + 20, 319);
  const bottomY = Math.max(cy - 20, -64);
  const entities = Object.values(bot.entities) as any[];

  const heightMap = new Map<string, { y: number; name: string }>();
  for (let dz = -half; dz < size - half; dz++) {
    for (let dx = -half; dx < size - half; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      for (let y = topY; y >= bottomY; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.name !== "air" && block.name !== "cave_air") {
          heightMap.set(`${dx},${dz}`, { y, name: block.name });
          break;
        }
      }
    }
  }

  const charFor = (name: string): string => {
    if (name.includes("log")) return "T";
    if (name.includes("leaves")) return "^";
    if (name === "water" || name === "flowing_water") return "~";
    if (name === "lava" || name === "flowing_lava") return "!";
    if (name.includes("diamond")) return "D";
    if (name.includes("iron_ore")) return "I";
    if (name.includes("gold_ore")) return "G";
    if (name.includes("coal_ore")) return "C";
    if (name.includes("copper_ore")) return "c";
    if (name.includes("ore")) return "o";
    if (name === "grass_block") return ".";
    if (name === "dirt" || name === "podzol" || name === "mycelium" || name === "farmland") return ",";
    if (name === "sand" || name === "red_sand") return ":";
    if (name === "stone") return "#";
    if (name === "cobblestone" || name === "mossy_cobblestone") return "%";
    if (name === "deepslate") return "d";
    if (name === "gravel") return ";";
    if (name === "bedrock") return "=";
    if (name.includes("plank") || name.includes("fence") || name.includes("slab") || name.includes("stair")) return "W";
    if (name.includes("door") || name.includes("gate")) return "+";
    if (name.includes("glass")) return "O";
    if (name.includes("chest")) return "$";
    if (name.includes("furnace") || name.includes("blast") || name.includes("smoker")) return "F";
    if (name.includes("crafting")) return "X";
    if (name.includes("torch")) return "i";
    if (name.includes("flower") || name.includes("poppy") || name.includes("dandelion") || name.includes("tulip")) return "f";
    if (name === "tall_grass" || name === "short_grass" || name === "fern" || name === "large_fern") return "'";
    if (name.includes("snow")) return "s";
    if (name.includes("ice")) return "~";
    if (name.includes("wool") || name.includes("carpet")) return "w";
    if (name === "air" || name === "cave_air") return " ";
    return "-";
  };

  const entityLabels: string[] = [];
  const entityPositions = new Map<string, { label: string; type: string }>();
  for (const e of entities) {
    if (e === bot.entity) continue;
    const ex = Math.floor(e.position.x) - cx;
    const ez = Math.floor(e.position.z) - cz;
    if (Math.abs(ex) > half || Math.abs(ez) > half) continue;
    const key = `${ex},${ez}`;
    const name = e.username || e.name || e.type;
    const dist = e.position.distanceTo(p).toFixed(0);
    let marker: string;
    if (e.type === "player") { marker = "P"; }
    else if (e.type === "hostile") { marker = "M"; }
    else if (e.type === "animal") { marker = "A"; }
    else { marker = "@"; }
    entityPositions.set(key, { label: marker, type: e.type });
    entityLabels.push(`${marker}=${name}(${dist}m)`);
  }

  const rows: string[] = [];

  rows.push(`--- ${cx}, ${cy}, ${cz} | r=${size} | N=\u2191(z-) ---`);

  let xRuler = "     ";
  for (let dx = -half; dx < size - half; dx++) {
    xRuler += (dx % 5 === 0) ? "|" : " ";
  }
  rows.push(xRuler);

  let xLabels = "   ";
  for (let dx = -half; dx < size - half; dx++) {
    if (dx % 10 === 0) {
      const label = String(cx + dx);
      xLabels += label;
      dx += label.length - 1;
    } else {
      xLabels += " ";
    }
  }
  rows.push(xLabels);

  for (let dz = -half; dz < size - half; dz++) {
    const zLabel = (dz % 5 === 0) ? String(cz + dz).padStart(4, " ") + "|" : "    |";

    let row = "";
    for (let dx = -half; dx < size - half; dx++) {
      if (dx === 0 && dz === 0) {
        row += "@";
        continue;
      }

      const key = `${dx},${dz}`;
      const ent = entityPositions.get(key);
      if (ent) {
        row += ent.label;
        continue;
      }

      const surface = heightMap.get(key);
      if (!surface) {
        row += " ";
        continue;
      }
      row += charFor(surface.name);
    }
    rows.push(zLabel + row);
  }

  if (entityLabels.length > 0) {
    rows.push("");
    rows.push("entities: " + entityLabels.join("  "));
  }

  const heights: number[] = [];
  for (const [, v] of heightMap) heights.push(v.y);
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);

  rows.push("");
  rows.push(`terrain: y=${minH}..${maxH} (bot at y=${cy}) | blocks: T=log ^=leaves ~=water !=lava`);
  rows.push(`  .=grass ,=dirt #=stone %=cobble D=diamond I=iron C=coal W=wood +=door $=chest`);

  return {
    mode: "text-context",
    center: { x: cx, y: cy, z: cz },
    size,
    context: rows.join("\n"),
  };
}
