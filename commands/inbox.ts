import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, _params: any) {
  const messages = [...instance.chatInbox];
  instance.chatInbox.length = 0;
  return { messages, count: messages.length };
}
