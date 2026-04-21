// Car physics + entity. Keeps the update minimal so the AI + manual driver
// can share the same control surface (steer, throttle, brake ∈ [-1..1]).

import { ROAD_WIDTH, SEG_LENGTH, findSegment } from './road.js';

const MAX_SPEED = SEG_LENGTH * 60;        // world units per second
const ACCEL     = MAX_SPEED / 5;
const BRAKE     = -MAX_SPEED;
const DECEL     = -MAX_SPEED / 5;
const OFFROAD_DECEL = -MAX_SPEED / 2;
const OFFROAD_LIMIT = MAX_SPEED / 4;
const CENTRIFUGAL   = 0.3;

const COLORS = [
  '#ff4757', '#2ed573', '#1e90ff', '#ffa502',
  '#9b59b6', '#e67e22', '#f1c40f', '#00d2d3',
];

export function createCar(id, opts = {}) {
  return {
    id,
    color: opts.color || COLORS[id % COLORS.length],
    label: opts.label || `AI-${id}`,
    isPlayer: !!opts.isPlayer,

    x: 0,                // -1..1 across road
    z: opts.z || 0,      // world distance
    speed: 0,
    // controls (set each frame before update)
    steer: 0,            // -1..1
    throttle: 0,         // 0..1
    brake: 0,            // 0..1

    // stats
    distance: 0,         // total distance traveled (for reward)
    lap: 0,
    lapStartDistance: 0,
    bestLapTime: null,
    lastLapTime: null,
    _lapStartT: 0,
    crashed: false,
    crashCount: 0,
    offRoadTicks: 0,

    // AI hooks
    brain: null,         // AiBrain instance (or null for manual)
    gen: 0,              // "generations" — increments on consolidate
    maturity: 0,         // 0..1 learning maturity proxy
    lastCrashAt: null,   // { x, z }
  };
}

export function resetCar(car, startZ = 0) {
  car.x = 0;
  car.z = startZ;
  car.speed = 0;
  car.steer = 0;
  car.throttle = 0;
  car.brake = 0;
  car.crashed = false;
  car.offRoadTicks = 0;
}

// Step physics by dt seconds.
export function updateCar(car, track, dt, others = []) {
  const seg = findSegment(track, car.z);
  const speedFrac = car.speed / MAX_SPEED;

  // Longitudinal
  if (car.throttle > 0) {
    car.speed += ACCEL * car.throttle * dt;
  } else {
    car.speed += DECEL * dt;
  }
  if (car.brake > 0) car.speed += BRAKE * car.brake * dt;

  // Steering
  const dx = (car.steer * dt * 2 * speedFrac);
  car.x += dx;

  // Centrifugal push from curves.
  car.x -= (dx * speedFrac * seg.curve * CENTRIFUGAL);

  // Off-road handling
  if (Math.abs(car.x) > 1) {
    if (car.speed > OFFROAD_LIMIT) car.speed += OFFROAD_DECEL * dt;
    car.offRoadTicks++;
  } else {
    car.offRoadTicks = Math.max(0, car.offRoadTicks - 1);
  }

  // Collisions with other cars on same/adjacent segments.
  // Account for track wrap by measuring the shorter signed delta in z.
  car.crashed = false;
  for (const other of others) {
    if (other === car) continue;
    let dz = other.z - car.z;
    if (dz >  track.length / 2) dz -= track.length;
    if (dz < -track.length / 2) dz += track.length;
    if (dz > 0 && dz < 400 && Math.abs(other.x - car.x) < 0.22 && car.speed > other.speed) {
      car.speed = other.speed * 0.6;
      car.crashed = true;
      car.crashCount++;
      car.lastCrashAt = { x: car.x, z: car.z };
    }
  }

  // Clamp / advance
  car.speed = Math.max(0, Math.min(car.speed, MAX_SPEED));
  car.x = Math.max(-2, Math.min(2, car.x));
  const delta = car.speed * dt;
  car.z = (car.z + delta + track.length) % track.length;
  car.distance += delta;

  // Lap detection (crossed z=0 wrapping point).
  car._justLapped = false;
  const lapLenDist = track.length;
  if (car.distance - car.lapStartDistance >= lapLenDist) {
    const now = performance.now();
    car.lastLapTime = (now - car._lapStartT) / 1000;
    if (car.bestLapTime == null || car.lastLapTime < car.bestLapTime) {
      car.bestLapTime = car.lastLapTime;
    }
    car._lapStartT = now;
    car.lapStartDistance = car.distance;
    car.lap++;
    car._justLapped = true;
  }
}

export function carFacts() {
  return { MAX_SPEED, ACCEL, ROAD_WIDTH };
}
