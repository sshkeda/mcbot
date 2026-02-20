/**
 * @skill goto
 * @description Navigate to x y z coordinates using pathfinder
 * @tags navigation, movement
 */

// Navigate to coordinates using the shared navigation engine.
// Context: goto, log
// Params: X (number), Y (number), Z (number), RANGE (number, default 2)

const x = typeof X !== 'undefined' ? X : 0;
const y = typeof Y !== 'undefined' ? Y : 0;
const z = typeof Z !== 'undefined' ? Z : 0;
const range = typeof RANGE !== 'undefined' ? RANGE : 2;

log(`Navigating to ${x}, ${y}, ${z} (range ${range})`);

const result = await goto(x, y, z, { range });
return result;
