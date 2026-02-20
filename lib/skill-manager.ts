/**
 * Skill storage — load, save, list JS code snippets from the skills/ directory.
 * Each skill is a .js file with a .meta.json sidecar for metadata.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dirname, "..", "skills");

export interface SkillMeta {
  name: string;
  description: string;
  lastUsed: string;
  successCount: number;
  failCount: number;
  tags: string[];
}

function ensureDir() {
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
}

export function listSkills(): { name: string; description: string; tags: string[] }[] {
  ensureDir();
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".js"));
  return files.map((f) => {
    const name = f.replace(/\.js$/, "");
    const metaPath = join(SKILLS_DIR, `${name}.meta.json`);
    let description = "";
    let tags: string[] = [];
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        description = meta.description || "";
        tags = meta.tags || [];
      } catch {}
    }
    return { name, description, tags };
  });
}

export function loadSkill(name: string): { code: string; meta: SkillMeta } | null {
  ensureDir();
  const codePath = join(SKILLS_DIR, `${name}.js`);
  if (!existsSync(codePath)) return null;
  const code = readFileSync(codePath, "utf-8");
  const metaPath = join(SKILLS_DIR, `${name}.meta.json`);
  let meta: SkillMeta = {
    name,
    description: "",
    lastUsed: "",
    successCount: 0,
    failCount: 0,
    tags: [],
  };
  if (existsSync(metaPath)) {
    try {
      meta = { ...meta, ...JSON.parse(readFileSync(metaPath, "utf-8")) };
    } catch {}
  }
  return { code, meta };
}

export function saveSkill(
  name: string,
  code: string,
  meta: Partial<SkillMeta>,
): void {
  ensureDir();
  writeFileSync(join(SKILLS_DIR, `${name}.js`), code);
  const metaPath = join(SKILLS_DIR, `${name}.meta.json`);
  let existing: SkillMeta = {
    name,
    description: "",
    lastUsed: "",
    successCount: 0,
    failCount: 0,
    tags: [],
  };
  if (existsSync(metaPath)) {
    try {
      existing = { ...existing, ...JSON.parse(readFileSync(metaPath, "utf-8")) };
    } catch {}
  }
  const merged = { ...existing, ...meta, name };
  writeFileSync(metaPath, JSON.stringify(merged, null, 2) + "\n");
}

export function updateSkillStats(name: string, success: boolean): void {
  const metaPath = join(SKILLS_DIR, `${name}.meta.json`);
  if (!existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (success) meta.successCount = (meta.successCount || 0) + 1;
    else meta.failCount = (meta.failCount || 0) + 1;
    meta.lastUsed = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  } catch {}
}
