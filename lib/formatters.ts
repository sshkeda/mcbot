export function formatOutput(command: string, data: any): void {
  if (command === "spawn") {
    if (data.status === "batch") {
      for (const s of data.spawned) console.log(`spawned ${s.name} at ${s.x} ${s.y} ${s.z}`);
      for (const e of data.errors) console.log(`failed ${e.name}: ${e.error}`);
      console.log(`${data.spawned.length}/${data.total} spawned`);
    } else {
      console.log(`spawned ${data.name} at ${data.x} ${data.y} ${data.z}`);
    }
    return;
  }
  if (command === "list") {
    if (data.bots.length === 0) {
      console.log("no bots spawned");
    } else {
      const now = Date.now();
      for (const b of data.bots) {
        if (b.status === "connecting") {
          console.log(`  ${b.name}  (connecting...)`);
        } else {
          let line = `  ${b.name}  pos: ${b.position.x} ${b.position.y} ${b.position.z}  hp: ${b.health}`;
          if (b.lock) line += `  \x1b[33m🔒 ${b.lock.agent || "locked"}\x1b[0m`;
          if (b.lastCommandAt) {
            const ago = Math.round((now - b.lastCommandAt) / 1000);
            if (ago < 30) line += `  \x1b[32m● active (${ago}s ago)\x1b[0m`;
          }
          console.log(line);
        }
      }
    }
    return;
  }
  if (command === "kill" || command === "killall") {
    console.log(data.status);
    return;
  }
  if (command === "ping") {
    const parts = [`server: ok  bots: [${data.bots.join(", ")}]`];
    if (data.connecting?.length > 0) parts.push(`connecting: [${data.connecting.join(", ")}]`);
    console.log(parts.join("  "));
    return;
  }
  if (command === "tools") {
    if (!Array.isArray(data.tools) || data.tools.length === 0) {
      console.log("no tools");
      return;
    }
    for (const t of data.tools) {
      console.log(`  ${t.tool}  (${t.scope})  -> ${t.command}`);
      console.log(`    ${t.usage}`);
    }
    return;
  }
  if (command === "tool") {
    if (!data.command || data.result === undefined) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(`[tool] ${data.tool} -> ${data.command}`);
    formatOutput(data.command, data.result);
    return;
  }
  if (command === "status") {
    const { position: p, health, food, time, biome } = data;
    console.log(`pos: ${p.x} ${p.y} ${p.z}  hp: ${health}  food: ${food}  ${time}  ${biome}`);
    return;
  }
  if (command === "inventory") {
    if (data.length === 0) {
      console.log("(empty)");
    } else {
      for (const i of data) console.log(`  ${i.name} x${i.count}`);
    }
    return;
  }
  if (command === "look") {
    console.log(`pos: ${data.position.x} ${data.position.y} ${data.position.z}`);
    if (data.lookingAt) console.log(`looking at: ${data.lookingAt}`);
    if (data.standingOn) console.log(`standing on: ${data.standingOn}`);
    if (data.nearby.length > 0) {
      console.log("nearby:");
      for (const e of data.nearby) console.log(`  ${e.name} (${e.type}) ${e.distance}m`);
    }
    return;
  }
  if (command === "block") {
    console.log(`${data.name} at ${data.position.x} ${data.position.y} ${data.position.z}`);
    console.log(`  hardness: ${data.hardness}  diggable: ${data.diggable}  bbox: ${data.boundingBox}`);
    if (data.metadata) console.log(`  metadata: ${data.metadata}`);
    return;
  }
  if (command === "recipes") {
    if (!data.craftable) {
      console.log(`${data.item}: not craftable (${data.reason})`);
      if (data.ingredients) {
        console.log(`  requires${data.needsTable ? " (crafting table)" : ""}:`);
        for (const [name, count] of Object.entries(data.ingredients)) console.log(`    ${name} x${count}`);
      }
    } else {
      console.log(`${data.item}: craftable${data.needsTable ? " (needs crafting table)" : ""}`);
      console.log("  ingredients:");
      for (const [name, count] of Object.entries(data.ingredients)) console.log(`    ${name} x${count}`);
    }
    return;
  }
  if (command === "execute") {
    console.log(`[${data.id}] ${data.name} — ${data.status}`);
    if (data.status === "done" && data.result !== undefined) console.log(`  result: ${JSON.stringify(data.result)}`);
    if (data.error) console.log(`  error: ${data.error}`);
    if (data.logs?.length) for (const l of data.logs) console.log(`  > ${l}`);
    return;
  }
  if (command === "queue") {
    if (data.status) { console.log(data.status); return; }
    const q = data.queue || [];
    if (q.length === 0) { console.log("(queue empty)"); return; }
    for (const a of q) {
      const dur = a.finishedAt && a.startedAt ? `${new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()}ms` : "";
      console.log(`  [${a.status.padEnd(9)}] ${a.name} ${dur}`);
      if (a.error) console.log(`           error: ${a.error}`);
    }
    if (data.current) console.log(`\ncurrent: ${data.current.name} (${data.current.id})`);
    return;
  }
  if (command === "state") {
    const p = data.position;
    const v = data.velocity;
    let line = `[${data.ts?.slice(11, 19)}] pos: ${p.x} ${p.y} ${p.z}  vel: ${v.x} ${v.y} ${v.z}  hp: ${data.health}  food: ${data.food}  ${data.time}  ${data.biome}`;
    if (data.isCollidedHorizontally) line += "  COLLIDED";
    if (!data.onGround) line += "  AIRBORNE";
    console.log(line);
    if (data.currentAction) {
      console.log(`  action: ${data.currentAction.name} (${data.currentAction.status})`);
    } else {
      console.log(`  action: idle`);
    }
    if (data.queueLength > 0) console.log(`  queue: ${data.queueLength} pending`);
    if (data.completed?.length > 0) {
      for (const a of data.completed) {
        const dur = a.startedAt && a.finishedAt ? `${new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()}ms` : "";
        const status = a.status === "done" ? "OK" : a.status.toUpperCase();
        console.log(`  finished: ${a.name} [${status}] ${dur}`);
        if (a.logs?.length) for (const l of a.logs) console.log(`    > ${l}`);
        if (a.error) console.log(`    ! ${a.error}`);
      }
    }
    if (data.inbox?.length > 0) {
      for (const m of data.inbox) console.log(`  chat: <${m.sender}> ${m.message}`);
    }
    if (data.directives?.length > 0) {
      for (const d of data.directives) console.log(`  directive: ${d.text}`);
    }
    return;
  }
  if (command === "skills") {
    const skills = data.skills || [];
    if (skills.length === 0) { console.log("(no skills)"); return; }
    for (const s of skills) console.log(`  ${s.name.padEnd(20)} ${s.description}`);
    return;
  }
  if (command === "load_skill") {
    console.log(`--- ${data.skill.name} ---`);
    if (data.skill.description) console.log(`# ${data.skill.description}`);
    console.log(data.code);
    return;
  }
  if (command === "save_skill") {
    console.log(`saved skill: ${data.name}`);
    return;
  }
  if (command === "locks") {
    const locks = data.locks || [];
    if (locks.length === 0) { console.log("(no locks)"); return; }
    for (const l of locks) {
      console.log(`  ${l.bot.padEnd(16)} pid:${l.pid} agent:${l.agent || "?"} goal:${l.goal || "-"} since:${l.lockedAt.slice(11, 19)}`);
    }
    return;
  }
  if (command === "lock") {
    console.log(`locked ${data.lock.bot} (pid:${data.lock.pid})`);
    return;
  }
  if (command === "unlock") {
    console.log(data.status);
    return;
  }
  if (command === "place") {
    if (data.placed) console.log(`placed ${data.block} at ${data.position.x} ${data.position.y} ${data.position.z}`);
    else console.log(`place failed: ${data.error}`);
    return;
  }
  if (command === "give") {
    console.log(data.status);
    if (data.items) for (const i of data.items) console.log(`  ${i.name} x${i.count}`);
    return;
  }
  if (command === "survey") {
    const { position: p, radius, blocks, entities } = data;
    console.log(`survey at ${p.x} ${p.y} ${p.z} (radius ${radius})`);
    console.log(`  logs: ${blocks.logs}  water: ${blocks.water}  lava: ${blocks.lava}`);
    if (Object.keys(blocks.ores).length > 0) {
      console.log("  ores:");
      for (const [name, count] of Object.entries(blocks.ores)) console.log(`    ${name}: ${count}`);
    }
    if (data.nearest) {
      const n = data.nearest;
      if (n.log) console.log(`  nearest log: ${n.log.x} ${n.log.y} ${n.log.z}`);
      if (n.water) console.log(`  nearest water: ${n.water.x} ${n.water.y} ${n.water.z}`);
      if (n.lava) console.log(`  nearest lava: ${n.lava.x} ${n.lava.y} ${n.lava.z}`);
      if (n.ores && Object.keys(n.ores).length > 0) {
        for (const [name, pos] of Object.entries(n.ores) as [string, any][]) {
          console.log(`  nearest ${name}: ${pos.x} ${pos.y} ${pos.z}`);
        }
      }
    }
    if (entities.players.length > 0) console.log(`  players: ${entities.players.join(", ")}`);
    console.log(`  hostiles: ${entities.hostiles}  animals: ${entities.animals}`);
    return;
  }
  if (command === "camera") {
    console.log(`camera ${data.name} placed at ${data.position.x} ${data.position.y} ${data.position.z}`);
    return;
  }
  if (command === "logs") {
    if (!data.entries || data.entries.length === 0) {
      console.log("no activity yet");
      if (data.file) console.log(`log file: ${data.file}`);
      return;
    }
    for (const e of data.entries) {
      const time = e.ts.slice(11, 19); // HH:MM:SS
      const dur = `${e.durationMs}ms`.padStart(7);
      const status = e.ok ? " " : "!";
      console.log(`${time} ${status} [${e.bot.padEnd(12)}] ${e.command.padEnd(12)} ${dur}  ${e.summary}`);
    }
    console.log(`\n${data.entries.length} entries (log file: ${data.file})`);
    return;
  }
  if (command === "inbox") {
    if (data.count === 0) {
      console.log("(no messages)");
    } else {
      for (const m of data.messages) {
        const time = m.ts.slice(11, 19);
        console.log(`${time} <${m.sender}> ${m.message}`);
      }
      console.log(`\n${data.count} message(s)`);
    }
    return;
  }
  if (command === "direct") {
    console.log(`directive posted (${data.pending} pending)`);
    return;
  }
  if (command === "directives") {
    if (data.count === 0) {
      console.log("(no directives)");
    } else {
      for (const d of data.directives) {
        const time = d.ts.slice(11, 19);
        console.log(`${time} ${d.text}`);
      }
      console.log(`\n${data.count} directive(s)`);
    }
    return;
  }
  if (command === "pov" || command === "render") {
    console.log(data.file);
    return;
  }
  const msg = data.status || data.message || JSON.stringify(data);
  console.log(msg);
}
