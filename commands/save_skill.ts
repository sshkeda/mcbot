import type { BotInstance } from "./_helpers";
import { saveSkill } from "./_helpers";

export default async function (_instance: BotInstance, params: any) {
  const name = params.name;
  const code = params.code;
  if (!name || !code) return { error: "need name and code params (POST JSON body)" };
  const tags = params.tags
    ? (typeof params.tags === "string" ? params.tags.split(",").map((t: string) => t.trim()) : params.tags)
    : undefined;
  saveSkill(name, code, { description: params.description || "", ...(tags ? { tags } : {}) });
  return { status: "saved", name };
}
