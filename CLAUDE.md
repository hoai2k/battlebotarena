# Working in this repo

## Always merge to `main` when a change is done

A change that is finished on a branch is not delivered. The game is played from
`main` — work that stops at a pushed branch is invisible to whoever is actually
playing, and the bug it fixed will be reported again.

So every change ends the same way:

```bash
git checkout main
git merge <branch>            # --ff-only when main has not moved
git push -u origin main
```

Do this as the last step of the task, without being asked, once the change is
verified. "Verified" means the checks below have been run and pass — merging
unverified work to `main` is the one thing worse than not merging.

If a merge cannot be completed — a genuine conflict needing a decision, or a
check that will not pass — say so plainly in the reply rather than leaving the
work sitting on a branch as if it were done.

## Verify before merging

There is no build step and no unit-test framework for the rendering and UI
layers; correctness is checked by driving the real page in a real browser. Run
what the change touches:

| Change touches | Run |
|---|---|
| physics, damage, weapons | `npm test` (`tools/sim-tests.mjs`) |
| renderer, cameras, viewports | `node tools/split-probe.mjs /tmp/shots` |
| menus, gamepad navigation | `node tools/menu-input-probe.mjs` |
| a bot's model or animation | `node tools/boot-probe.mjs <ids> /tmp/shots` |
| analytics, or anything off-origin | `node tools/stats-probe.mjs` |

All of them need the server up: `node server.mjs` (port 4173). The probes use
Playwright — `npm i --no-save playwright` if it is missing.

### Probes run at pixel ratio 1 unless told otherwise

The split-screen viewports were wrong on every HiDPI display for as long as they
existed, and no probe caught it, because a headless browser defaults to a pixel
ratio of 1 and that is the one ratio where the bug is invisible. When a change
touches anything that measures the canvas, run it at `deviceScaleFactor: 2` as
well — `split-probe.mjs` takes the ratio as its second argument and defaults to
2 for this reason.
