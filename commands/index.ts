import type { BotInstance } from "./_helpers";
import status from "./status";
import look from "./look";
import inventory from "./inventory";
import block from "./block";
import recipes from "./recipes";
import execute from "./execute";
import queue from "./queue";
import state from "./state";
import poll from "./poll";
import skills from "./skills";
import load_skill from "./load_skill";
import save_skill from "./save_skill";
import place from "./place";
import goto from "./goto";
import follow from "./follow";
import stop from "./stop";
import chat from "./chat";
import attack from "./attack";
import dig from "./dig";
import drop from "./drop";
import equip from "./equip";
import survey from "./survey";
import inbox from "./inbox";
import direct from "./direct";
import directives from "./directives";
import give from "./give";
import screenshot from "./screenshot";
import pov from "./pov";
import map from "./map";
import render from "./render";

export const handlers: Record<string, (instance: BotInstance, params: any) => Promise<any>> = {
  status, look, inventory, block, recipes,
  execute, queue, state, poll,
  skills, load_skill, save_skill,
  place, goto, follow, stop, chat, attack, dig, drop, equip,
  survey, inbox, direct, directives, give,
  screenshot, pov, map, render,
};
