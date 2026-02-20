import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const code = params.code;
  if (!code) return { error: "need code param (POST JSON body with {code, name?, timeout?, mission?})" };
  const name = params.name || "anonymous";
  const isMission = params.mission === true || params.mission === "true";
  const rawTimeout = Number(params.timeout);
  const timeout = (Number.isFinite(rawTimeout) && rawTimeout > 0) ? rawTimeout : (isMission ? 300_000 : 60_000);
  const wait = params.wait === "true" || params.wait === true;
  const action = instance.actionQueue.push(name, code, timeout);
  if (wait) {
    const result = await instance.actionQueue.waitFor(action.id, timeout + 5000);
    return result || action;
  }
  return action;
}
