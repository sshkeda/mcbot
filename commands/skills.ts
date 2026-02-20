import type { BotInstance } from "./_helpers";
import { listSkills } from "./_helpers";

export default async function (_instance: BotInstance, _params: any) {
  return { skills: listSkills() };
}
