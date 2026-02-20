import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  if (params.cancel === "current") {
    const cancelled = instance.actionQueue.cancelCurrent();
    return { status: cancelled ? "cancelled current" : "nothing running" };
  }
  if (params.cancel === "all") {
    const count = instance.actionQueue.clear();
    return { status: `cancelled ${count} actions` };
  }
  if (params.cancel) {
    const cancelled = instance.actionQueue.cancel(params.cancel);
    return { status: cancelled ? `cancelled ${params.cancel}` : `action ${params.cancel} not found or already finished` };
  }
  return { queue: instance.actionQueue.getState(), current: instance.actionQueue.getCurrent() };
}
