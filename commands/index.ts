import type { BotInstance } from "./_helpers";
import look from "./look";
import inventory from "./inventory";
import block from "./block";
import recipes from "./recipes";
import execute from "./execute";
import queue from "./queue";
import state from "./state";

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
import pov from "./pov";
import render from "./render";
import probe from "./probe";
import scan_volume from "./scan_volume";
import diff_blueprint from "./diff_blueprint";
import progress from "./progress";

export const handlers: Record<string, (instance: BotInstance, params: any) => Promise<any>> = {
  look, inventory, block, recipes,
  execute, queue, state, progress,
  skills, load_skill, save_skill,
  place, goto, follow, stop, chat, attack, dig, drop, equip,
  survey, inbox, direct, directives, give,
  pov, render,
  probe, scan_volume, diff_blueprint,
};
