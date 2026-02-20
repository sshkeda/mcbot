import type { BotInstance } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const current = instance.actionQueue.getCurrent();
  if (!current) return { status: "idle", progress: [] };
  const allLogs = current.logs || [];
  const progressLogs = allLogs.filter(
    (l: string) => l.startsWith("[PROGRESS]") || l.startsWith("[CHECKPOINT]"),
  );
  return {
    status: "running",
    actionId: current.id,
    name: current.name,
    startedAt: current.startedAt,
    elapsed: current.startedAt ? Date.now() - new Date(current.startedAt).getTime() : 0,
    totalLogs: allLogs.length,
    progress: progressLogs,
    lastLog: allLogs.length > 0 ? allLogs[allLogs.length - 1] : null,
  };
}
