import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const msg = (params.message || "").replace(/\\([!@#$?])/g, "$1");
  instance.bot.chat(msg);
  return { status: "sent" };
}
