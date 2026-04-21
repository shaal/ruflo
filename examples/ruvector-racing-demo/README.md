# RuVector Self-Learning AI Racing Demo

A browser-only demo that shows a [RuVector](https://github.com/ruvnet/ruvector)-style
self-learning agent learning to drive a pseudo-3D racing game in real time — no
backend, no build step, no external deps.

## What you're watching

Up to 8 AI cars share a single `AgentMemory`. Each frame every AI:

1. **Senses** — casts 7 rays across the road ahead, reads its speed, road
   offset, and the upcoming curvature 50/150 segments out.
2. **Retrieves** — queries AgentMemory for the top-k most similar past states
   (cosine similarity over an 18-dim vector).
3. **Acts** — blends the neighbors' actions weighted by similarity × reward.
   With probability ε it explores instead.
4. **Learns** — computes a shaped reward, stores the experience, and on crash
   or every N frames triggers SONA's *deep loop* (high-reward replay) and a
   GNN-style cluster rebuild.

You should see the cars crash everywhere for the first 10–20 seconds, then
visibly hug the inside of curves, brake before tight turns, and take cleaner
racing lines as AgentMemory fills and clusters stabilize.

## Run it

```bash
# from the repo root
cd examples/ruvector-racing-demo
python3 -m http.server 8080
# open http://localhost:8080
```

Any static server works (`npx serve`, `http-server`, VS Code Live Server…).
ES modules need a real `http://` origin — `file://` won't load `js/main.js`.

Modern Chrome / Firefox / Safari. No build. No npm install.

## Controls

| Input | Effect |
|---|---|
| **Start Training** | Begin the simulation |
| **Pause / Resume** | Freeze the world (AgentMemory keeps its state) |
| **Reset Memory** | Wipe AgentMemory + localStorage — fresh run |
| **Manual Drive** | Spawn a player car; arrow keys; experiences flow into AgentMemory as imitation data |
| **New Track** | Generate a new procedural track from a random seed |
| **AI cars** | 1–8 concurrent learners sharing the same memory |
| **Exploration (ε)** | Probability of a random action per frame |
| **Speed reward** / **Crash penalty** | Tune the reward function live |
| **Overlays** | Sensor rays, ghost trajectories, confidence bars |
| **Crash heatmap** | Red glow where agents have crashed (fades over 20 s) |

## Live dashboard

- **AgentMemory panel** — experiences stored, total seen, GNN clusters, mean
  reward, recall latency (should be <1 ms for a few thousand vectors in JS).
- **Intelligence pipeline** — live counters for RETRIEVE / JUDGE / DISTILL /
  CONSOLIDATE, matching RuVector's 4-step loop.
- **Cars panel** — per-car lap, crashes, avg reward, recall confidence, and a
  maturity bar that ticks up on each consolidate.
- **Reward chart** — rolling average reward across recent episodes.
- **On-canvas HUD** — FPS + RuVector query latency.
- **Per-car overlays** — colored ray casts (green = high recall confidence,
  red = low / blocked by another car), a confidence bar above the car, and
  cyan "ghost" splines tracing the top-3 recalled neighbor trajectories for
  the camera leader.

## How the RuVector integration works

Every public call in `js/ruvector.js` is marked `RU VECTOR INTEGRATION` and
mirrors the API surface of the upstream Rust/WASM crate:

| JS stand-in | Upstream equivalent |
|---|---|
| `new AgentMemory(name, { capacity, k })` | `AgentMemory::new` |
| `memory.storeExperience({ state, action, reward, nextState, done })` | `AgentMemory::store_experience` |
| `memory.recall(query, k)` | `AgentMemory::recall` (HNSW top-k) |
| `memory.blendActionFromRecall(query, k)` | MicroLoRA policy head |
| `memory.consolidate({ deepLoopK })` | SONA deep loop (replay high-reward states) |
| `memory._rebuildClusters()` | GNN experience-graph clustering |
| `AgentMemory.serialize / deserialize` | AgentDB persistence |

When browser-ready `@ruvector/core` WASM bindings land, you should be able to
drop them in with minimal changes to `js/ai.js`. The state encoder, reward
shaper, and visualizations don't care whether the backend is WASM or JS.

## State vector (18-dim)

```
[0..6]   ray distances    (7 rays, normalized to [0..1])
[7..13]  ray-hit-car flag (0 or 1)
[14]     road offset      (-1.5..1.5)
[15]     speed            (0..1)
[16]     upcoming curve @ 50 segs
[17]     upcoming curve @ 150 segs
```

## Reward function (`calculateReward`)

```
+ (distance covered this frame / 200) * speed_weight
+ current speed * 0.2 * speed_weight
- 2.0      if off the road
- 6 * max(0, 0.15 - nearest_ray)    # imminent danger
- crash_weight  if crashed this frame
+ (1 - |road offset|) * 0.05        # small centering bonus
```

Both `speed_weight` and `crash_weight` are live-tunable via sliders.

## File layout

```
examples/ruvector-racing-demo/
├── index.html               UI shell
├── css/style.css            Dashboard styling
├── js/
│   ├── road.js              Pseudo-3D segments, projection, rendering
│   ├── car.js               Car physics + entity state
│   ├── sensors.js           Ray casting + state features
│   ├── ruvector.js          AgentMemory + SONA + GNN stand-ins
│   ├── ai.js                Brain (state encoder, action selection, reward)
│   ├── overlays.js          Debug viz, crash heatmap, sidebar, chart
│   └── main.js              Game loop, UI wiring, localStorage persistence
└── README.md
```

All files are under 500 lines, ES modules, zero external runtime deps.

## Road engine credits

The pseudo-3D road is a clean-room reimplementation of the technique Jake
Gordon documented in his [Javascript
Racer](https://github.com/jakesgordon/javascript-racer) series (v4.final) —
segment-based world, forward projection, centrifugal force, straight/curve/
hill helpers. Same math, different code, MIT-compatible.

## Persistence

Every ~5 s the most recent 2000 experiences + memory stats are written to
`localStorage` under `ruvector-racer`. Refreshing the page resumes training
from where you left off. Use **Reset Memory** to start from scratch.

## License

MIT — matches the upstream Javascript Racer and RuVector licenses.
