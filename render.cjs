// Headless Minecraft renderer - runs under Node (not Bun) because gl requires V8
// Usage: node render.cjs <host> <port> <version> <x> <y> <z> <yaw> <pitch> <outfile>
const mineflayer = require("mineflayer");
const THREE = require("three");
const { createCanvas } = require("node-canvas-webgl/lib");
const { Viewer, WorldView, getBufferFromStream } = require("prismarine-viewer").viewer;
const fs = require("fs");
const { Worker } = require("worker_threads");
global.Worker = Worker;

const [,, host, port, version, x, y, z, yaw, pitch, outfile] = process.argv;
const width = 512, height = 512, viewDistance = 4;

const bot = mineflayer.createBot({
  host: host || "localhost",
  port: Number(port) || 25565,
  username: `Cam_${Date.now() % 10000}`,
  version: version || "1.21.4",
});

bot.once("spawn", async () => {
  // Teleport to target position
  bot.chat(`/tp ${bot.username} ${x} ${y} ${z}`);

  // Wait for chunks — tolerate timeout
  try { await bot.waitForChunksToLoad(); } catch {}
  await new Promise(r => setTimeout(r, 2000));

  const pos = bot.entity.position;

  const canvas = createCanvas(width, height);
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(width, height);

  const viewer = new Viewer(renderer);
  await viewer.setVersion(bot.version);

  const worldView = new WorldView(bot.world, viewDistance, pos);
  viewer.listen(worldView);
  await worldView.init(pos);

  // Wait for viewer to mesh chunks
  await new Promise(r => setTimeout(r, 5000));

  // Set camera directly (bypass TWEEN animation)
  viewer.camera.position.set(pos.x, pos.y + 1.62, pos.z);
  viewer.camera.rotation.set(Number(pitch) || 0, Number(yaw) || 0, 0, "ZYX");

  viewer.update();
  renderer.render(viewer.scene, viewer.camera);

  const stream = canvas.createPNGStream();
  const buffer = await getBufferFromStream(stream);
  const out = outfile || "/tmp/mcbot-render.png";
  fs.writeFileSync(out, buffer);

  console.log(out);
  bot.quit();
  process.exit(0);
});

bot.on("error", (err) => {
  console.error("[render] error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("[render] timed out");
  try { bot.quit(); } catch {}
  process.exit(1);
}, 50000);
