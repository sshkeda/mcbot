# DoAnythingNow - Meta-Agent TODO

## Role
Meta-agent that monitors other bots, helps them directly, and can spawn new bot subagents.

## Current Situation
- **Builder2**: Building roof at house (15,102,-20). Needs cobblestone (30+) for chimney and more spruce planks for later phases.
- **Explorer**: Ascending from y=-6 via pillar-ascent, heading home with 42 diamonds. Home bed at (0,113,0).
- **DoAnythingNow**: At (2.5, 111, -5.5). Has 9 spruce logs, 12 planks, wooden axe.

## Plan
- [x] Cancel old missions, assess situation
- [x] Read other bots' TODOs and state
- [ ] Mine 40+ cobblestone for Builder2's chimney
- [ ] Gather 30+ spruce logs for Builder2's planks
- [ ] Deliver supplies to Builder2 house at (15, 102, -20)
- [ ] Monitor Explorer's ascent - help if stuck
- [ ] Check inbox regularly for player requests
- [ ] Spawn new bot subagents if requested

## Notes
- Builder2 is locked by orchestrator, actively building
- Explorer is locked by orchestrator, ascending to surface
- Can spawn new bots with `bun run cli.ts spawn <name>` + Task tool
