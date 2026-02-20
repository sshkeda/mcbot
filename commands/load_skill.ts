import type { BotInstance } from "./_helpers";
import { loadSkill } from "./_helpers";

export default async function (_instance: BotInstance, params: any) {
  const name = params.name;
  if (!name) return { error: "need name param" };
  const skill = loadSkill(name);
  if (!skill) return { error: `skill "${name}" not found` };
  return { skill: skill.meta, code: skill.code };
}
