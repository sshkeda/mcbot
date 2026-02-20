/**
 * Skill storage — load, save, list code snippets from the skills/ directory.
 * Each skill is a .ts file with a JSDoc metadata header (@skill, @description, @tags).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dirname, "..", "skills");

export interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
}

function ensureDir() {
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
}

const HEADER_RE = /^\/\*\*[\s\S]*?\*\//;
const tagRe = (tag: string) => new RegExp(`@${tag}\\s+(.+)`, "i");

function parseHeader(content: string): { meta: SkillMeta; code: string } {
  const match = content.match(HEADER_RE);
  if (!match) {
    return { meta: { name: "", description: "", tags: [] }, code: content };
  }
  const header = match[0];
  const nameMatch = header.match(tagRe("skill"));
  const descMatch = header.match(tagRe("description"));
  const tagsMatch = header.match(tagRe("tags"));

  const meta: SkillMeta = {
    name: nameMatch?.[1]?.trim() || "",
    description: descMatch?.[1]?.trim() || "",
    tags: tagsMatch
      ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
      : [],
  };

  const code = content.slice(match[0].length).replace(/^\n+/, "");
  return { meta, code };
}

function buildHeader(meta: SkillMeta): string {
  const lines = [
    "/**",
    ` * @skill ${meta.name}`,
    ` * @description ${meta.description}`,
  ];
  if (meta.tags.length > 0) {
    lines.push(` * @tags ${meta.tags.join(", ")}`);
  }
  lines.push(" */");
  return lines.join("\n");
}

export function listSkills(): { name: string; description: string; tags: string[] }[] {
  ensureDir();
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".ts"));
  return files.map((f) => {
    const name = f.replace(/\.ts$/, "");
    const content = readFileSync(join(SKILLS_DIR, f), "utf-8");
    const { meta } = parseHeader(content);
    return { name: meta.name || name, description: meta.description, tags: meta.tags };
  });
}

export function loadSkill(name: string): { code: string; meta: SkillMeta } | null {
  ensureDir();
  const tsPath = join(SKILLS_DIR, `${name}.ts`);
  if (!existsSync(tsPath)) return null;
  const content = readFileSync(tsPath, "utf-8");
  const { meta, code } = parseHeader(content);
  meta.name = meta.name || name;
  return { code, meta };
}

export function saveSkill(
  name: string,
  code: string,
  meta: Partial<SkillMeta>,
): void {
  ensureDir();
  const fullMeta: SkillMeta = {
    name,
    description: meta.description || "",
    tags: meta.tags || [],
  };

  // Preserve existing metadata fields not being overwritten
  const tsPath = join(SKILLS_DIR, `${name}.ts`);
  if (existsSync(tsPath)) {
    const existing = parseHeader(readFileSync(tsPath, "utf-8"));
    if (!meta.description && existing.meta.description) fullMeta.description = existing.meta.description;
    if (!meta.tags && existing.meta.tags.length > 0) fullMeta.tags = existing.meta.tags;
  }

  // Strip any existing header from the code to prevent duplication
  const strippedCode = code.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();

  const header = buildHeader(fullMeta);
  writeFileSync(tsPath, header + "\n\n" + strippedCode + "\n");
}
