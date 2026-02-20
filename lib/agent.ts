import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addMemory, readAllMemories } from "./memories";

export function runAgent(agentsDir: string, params: Record<string, string>): void {
  const name = params.name;
  if (!name) {
    console.error("usage: mcbot profile <name> [--init] [--memory TEXT]");
    process.exit(1);
  }
  const agentDir = join(agentsDir, name);
  const soulPath = join(agentDir, "SOUL.md");

  if (params.init === "true") {
    if (existsSync(agentDir)) {
      console.error(`agent already exists: ${agentDir}`);
      process.exit(1);
    }
    const templateDir = join(agentsDir, "_template");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(agentDir, "memories"), { recursive: true });
    const soulTemplate = readFileSync(join(templateDir, "SOUL.md"), "utf-8");
    writeFileSync(join(agentDir, "SOUL.md"), soulTemplate.replace(/\{\{NAME\}\}/g, name));
    const todoTemplatePath = join(templateDir, "TODO.md");
    if (existsSync(todoTemplatePath)) {
      writeFileSync(join(agentDir, "TODO.md"), readFileSync(todoTemplatePath, "utf-8"));
    }
    const configTemplatePath = join(templateDir, "agent.config.ts");
    if (existsSync(configTemplatePath)) {
      writeFileSync(join(agentDir, "agent.config.ts"), readFileSync(configTemplatePath, "utf-8"));
    }
    console.log(`created agent: ${agentDir}`);
    process.exit(0);
  }

  if (params.memory) {
    if (!existsSync(agentDir)) {
      console.error(`no agent for "${name}". create one with: mcbot profile ${name} --init`);
      process.exit(1);
    }
    const total = addMemory(agentDir, params.memory);
    console.log(`added memory (${total} total)`);
    process.exit(0);
  }

  // Show agent
  if (!existsSync(agentDir)) {
    console.log(`no agent for "${name}". create one with: mcbot profile ${name} --init`);
    process.exit(0);
  }
  if (existsSync(soulPath)) {
    console.log(readFileSync(soulPath, "utf-8"));
  }
  const todoPath = join(agentDir, "TODO.md");
  if (existsSync(todoPath)) {
    console.log("--- todo ---");
    console.log(readFileSync(todoPath, "utf-8"));
  }
  const memories = readAllMemories(agentDir);
  if (memories) {
    console.log("--- memories ---");
    console.log(memories);
  }
  process.exit(0);
}
