// Main game loop. Wires the pseudo-3D road, multi-car simulation, RuVector
// AgentMemory, AI controllers, and visual overlays together.

import { buildTrack, renderRoad, SEG_LENGTH } from './road.js';
import { createCar, updateCar, resetCar } from './car.js';
import { AgentMemory } from './ruvector.js';
import { AiBrain } from './ai.js';
import {
  drawCarOverlays, drawGhostTrajectories, drawHUD, renderSidebar, Heatmap,
} from './overlays.js';

const LS_KEY = 'ruvector-racer';

const state = {
  running: false,
  manual: false,
  seed: 1,
  track: buildTrack(1),
  memory: new AgentMemory('racer-demo', { capacity: 4000, k: 7 }),
  cars: [],
  player: null,
  camera: { x: 0, y: 0, z: 0 },
  weights: { speed: 1.0, crash: 5.0 },
  epsilon: 0.25,
  numCars: 4,
  episodes: [],
  heatmap: new Heatmap(),
  lastFrame: performance.now(),
  fps: 60,
  showOverlays: true,
  showHeatmap: false,
  keys: { left: false, right: false, up: false, down: false },
  lapTimesByCar: new Map(),
};

// ---------- DOM refs ----------
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const memoryEl = document.getElementById('panel-memory');
const pipelineEl = document.getElementById('panel-pipeline');
const carsEl = document.getElementById('panel-cars');
const chart = document.getElementById('chart-reward');

const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');
const btnManual = document.getElementById('btn-manual');
const btnTrack = document.getElementById('btn-track');
const chkOverlays = document.getElementById('chk-overlays');
const chkHeatmap = document.getElementById('chk-heatmap');
const slCars = document.getElementById('sl-cars');
const slEps  = document.getElementById('sl-epsilon');
const slSpd  = document.getElementById('sl-speed');
const slCrh  = document.getElementById('sl-crash');
const outCars = document.getElementById('out-cars');
const outEps  = document.getElementById('out-epsilon');
const outSpd  = document.getElementById('out-speed');
const outCrh  = document.getElementById('out-crash');

// ---------- Setup ----------
function spawnCars(n) {
  state.cars = [];
  for (let i = 0; i < n; i++) {
    const car = createCar(i, { z: i * SEG_LENGTH * 2 });
    car.brain = new AiBrain(car, state.memory, { epsilon: state.epsilon });
    state.cars.push(car);
  }
  if (state.manual) addPlayer();
}

function addPlayer() {
  if (state.player) return;
  const p = createCar(99, {
    isPlayer: true,
    label: 'You',
    color: '#ffffff',
    z: 0,
  });
  // Player also writes experiences to AgentMemory — a cheap imitation signal.
  p.brain = new AiBrain(p, state.memory, { epsilon: 0 });
  state.player = p;
  state.cars.push(p);
}

function removePlayer() {
  if (!state.player) return;
  state.cars = state.cars.filter(c => c !== state.player);
  state.player = null;
}

function resetAll() {
  state.memory = new AgentMemory('racer-demo', { capacity: 4000, k: 7 });
  state.episodes.length = 0;
  state.heatmap = new Heatmap();
  spawnCars(state.numCars);
  state.camera = { x: 0, y: 0, z: 0 };
  try { localStorage.removeItem(LS_KEY); } catch {}
}

function newTrack() {
  state.seed = Math.floor(Math.random() * 1e9);
  state.track = buildTrack(state.seed);
  for (const c of state.cars) resetCar(c, 0);
  state.camera.z = 0;
}

function tryLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    state.memory = AgentMemory.deserialize(raw);
  } catch (e) {
    console.warn('[ruvector] localStorage restore failed:', e);
  }
}

function persist() {
  try { localStorage.setItem(LS_KEY, state.memory.serialize()); } catch {}
}

// ---------- Controls ----------
btnStart.addEventListener('click', () => {
  state.running = true;
  btnStart.textContent = 'Running…';
  btnStart.classList.remove('primary');
});
btnPause.addEventListener('click', () => {
  state.running = !state.running;
  btnPause.textContent = state.running ? 'Pause' : 'Resume';
});
btnReset.addEventListener('click', () => {
  if (!confirm('Reset AgentMemory (wipes learned experiences)?')) return;
  resetAll();
});
btnManual.addEventListener('click', () => {
  state.manual = !state.manual;
  btnManual.textContent = `Manual Drive: ${state.manual ? 'on' : 'off'}`;
  if (state.manual) addPlayer();
  else removePlayer();
});
btnTrack.addEventListener('click', newTrack);
chkOverlays.addEventListener('change', e => { state.showOverlays = e.target.checked; });
chkHeatmap.addEventListener('change', e  => { state.showHeatmap = e.target.checked; });

slCars.addEventListener('input', e => {
  state.numCars = +e.target.value;
  outCars.value = state.numCars;
  spawnCars(state.numCars);
});
slEps.addEventListener('input', e => {
  state.epsilon = +e.target.value;
  outEps.value = state.epsilon.toFixed(2);
  for (const c of state.cars) c.brain?.setEpsilon(c.isPlayer ? 0 : state.epsilon);
});
slSpd.addEventListener('input', e => {
  state.weights.speed = +e.target.value;
  outSpd.value = state.weights.speed.toFixed(2);
});
slCrh.addEventListener('input', e => {
  state.weights.crash = +e.target.value;
  outCrh.value = state.weights.crash.toFixed(1);
});

// Keyboard for manual drive.
window.addEventListener('keydown', (e) => {
  if (!state.manual || !state.player) return;
  if (e.key === 'ArrowLeft')  state.keys.left  = true;
  if (e.key === 'ArrowRight') state.keys.right = true;
  if (e.key === 'ArrowUp')    state.keys.up    = true;
  if (e.key === 'ArrowDown')  state.keys.down  = true;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft')  state.keys.left  = false;
  if (e.key === 'ArrowRight') state.keys.right = false;
  if (e.key === 'ArrowUp')    state.keys.up    = false;
  if (e.key === 'ArrowDown')  state.keys.down  = false;
});

// ---------- Loop ----------
function playerAction() {
  return {
    steer:    (state.keys.left ? -1 : 0) + (state.keys.right ? 1 : 0),
    throttle: state.keys.up   ? 1 : 0.2,
    brake:    state.keys.down ? 1 : 0,
  };
}

function frame(now) {
  const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.fps = state.fps * 0.9 + (1 / Math.max(dt, 0.001)) * 0.1;

  if (state.running) step(dt);
  render();

  requestAnimationFrame(frame);
}

function step(dt) {
  // Leader car = fastest along track → camera follows it.
  let leader = state.cars[0];
  for (const c of state.cars) if (c.z > leader.z) leader = c;
  // If manual driving, player takes the camera.
  if (state.manual && state.player) leader = state.player;

  // Controls + physics.
  for (const car of state.cars) {
    if (car.isPlayer) {
      const action = playerAction();
      car.steer    = action.steer;
      car.throttle = action.throttle;
      car.brake    = action.brake;
      // Observe so the player's driving lands in AgentMemory too.
      car.brain.observeExternalAction(state.track, state.cars, state.weights, action);
    } else {
      car.brain.step(state.track, state.cars, state.weights, dt);
    }
  }
  for (const car of state.cars) {
    updateCar(car, state.track, dt, state.cars);
    if (car.crashed) state.heatmap.add({ x: car.x, z: car.z });
    // Episode boundary = each crash or lap.
    if (car.crashed || car._justLapped) {
      const avgReward = car.brain?.avgReward() ?? 0;
      state.episodes.push({
        t: performance.now(),
        carId: car.id,
        avgReward,
        lap: car.lap,
        crashes: car.crashCount,
      });
      if (state.episodes.length > 500) state.episodes.shift();
    }
  }

  // Camera chases leader.
  state.camera.z = leader.z;
  state.camera.x = leader.x;
  state.camera.y = 0;

  // Periodic persistence (every ~5s).
  if ((performance.now() % 5000) < 40) persist();
  state.heatmap.prune();
}

function render() {
  const w = canvas.width, h = canvas.height;
  renderRoad(ctx, state.track, state.camera, { width: w, height: h, cars: state.cars });

  if (state.showHeatmap) {
    state.heatmap.draw(ctx, state.track, state.camera, w, h);
  }

  if (state.showOverlays) {
    for (const car of state.cars) drawCarOverlays(ctx, car, w, h, { showSensors: true });
    // Only draw ghost trajectories for the leader to avoid visual noise.
    const leader = [...state.cars].sort((a, b) => (b._screen?.scale || 0) - (a._screen?.scale || 0))[0];
    if (leader) drawGhostTrajectories(ctx, leader, state.track, state.camera, w, h);
  }

  drawHUD(ctx, {
    fps: state.fps,
    queryMs: state.memory.stats.queryLatencyMsEma,
    experiences: state.memory.experiences.length,
    clusters: state.memory.clusters.length,
    avgReward: state.memory.stats.meanReward,
  });

  renderSidebar({
    memoryEl, pipelineEl, carsEl, chart,
    memory: state.memory, cars: state.cars, aiEpisodes: state.episodes,
  });
}

// ---------- Boot ----------
tryLoad();
spawnCars(state.numCars);
requestAnimationFrame(frame);

window.addEventListener('beforeunload', persist);

// Expose for debugging in devtools.
window.__ruvectorDemo = state;
