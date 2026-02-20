import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const code = params.code;
  if (!code) return { error: "need code param (POST JSON body with {code, name?, timeout?})" };
  const name = params.name || "anonymous";
  const timeout = Number(params.timeout) || 60_000;
  const wait = params.wait === "true" || params.wait === true;
  const action = instance.actionQueue.push(name, code, timeout);
  if (wait) {
    const result = await instance.actionQueue.waitFor(action.id, timeout + 5000);
    return result || action;
  }
  return action;
}
