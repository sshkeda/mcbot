// Chunky renderer wrapper.
// Usage:
// node chunky-render.cjs <host> <port> <version> <x> <y> <z> <yaw> <pitch> <outfile>
//   [--camera x,y,z] [--lookAt x,y,z] [--fov N] [--world PATH] [--spp N]
//   [--width N] [--height N] [--inspect]
//
// host/port/version are accepted for command signature compatibility and are unused here.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [,, _host, _port, _version, x, y, z, yaw, pitch, outfile] = process.argv;
if (!outfile) {
  console.error("Usage: node chunky-render.cjs <host> <port> <version> <x> <y> <z> <yaw> <pitch> <outfile> [--camera x,y,z] [--lookAt x,y,z] [--fov N] [--world PATH] [--spp N] [--width N] [--height N] [--inspect]");
  process.exit(1);
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function parseVec3(value, flagName) {
  const parts = String(value).split(",").map((v) => Number(v.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`${flagName} expects x,y,z`);
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function parseNumber(value, flagName) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${flagName} expects a number`);
  return n;
}

function deriveLookAtFromYawPitch(cam, yawRad, pitchRad) {
  const distance = 16;
  const cosPitch = Math.cos(pitchRad);
  return {
    x: cam.x - Math.sin(yawRad) * cosPitch * distance,
    y: cam.y - Math.sin(pitchRad) * distance,
    z: cam.z - Math.cos(yawRad) * cosPitch * distance,
  };
}

// Chunky convention:
// yaw: 0 => +Z, PI/2 => -X
// pitch: 0 => down, -PI/2 => forward, -PI => up
function calcOrientation(cam, lookAt) {
  const dx = lookAt.x - cam.x;
  const dy = lookAt.y - cam.y;
  const dz = lookAt.z - cam.z;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1e-9;
  let yaw = Math.atan2(-dx, dz);
  if (yaw < 0) yaw += 2 * Math.PI;
  const pitch = -(Math.PI / 2) - Math.atan2(dy, dist);
  return { yaw, pitch, roll: 0 };
}

function buildChunkList(cam, lookAt) {
  const minX = Math.min(cam.x, lookAt.x);
  const maxX = Math.max(cam.x, lookAt.x);
  const minZ = Math.min(cam.z, lookAt.z);
  const maxZ = Math.max(cam.z, lookAt.z);
  const minChunkX = Math.floor(minX / 16) - 2;
  const maxChunkX = Math.floor(maxX / 16) + 2;
  const minChunkZ = Math.floor(minZ / 16) - 2;
  const maxChunkZ = Math.floor(maxZ / 16) + 2;
  const chunkList = [];
  for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
      chunkList.push([chunkX, chunkZ]);
    }
  }
  return chunkList;
}

function runChunky(javaBin, chunkyHome, launcherJar, args, label) {
  const child = spawnSync(
    javaBin,
    [`-Dchunky.home=${chunkyHome}`, "-jar", launcherJar, ...args],
    { encoding: "utf8" },
  );
  if (child.status !== 0) {
    const out = [child.stdout, child.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`chunky ${label} failed${out ? `:\n${out}` : ""}`);
  }
}

const extraArgs = process.argv.slice(11);
let cameraOverride = null;
let lookAtTarget = null;
let inspectMode = false;
let fov = null;
let worldPath = process.env.MC_WORLD_PATH || "";
let sppTarget = null;
let width = null;
let height = null;

try {
  for (let i = 0; i < extraArgs.length; i++) {
    const flag = extraArgs[i];
    if (flag === "--camera" && extraArgs[i + 1]) {
      cameraOverride = parseVec3(extraArgs[++i], "--camera");
      continue;
    }
    if (flag === "--lookAt" && extraArgs[i + 1]) {
      lookAtTarget = parseVec3(extraArgs[++i], "--lookAt");
      continue;
    }
    if (flag === "--fov" && extraArgs[i + 1]) {
      fov = parseNumber(extraArgs[++i], "--fov");
      continue;
    }
    if (flag === "--world" && extraArgs[i + 1]) {
      worldPath = extraArgs[++i];
      continue;
    }
    if (flag === "--spp" && extraArgs[i + 1]) {
      sppTarget = Math.max(1, Math.floor(parseNumber(extraArgs[++i], "--spp")));
      continue;
    }
    if (flag === "--width" && extraArgs[i + 1]) {
      width = Math.max(64, Math.floor(parseNumber(extraArgs[++i], "--width")));
      continue;
    }
    if (flag === "--height" && extraArgs[i + 1]) {
      height = Math.max(64, Math.floor(parseNumber(extraArgs[++i], "--height")));
      continue;
    }
    if (flag === "--inspect") {
      inspectMode = true;
      continue;
    }
    // Backward-compat with legacy caller args.
    if (flag === "--viewDistance" || flag === "--wait") {
      if (extraArgs[i + 1] && !extraArgs[i + 1].startsWith("--")) i++;
      continue;
    }
    throw new Error(`unknown arg: ${flag}`);
  }

  const baseCamera = { x: Number(x), y: Number(y), z: Number(z) };
  if ([baseCamera.x, baseCamera.y, baseCamera.z].some((n) => !Number.isFinite(n))) {
    throw new Error("camera position must be numeric");
  }
  const camera = cameraOverride || baseCamera;
  const fallbackLookAt = deriveLookAtFromYawPitch(camera, Number(yaw) || 0, Number(pitch) || 0);
  const lookAt = lookAtTarget || fallbackLookAt;
  const orientation = calcOrientation(camera, lookAt);
  const chunkList = buildChunkList(camera, lookAt);
  const renderWidth = width || (inspectMode ? 1280 : 960);
  const renderHeight = height || (inspectMode ? 720 : 540);
  const renderFov = fov ?? (inspectMode ? 55 : 70);
  const renderSppTarget = sppTarget ?? (inspectMode ? 48 : 32);
  const normalizedWorldPath = expandHome(worldPath);

  if (!normalizedWorldPath) {
    throw new Error("missing world path: pass --world PATH or set MC_WORLD_PATH");
  }
  if (!fs.existsSync(normalizedWorldPath)) {
    throw new Error(`world path does not exist: ${normalizedWorldPath}`);
  }

  const chunkyHome = expandHome(process.env.CHUNKY_HOME || path.join(os.homedir(), ".chunky"));
  fs.mkdirSync(chunkyHome, { recursive: true });

  const launcherJar = path.join(__dirname, "chunky", "ChunkyLauncher.jar");
  if (!fs.existsSync(launcherJar)) {
    throw new Error(`missing Chunky launcher: ${launcherJar} (run chunky/setup.sh first)`);
  }

  const javaBin = expandHome(
    process.env.MC_JAVA_BIN
      || "/Users/sshkeda/Library/Application Support/minecraft/runtime/java-runtime-delta/mac-os-arm64/java-runtime-delta/jre.bundle/Contents/Home/bin/java",
  );
  const javaCmd = (javaBin && fs.existsSync(javaBin)) ? javaBin : "java";
  const threads = Math.max(1, Math.floor(Number(process.env.CHUNKY_THREADS) || 8));

  const sceneName = `mcbot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sceneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcbot-chunky-scenes-"));
  const sceneFile = path.join(sceneRoot, `${sceneName}.json`);

  const scene = {
    name: sceneName,
    sdfVersion: 9,
    width: renderWidth,
    height: renderHeight,
    spp: 0,
    sppTarget: renderSppTarget,
    rayDepth: inspectMode ? 8 : 5,
    pathTrace: true,
    emittersEnabled: false,
    sunEnabled: true,
    renderActors: false,
    fogDensity: 0,
    skyFogDensity: inspectMode ? 0 : 1,
    fastFog: !inspectMode,
    saveSnapshots: true,
    world: {
      path: normalizedWorldPath,
      dimension: 0,
    },
    camera: {
      projectionMode: "PINHOLE",
      fov: renderFov,
      position: camera,
      orientation,
    },
    chunkList,
  };
  fs.writeFileSync(sceneFile, JSON.stringify(scene, null, 2), "utf8");

  try {
    runChunky(
      javaCmd,
      chunkyHome,
      launcherJar,
      [
        "-scene-dir", sceneRoot,
        "-render", sceneName,
        "-target", String(renderSppTarget),
        "-threads", String(threads),
        "-f",
      ],
      "render",
    );

    const snapshotsDir = path.join(sceneRoot, "snapshots");
    const snapshotFiles = fs.existsSync(snapshotsDir)
      ? fs.readdirSync(snapshotsDir)
        .filter((name) => name.startsWith(`${sceneName}-`) && name.endsWith(".png"))
        .map((name) => path.join(snapshotsDir, name))
      : [];
    if (snapshotFiles.length === 0) {
      throw new Error("no snapshot generated by Chunky render");
    }
    snapshotFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.copyFileSync(snapshotFiles[0], outfile);
  } finally {
    fs.rmSync(sceneRoot, { recursive: true, force: true });
  }

  console.log(outfile);
} catch (err) {
  console.error(`[chunky-render] ${(err && err.message) || err}`);
  process.exit(1);
}
