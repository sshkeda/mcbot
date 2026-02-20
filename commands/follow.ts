import type { BotInstance } from "./_helpers";
import { GoalFollow } from "./_helpers";

export default async function (instance: BotInstance, params: any) {
  const { bot } = instance;
  const target = bot.players[params.player]?.entity;
  if (!target) return { error: `player "${params.player}" not found` };
  bot.pathfinder.setGoal(new GoalFollow(target, 3), true);
  return { status: `following ${params.player}` };
}
