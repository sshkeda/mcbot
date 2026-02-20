import type { BotInstance } from "./_helpers";
import { Vec3, sharp } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const width = Number(params.width) || 160;
  const height = Number(params.height) || 90;
  const fov = Number(params.fov) || 80;
  const maxDist = Number(params.distance) || 64;
  const scale = Number(params.scale) || 4;
  const p = bot.entity.position.offset(0, 1.62, 0);
  const yaw = bot.entity.yaw;
  const pitch = bot.entity.pitch;

  const fovRad = (fov * Math.PI) / 180;
  const aspectRatio = width / height;
  const imgW = width * scale;
  const imgH = height * scale;
  const pixels = Buffer.alloc(imgW * imgH * 3);

  const skyTop: [number, number, number] = [100, 160, 235];
  const skyBottom: [number, number, number] = [170, 210, 250];

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const ndcX = (px / width) * 2 - 1;
      const ndcY = (py / height) * 2 - 1;

      const rayYaw = yaw - ndcX * (fovRad / 2) * aspectRatio;
      const rayPitch = pitch + ndcY * (fovRad / 2);

      const dx = -Math.sin(rayYaw) * Math.cos(rayPitch);
      const dy = -Math.sin(rayPitch);
      const dz = -Math.cos(rayYaw) * Math.cos(rayPitch);

      const skyT = Math.max(0, Math.min(1, (ndcY + 1) / 2));
      let color: [number, number, number] = [
        lerp(skyTop[0], skyBottom[0], skyT),
        lerp(skyTop[1], skyBottom[1], skyT),
        lerp(skyTop[2], skyBottom[2], skyT),
      ];

      const step = 0.3;
      let prevBx = -999, prevBy = -999, prevBz = -999;
      for (let t = 0.5; t < maxDist; t += step) {
        const bx = Math.floor(p.x + dx * t);
        const by = Math.floor(p.y + dy * t);
        const bz = Math.floor(p.z + dz * t);

        if (bx === prevBx && by === prevBy && bz === prevBz) continue;
        prevBx = bx; prevBy = by; prevBz = bz;

        const block = bot.blockAt(new Vec3(bx, by, bz));
        if (block && block.name !== "air" && block.name !== "cave_air") {
          const base = colorFor(block.name);

          const hitX = p.x + dx * t - bx;
          const hitY = p.y + dy * t - by;
          const hitZ = p.z + dz * t - bz;

          let faceBright = 0.8;
          const eps = 0.05;
          if (hitY > 1 - eps && dy < 0) faceBright = 1.0;
          else if (hitY < eps && dy > 0) faceBright = 0.5;
          else if (hitX < eps || hitX > 1 - eps) faceBright = 0.7;
          else if (hitZ < eps || hitZ > 1 - eps) faceBright = 0.85;

          const fogAmount = Math.pow(t / maxDist, 1.5);
          const fogColor = color;

          const r = base[0] * faceBright;
          const g = base[1] * faceBright;
          const b2 = base[2] * faceBright;

          color = [
            lerp(r, fogColor[0], fogAmount),
            lerp(g, fogColor[1], fogAmount),
            lerp(b2, fogColor[2], fogAmount),
          ];
          break;
        }
      }

      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const offset = ((py * scale + sy) * imgW + (px * scale + sx)) * 3;
          pixels[offset] = Math.floor(color[0]);
          pixels[offset + 1] = Math.floor(color[1]);
          pixels[offset + 2] = Math.floor(color[2]);
        }
      }
    }
  }

  const file = `/tmp/mcbot-${instance.name}-pov-${Date.now()}.png`;
  await sharp(pixels, { raw: { width: imgW, height: imgH, channels: 3 } })
    .png()
    .toFile(file);

  return { file };
}

function colorFor(name: string): [number, number, number] {
  if (name.includes("oak_log")) return [109, 85, 50];
  if (name.includes("birch_log")) return [216, 206, 189];
  if (name.includes("spruce_log")) return [58, 37, 16];
  if (name.includes("jungle_log")) return [149, 109, 52];
  if (name.includes("dark_oak_log")) return [60, 46, 26];
  if (name.includes("acacia_log")) return [103, 96, 86];
  if (name.includes("log")) return [109, 85, 50];
  if (name.includes("oak_leaves")) return [59, 122, 24];
  if (name.includes("birch_leaves")) return [80, 140, 47];
  if (name.includes("spruce_leaves")) return [37, 72, 37];
  if (name.includes("jungle_leaves")) return [42, 132, 12];
  if (name.includes("dark_oak_leaves")) return [30, 90, 15];
  if (name.includes("azalea_leaves")) return [72, 130, 35];
  if (name.includes("leaves")) return [55, 120, 30];
  if (name === "water" || name === "flowing_water") return [44, 100, 201];
  if (name === "lava" || name === "flowing_lava") return [207, 92, 15];
  if (name === "grass_block") return [106, 170, 64];
  if (name === "dirt" || name === "coarse_dirt") return [134, 96, 67];
  if (name === "podzol") return [91, 63, 24];
  if (name === "mycelium") return [111, 99, 107];
  if (name === "sand") return [219, 207, 163];
  if (name === "red_sand") return [190, 102, 33];
  if (name === "stone") return [125, 125, 125];
  if (name === "cobblestone") return [118, 118, 118];
  if (name === "mossy_cobblestone") return [100, 118, 95];
  if (name === "deepslate") return [80, 80, 85];
  if (name === "granite") return [149, 103, 85];
  if (name === "diorite") return [188, 182, 183];
  if (name === "andesite") return [136, 136, 136];
  if (name === "coal_ore") return [105, 105, 105];
  if (name === "iron_ore") return [136, 120, 108];
  if (name === "gold_ore") return [143, 140, 92];
  if (name === "diamond_ore") return [93, 213, 209];
  if (name === "copper_ore") return [124, 125, 100];
  if (name === "lapis_ore") return [60, 80, 165];
  if (name.includes("ore")) return [140, 130, 100];
  if (name === "gravel") return [131, 127, 126];
  if (name === "snow" || name === "snow_block") return [249, 254, 254];
  if (name === "ice" || name === "packed_ice") return [145, 183, 253];
  if (name.includes("plank")) return [162, 130, 78];
  if (name.includes("glass")) return [200, 220, 230];
  if (name.includes("wool")) return [234, 234, 234];
  if (name === "clay") return [159, 164, 177];
  if (name === "bedrock") return [85, 85, 85];
  if (name.includes("flower") || name.includes("poppy") || name.includes("dandelion")) return [200, 50, 50];
  if (name === "tall_grass" || name === "grass" || name === "fern") return [90, 155, 50];
  return [120, 110, 100];
}
