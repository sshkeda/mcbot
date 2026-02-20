// Navigate to coordinates.
// Context: bot, Vec3, GoalNear, sleep, signal, log
// Params: X (number), Y (number), Z (number), RANGE (number, default 2)

const x = typeof X !== 'undefined' ? X : 0;
const y = typeof Y !== 'undefined' ? Y : 0;
const z = typeof Z !== 'undefined' ? Z : 0;
const range = typeof RANGE !== 'undefined' ? RANGE : 2;

log(`Navigating to ${x}, ${y}, ${z} (range ${range})`);

try {
  await bot.pathfinder.goto(new GoalNear(x, y, z, range));
} catch (err) {
  bot.pathfinder.stop();
  const pos = bot.entity.position;
  return { arrived: false, error: err.message, position: { x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1) } };
}

const pos = bot.entity.position;
log(`Arrived at ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`);
return { arrived: true, position: { x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1) } };
