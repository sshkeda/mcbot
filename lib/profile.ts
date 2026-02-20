import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addMemory, readAllMemories } from "./memories";

export function runProfile(profilesDir: string, params: Record<string, string>): void {
  const name = params.name;
  if (!name) {
    console.error("usage: mcbot profile <name> [--init] [--memory TEXT]");
    process.exit(1);
  }
  const profileDir = join(profilesDir, name);
  const soulPath = join(profileDir, "SOUL.md");

  if (params.init === "true") {
    if (existsSync(profileDir)) {
      console.error(`profile already exists: ${profileDir}`);
      process.exit(1);
    }
    const templateDir = join(profilesDir, "_template");
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(join(profileDir, "memories"), { recursive: true });
    const soulTemplate = readFileSync(join(templateDir, "SOUL.md"), "utf-8");
    writeFileSync(join(profileDir, "SOUL.md"), soulTemplate.replace(/\{\{NAME\}\}/g, name));
    const todoTemplatePath = join(templateDir, "TODO.md");
    if (existsSync(todoTemplatePath)) {
      writeFileSync(join(profileDir, "TODO.md"), readFileSync(todoTemplatePath, "utf-8"));
    }
    console.log(`created profile: ${profileDir}`);
    process.exit(0);
  }

  if (params.memory) {
    if (!existsSync(profileDir)) {
      console.error(`no profile for "${name}". create one with: mcbot profile ${name} --init`);
      process.exit(1);
    }
    const total = addMemory(profileDir, params.memory);
    console.log(`added memory (${total} total)`);
    process.exit(0);
  }

  // Show profile
  if (!existsSync(profileDir)) {
    console.log(`no profile for "${name}". create one with: mcbot profile ${name} --init`);
    process.exit(0);
  }
  if (existsSync(soulPath)) {
    console.log(readFileSync(soulPath, "utf-8"));
  }
  const todoPath = join(profileDir, "TODO.md");
  if (existsSync(todoPath)) {
    console.log("--- todo ---");
    console.log(readFileSync(todoPath, "utf-8"));
  }
  const memories = readAllMemories(profileDir);
  if (memories) {
    console.log("--- memories ---");
    console.log(memories);
  }
  process.exit(0);
}
