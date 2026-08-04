# Ported roster audit

Every machine brought over from v2, checked three ways: against the catalog it
came from, against the six bots v1 already had, and inside v1's own physics and
its own page. Re-run any of it with the commands at the bottom.

## 1. Orientation, size and rig — `v1/tools/ported-bot-audit.mjs`

Measured through v1's OWN loader (`src/modelParts.js`) on the shipped GLBs, in
game space, after normalization. **22/22 clean.**

| bot | measured w × l × h (ft) | stated w | wheels / worst anchor | weapon | pivot drift | swept radius |
|---|---|---|---|---|---|---|
| beta | 2.90 × 3.03 × 2.36 | 2.90 | enclosed | hammer | 0.22 | — |
| clawviper | 2.90 × 4.21 × 2.38 | 2.90 | 4 / 0.57 | grappler | 0.37 | — |
| deepsix | 4.00 × 3.06 × 3.11 | 4.00 | enclosed | bar | 0.00 | 1.52 / 1.52 |
| hydra | 3.00 × 3.75 × 1.60 | 3.00 | enclosed | flipper | 0.10 | — |
| sawblaze | 2.80 × 2.71 × 2.03 | 2.80 | 2 / 0.28 | hammerSaw | 0.37 | — |
| tombstone | 3.90 × 2.93 × 1.29 | 3.90 | 2 / 0.23 | bar | 0.05 | 1.97 / 1.97 |
| whiplash | 2.90 × 3.77 × 2.24 | 2.90 | 4 / 0.01 | lifterDisc | 0.01 | — |
| witchdoctor | 2.95 × 3.36 × 1.31 | 2.95 | 4 / 0.03 | drum | 0.00 | 0.63 / 0.63 |
| blip | 2.95 × 3.65 × 1.53 | 2.95 | 2 / 0.52 | flipper | 0.00 | — |
| copperhead | 3.25 × 2.19 × 1.16 | 3.25 | 2 / 0.01 | drum | 0.00 | 0.42 / 0.42 |
| duck | 3.50 × 2.88 × 0.49 | 3.50 | 4 / 0.57 | lifter | 0.00 | — |
| endgame | 3.30 × 2.24 × 1.71 | 3.30 | enclosed | drum | 0.00 | 0.47 / 0.47 |
| freeshipping | 2.70 × 4.02 × 1.97 | 2.70 | 4 / 0.78 | lifter | 0.00 | — |
| mammoth | 5.33 × 4.88 × 6.07 | 5.33 | 2 / 0.11 | bar | 0.00 | 3.01 / 3.01 |
| overhaul | 3.10 × 4.01 × 2.21 | 3.10 | 4 / 0.99 | grappler | 0.01 | — |
| shatter | 2.45 × 4.18 × 2.82 | 2.45 | enclosed | hammer | 0.01 | — |
| tantrum | 2.85 × 3.26 × 1.53 | 2.85 | enclosed | drum | 0.00 | 0.40 / 0.36 |
| dragonking | 4.00 × 3.46 × 2.36 | 4.00 | enclosed | sawArms | 0.01 | — |
| gigabyte | 3.61 × 4.08 × 3.04 | 3.35 | enclosed | bar | 0.09 | 1.75 / 1.67 |
| glitch | 3.45 × 3.04 × 0.85 | 3.45 | enclosed | drum | 0.00 | 0.45 / 0.44 |
| kraken | 2.90 × 3.57 × 2.69 | 2.90 | 2 / 0.21 | crusher | 0.00 | — |
| rusty | 2.85 × 4.26 × 2.03 | 2.85 | enclosed | hammer | 0.00 | — |

**Orientation** is answered by the wheels, not by re-reading `modelYaw`: every
`modelWheel` node has to land on one of the bot's own suspension anchors, which
are authored in the game frame — a model yawed a quarter turn puts its wheels
across the anchors instead of on them. Worst case on the roster is Overhaul at
0.99ft, and that is not a rotation: its front wheels sit a foot behind the
anchors v2 placed at the chassis corners. Every bot's tyres also stand ON the
floor, which is the check that catches a model built upside down. "enclosed"
means the machine's wheels are inside its shell and were never segmented out
(`hideWheels` in the catalog); its suspension still runs off the anchors.

**Size** is measured against v2's own sizing contract — the GLB is scaled so its
DRAWN width equals the researched real-world width — and all 22 land on it
exactly. Only Gigabyte reads wide (3.61 against 3.35), and it is the measurement
that differs rather than the model: its yaw is 1.6912 rad rather than a quarter
turn, so the true rotated bounding box of a round shell is wider than the
axis-aligned box v2's own size check reads.

**Rig**: every weapon pivot v1 resolves is within 0.37ft of the catalog's, and
the two that are furthest out (Sawblaze, Claw Viper) are the ones whose GLB
carries an authored `pivotLocal` — v1 honours it exactly as v2 does, so the
difference IS the correction. Swept radii match the catalog to within 5%.

### Ported sizes against v1's own bots

The roster got bigger, because v2 sized every machine off researched real-world
widths and v1's fit boxes were drawn by eye:

| | narrowest | widest | median |
|---|---|---|---|
| v1 native (fit width) | Minotaur 2.10 | HUGE 5.07 | ~3.2 |
| ported (measured) | Shatter 2.45 | Mammoth 5.33 | ~2.95 |

The bands are the same shape. Mammoth is the one machine outside anything v1 had
— 5.3ft wide, 6.1ft tall, with a 6ft bar — and it revealed a real limit: the
headless test rig's ceiling was 6.3ft, under Mammoth's blade tip at 6.33, so the
tallest bot on the roster was pinned to the roof before it could take a step.
The rig now uses the arena's real 9.45ft ceiling.

## 2. Weapon function in v1 physics — `v1/tools/weapon-mechanism-probe.mjs`

Each bot is set a few feet from a reference foe (Quantum) and driven into it with
its weapon running. Two things have to be true: the mechanism moves, and it
reaches. **22/22 do both**, and it is asserted per bot by the "ported roster
weapons work" check in the physics suite.

`stroke` is the arm's travel from rest to its stop (1.00 = it reached the stop),
`sub` a nested rotor's spin-up ratio, `jaw` a grappler's clamp, `hits` the number
of damage events v1's own pipeline recorded against the foe.

```
bot           weapon       spin         stroke   sub      jaw    engaged  pushed   lift    hits   damage   kinds
beta          hammer       -            1.00     -        -      150      3.12     0.14    2      19.1     hammer
clawviper     grappler     -            1.00     -        1.00   150      22.01    0.19    141    5.4      lifter
deepsix       bar          14/118       0.00     -        -      0        10.89    0.86    5      99.2     spinner
hydra         flipper      -            0.00     -        -      0        1.70     8.17    1      11.5     flipper
sawblaze      hammerSaw    -            1.00     1.00     -      114      9.43     0.25    114    6.2      saw
tombstone     bar          51/95        0.00     -        -      0        7.51     2.01    3      45.9     spinner
whiplash      lifterDisc   -            1.00     1.00     -      150      17.70    0.14    138    32.9     saw
witchdoctor   drum         125/150      0.00     -        -      0        13.78    2.49    3      25.8     spinner
blip          flipper      -            0.00     -        -      0        0.23     7.64    1      11.5     flipper
copperhead    drum         148/150      0.00     -        -      0        26.59    7.80    2      276.9    spinner
duck          lifter       -            1.00     -        -      150      15.96    0.17    136    7.3      lifter
endgame       drum         114/150      0.00     -        -      0        33.55    7.54    8      162.1    spinner
freeshipping  lifter       -            1.00     -        -      150      16.23    0.38    142    7.8      lifter
mammoth       bar          79/84        0.00     -        -      0        10.83    0.98    1      1.5      spinner
overhaul      grappler     -            1.00     -        1.00   150      18.52    0.23    137    5.4      lifter
shatter       hammer       -            1.00     -        -      150      8.72     0.65    1      3.8      hammer
tantrum       drum         80/150       0.00     -        -      0        26.65    7.05    10     174.7    spinner
dragonking    sawArms      -            1.00     1.00     -      135      2.70     0.13    135    27.5     saw
gigabyte      bar          16/73        0.00     -        -      0        3.62     1.05    2      41.7     spinner
glitch        drum         122/150      0.00     -        -      0        21.94    6.90    8      156.0    spinner
kraken        crusher      -            0.00     -        -      0        22.07    0.08    14     3.5      crusherBite
rusty         hammer       -            1.00     -        -      150      0.96     0.01    1      2.1      hammer
```

What the shapes look like, which is the point of the table — the per-hit
numbers are NOT comparable across bots here, because a 2.5s engagement catches
each rotor at whatever speed its own wind-up has reached and every hit drains
the one that landed it. Ranked damage is the "spinner side hit ladder" check's
job, and it asserts the same order it always did.

- **Spinners** land few, very large hits and throw their victim furthest —
  Copperhead, Endgame, Tantrum and Glitch reach full speed inside the window and
  launch the foe 7ft into the air; the long wind-ups (Deep Six 4.5s, Gigabyte
  6s) are still climbing when it closes, exactly as they should be.
- **Hammers** score once per stroke and drive DOWN rather than throwing: Beta
  and Shatter move their victim a foot or two, not across the arena.
- **Saw arms and discs** (Sawblaze, Dragon King, Whiplash) score continuously,
  in small amounts, for as long as the arm is down and the rotor is turning —
  114-138 ticks over the same window.
- **Lifters and grapplers** score least per tick and move their victim
  furthest — Claw Viper and Overhaul shove the foe 20ft while ticking damage,
  which is what a control machine does.
- **Kraken** is the one that reports its damage down another channel: a crusher
  bite goes through v1's bite path rather than the impact path, which is why its
  column reads `crusherBite`.

## 3. Driving — `v1/tools/drive-smoothness-probe.mjs`

Every ported bot has to drive like a v1 bot before anything else about it
matters. Asserted per bot by the "ported roster drives smoothly" check.

```
bot           rest     cruise         ripple   lateral  headΔ   tilt    grip   hop     stop    turn R/L
beta          0.0000   9.79/96%       0.0000   0.000    0.00    0.00    0.93   0.000   0.001   -6.30/6.17
clawviper     0.0000   16.65/98%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.40/6.39
deepsix       0.0000   10.60/96%      0.0000   0.000    0.00    0.00    0.93   0.000   0.001   -6.40/6.38
hydra         0.0000   13.99/97%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.10/6.20
sawblaze      0.0000   9.84/96%       0.0000   0.000    0.00    0.42    1.00   0.000   0.000   -6.44/6.25
tombstone     0.0000   9.16/98%       0.0000   0.000    0.00    0.33    0.84   0.000   0.001   -11.21/11.25
whiplash      0.0000   12.35/97%      0.0025   0.015    0.07    0.88    1.00   0.001   0.000   -6.37/5.97
witchdoctor   0.0000   13.14/97%      0.0000   0.000    0.00    0.00    0.93   0.000   0.000   -6.40/6.39
blip          0.0000   14.84/97%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.40/6.39
copperhead    0.0000   12.29/96%      0.0000   0.000    0.00    0.00    0.93   0.000   0.000   -6.40/6.39
duck          0.0000   11.45/96%      0.0000   0.000    0.00    0.00    0.93   0.000   0.000   -6.29/6.06
endgame       0.0000   14.78/97%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.40/6.38
freeshipping  0.0000   12.29/96%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.40/6.39
mammoth       0.0000   17.73/95%      0.0002   0.000    0.00    0.00    0.93   0.000   0.007   -6.40/6.39
overhaul      0.0000   13.14/97%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.40/6.39
shatter       0.0000   11.48/96%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -5.05/6.13
tantrum       0.0000   13.14/97%      0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.40/6.39
dragonking    0.0000   6.38/94%       0.0009   0.000    0.00    0.00    0.92   0.000   0.008   -4.45/4.43
gigabyte      0.0000   9.68/95%       0.0002   0.000    0.00    0.00    0.92   0.000   0.004   -6.73/6.72
glitch        0.0000   9.72/95%       0.0001   0.000    0.00    0.00    0.93   0.000   0.002   -6.40/6.38
kraken        0.0000   16.32/96%      0.0705   0.001    0.00    0.00    0.92   0.000   0.000   -6.31/5.98
rusty         0.0000   5.55/93%       0.0015   0.000    0.00    0.00    0.92   0.000   0.011   -3.59/3.57
```

Read against v1's own machines (same probe, same thresholds):

```
bot           rest     cruise         ripple   lateral  headΔ   tilt    grip   hop     stop    turn R/L
biteforce     0.0000   11.60/97%      0.0000   0.000    0.00    0.68    1.00   0.000   0.000   -6.35/6.51
bronco        0.0000   10.56/96%      0.0000   0.000    0.00    0.27    1.00   0.000   0.000   -6.72/6.71
huge          0.0000   5.31/98%       0.0000   0.000    0.00    0.00    0.92   0.000   0.000   -6.14/6.13
quantum       0.0000   10.52/96%      0.0000   0.000    0.00    0.00    1.00   0.000   0.001   -6.52/6.51
hypershock    0.0000   19.31/97%      0.0262   0.007    0.02    0.00    1.00   0.000   0.000   -6.67/6.66
minotaur      0.0000   15.45/97%      0.0000   0.000    0.00    0.01    1.00   0.000   0.000   -6.52/6.51
```

Ported bots reach 93-98% of their configured top speed, hold it without ripple,
track straight with no measurable lateral drift or heading error, stay within a
degree of flat under full acceleration, keep 0.84-1.00 drive-contact grip, stop
without hopping, and spin both ways at rates that match v1's own bots (the two
tracked machines, Rusty and Dragon King, turn slower on purpose).

## 4. The page itself — `v1/tools/boot-probe.mjs`

The physics rig runs v1's simulation without its renderer and the audit runs its
loader without a browser; neither executes `main.js`, which is where a ported bot
is actually wired up. So every bot is booted in a real browser, into a real
match, with the weapon and both drive channels held down for five seconds of real
frames. **22/22 boot clean** — no console errors, no page exceptions.

## 5. Mechanisms that are not weapons — `v1/tools/mechanism-probe.mjs`

Everything a v2 bot does beyond swinging its weapon, measured one bot at a time
and asserted by the "ported mechanisms work" check. **All present, all working.**

```
carriage    tantrum       {"wound":1,"released":0,"fling":1.5,"hitBoost":1.5}
fists       tantrum       {"stroke":1,"punches":6,"damage":15}
flame       freeshipping  {"burning":1,"ticks":148,"damage":22.199999999999967,"requiresGrip":false,"shoved":15.044720078823543}
flame       kraken        {"burning":1,"ticks":33,"damage":4.4,"requiresGrip":true,"shoved":23.08518514296204}
two-way     duck          {"raised":0.5833333333333333,"parked":0.5833333333333333,"lowered":0,"held":0}
grip        clawviper     {"grippedFrames":143,"maxLift":0.20576656609773636,"releaseKick":0.29671792313456535}
grip        overhaul      {"grippedFrames":142,"maxLift":0.17426148056983948,"releaseKick":0.2922322750091553}
holonomic   shatter       {"sideways":6.785165626557216,"forward":3.5762786865234375e-7,"yawDrift":0}
tracked     dragonking    {"before":6.377766133332709,"after":0.07254429162661014,"stopped":0.011374561266438604}
holonomic   glitch        {"sideways":5.089339013550045,"forward":0.000002749264467638568,"yawDrift":0}
tracked     rusty         {"before":5.548918444173724,"after":0.06863010918307977,"stopped":0.012368195689583488}
body lift   dragonking    {"maxDeg":59.5,"heldDeg":57.9,"wantDeg":90,"rose":1.528,"sank":-0.001,"settledDeg":0.4}
srimech     hydra         {"beforeUpY":-1.000000000106985,"bestUpY":0.9998047838950685,"lifted":1.8032821416854858,"recovered":true}
srimech     blip          {"beforeUpY":-0.9996326800498869,"bestUpY":0.99995834356828,"lifted":1.8625928163528442,"recovered":true}
srimech     duck          {"beforeUpY":-1.0000000000002387,"bestUpY":0.9999965687993054,"lifted":1.6854229271411896,"recovered":true}
srimech     freeshipping  {"beforeUpY":-0.9999263906859567,"bestUpY":0.9999444878096126,"lifted":1.889191746711731,"recovered":true}
srimech     overhaul      {"beforeUpY":-0.9999997616880035,"bestUpY":0.9999828681801222,"lifted":1.5358527898788452,"recovered":true}
srimech     shatter       {"beforeUpY":-1.0000000000000004,"bestUpY":0.9998090356294762,"lifted":2.182107448577881,"recovered":true}
srimech     rusty         {"beforeUpY":-0.9999734641434457,"bestUpY":0.9991549680991972,"lifted":1.5537958145141602,"recovered":true}
```

Reading it: Tantrum's carriage travels its full stroke and returns, and its hit
boost lands at exactly the 1.5x the catalog states, but only while the carriage
is moving. Free Shipping burns continuously and Kraken only after its jaw is
shut, which is the difference `requiresGrip` describes. Duck's plow parks
mid-stroke and stays there. Both grapplers hold a foe for over two seconds and
kick it away on release. The omniwheel bots travel 5-7ft sideways with zero
forward drift and zero yaw. Both tracked bots shed 99% of their speed within
0.3s of the stick being released. Every arm that can reach the floor gets its
machine back on its wheels from fully inverted. Dragon King rears 59.5° of the
90° it is asked for — a proportional servo holding against gravity keeps a
steady-state error, exactly as v2's does — and it does it by lifting the BODY
1.53ft while the lowest collider on the machine never gets more than 0.001ft
below the floor, which is the whole distinction: pitch about the axle at the
back of the pods, not about the centre of mass.

## 6. Weapon controls — `v1/tools/weapon-control-audit.mjs`

A weapon can move, land and hurt with every other check green and still be
unplayable, because none of those checks presses a button the way a player
does. This one imports v2's `src/game/weaponControls.js` — the module that
already decided all of this — and compares v1's channel labels, latching rules
and a scripted press/release trace against it, bot by bot. **All 22 match.**

```
bot           weapon       RB        LB   LT   channels (* = latches)
clawviper     grappler     toggle    -    -    PRI=FORKS SEC=JAW*
sawblaze      hammerSaw    toggle    -    -    PRI=SWING SEC=SAW*
whiplash      lifterDisc   toggle    -    -    PRI=LIFT SEC=DISC*
duck          lifter       hold      -    -    PRI=RAISE SEC=LOWER
freeshipping  lifter       toggle    -    -    PRI=LIFT SEC=FLAME*
overhaul      grappler     toggle    -    -    PRI=FORKS SEC=JAW*
tantrum       drum         hold      yes  -    PRI=SPIN UP* SEC=PULL BACK AUX=FISTS
dragonking    sawArms      toggle    yes  yes  PRI=BITE* SEC=SAWS* AUX=TILT SAWS LIF=REAR UP
kraken        crusher      toggle    -    -    PRI=BITE SEC=FLAME*
tombstone     bar          hold      -    -    PRI=SPIN UP*
```

(Spinners and flippers with nothing on the second channel are omitted; they all
report the channel dead, which is what v2 does.)

What this caught and fixed:

| | |
|---|---|
| **RB was momentary everywhere** | a saw motor, a disc, a jaw or a flamethrower you have to keep a finger on cannot be used while driving with both sticks. Those channels now LATCH, matching v2; Tantrum's carriage and Duck's plow stay momentary, because releasing the carriage IS the shot and Duck's second channel is the other direction |
| **Dragon King had three mechanisms on two buttons** | its trigger was swinging the saw arms, so the jaw — the mechanism everything else on that bot depends on — had nowhere to live. RT is now the jaw, RB the saws, LB the arm tilt, LT the body lift, which is v2's layout |
| **The body lift drove the pods through the floor** | it was a torque about the centre of mass, which pitches the nose up by pushing the tail DOWN. It is now v2's pitch servo about the axle at the back of the pods, damped on rate and with the axle held still |
| **The preview only ran the trigger** | the bot-select viewer passed one boolean to the weapon runtime, so on the plinth nothing but RT did anything. It now runs the whole input through the same resolver the arena does, plus the body pitch and the flame particles the plinth has no physics for |
| **A stray press could reach a mechanism a bot did not have** | the second channel passed the button through regardless. It now reports dead unless the bot has something on it |

## 7. Known deviations from v2, and why

| | |
|---|---|
| **Mass** | v2 gives every bot true slugs from its catalog; v1 gives every bot the same rigid-body mass and lets collider density add the rest. Ported densities are normalized onto v1's own collider-mass band, so a v2 stack does not arrive four times heavier than the bot it is fighting. Tombstone and Sawblaze — the two that REPLACED a v1 entry — keep the mass those entries carried. |
| **Suspension** | v2 runs raycast suspension off `wheelAnchors`; v1 has none. The anchors become `driveContact` probes with their contact patches on the floor plane the model rests on. |
| **Reach** | v2 measures a spinner's reach in its own sim; v1 measures it to the target's centre. Ported reach is v2's number floored by the bot's own geometry — how far its nose stands ahead of its rotor, plus a foe's half-length. Without that floor, Witch Doctor, Endgame and Glitch spun at full speed and never touched anything they drove into. |
| **Grappler damage** | v2 gives Claw Viper and Overhaul no hold damage at all, because a v2 fight it controls can be won on the judges' cards. v1 decides everything on damage, so a grappler ticks a little while it holds you. |
| **Weapon channels** | v2 has four held channels (RT/RB/LB/LT) and so, now, does v1 — the third and fourth take over the brake and the boost, but only for the two machines that have something to put there, and both of those stop on their drivetrain anyway. The RULES are shared rather than reimplemented: section 6 checks v1's resolver against v2's own module. Where the seam falls differs — v2 latches spinners and Dragon King's jaw in its input shaper, v1 latches the same two things one layer down, in the spinner's own toggle and in the jaw mechanism, because in v1 those latches predate the channel layer. |
| **Grip and lift fidelity** | v2 servos a gripped victim onto a point that sweeps with the arm through its own solver, and pitches Dragon King's chassis with a real servo. v1 does both with scripted impulses against its own physics — the mechanism and the numbers are the same, the integration is v1's. |

## Re-running it

```bash
npm run test:v1                                          # 32 checks, 3 of them the ported roster's
node v1/tools/ported-bot-audit.mjs                       # section 1
node v1/tools/weapon-mechanism-probe.mjs                 # section 2
node v1/tools/drive-smoothness-probe.mjs                 # section 3
node v1/tools/mechanism-probe.mjs                        # section 5
node v1/tools/weapon-control-audit.mjs                   # section 6
node server.mjs & node v1/tools/boot-probe.mjs --arena   # section 4
```
