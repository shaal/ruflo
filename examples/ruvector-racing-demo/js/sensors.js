// Sensor model — cheap ray casts in "road space" instead of full 3D.
// Each ray samples forward segments at a heading offset and reports how far
// it can go before the predicted road position at that distance falls off
// the drivable strip (|x| > 1) or hits another car.

import { SEG_LENGTH, findSegment } from './road.js';

// Ray angles (radians) relative to car heading. Negative = left.
export const RAY_ANGLES = [
  -0.55, -0.30, -0.12, 0.0, 0.12, 0.30, 0.55,
];

const MAX_LOOKAHEAD = 4000;    // world units
const STEP          = SEG_LENGTH / 2;

// Predict the *road-center* curvature offset at lookahead distance L.
// We integrate segment curvature twice (double-integral of lateral accel)
// which is the same trick the renderer uses to curve the road on screen.
export function projectRoadOffset(track, startZ, lookahead) {
  const segs = track.segments;
  const startIdx = findSegment(track, startZ).index;
  let x = 0;
  let dx = 0;
  const count = Math.floor(lookahead / SEG_LENGTH);
  for (let i = 0; i < count; i++) {
    const seg = segs[(startIdx + i) % segs.length];
    x += dx;
    dx += seg.curve;
  }
  // Normalize relative to ROAD_WIDTH the same way the renderer does.
  return { x, dx, segIdx: (startIdx + count) % segs.length };
}

// Cast one ray. Returns { distance, hitCar } where distance ∈ [0..1]
// (1 = full MAX_LOOKAHEAD, 0 = immediately blocked).
export function castRay(track, car, angle, others) {
  let d = 0;
  const segStart = findSegment(track, car.z).index;
  let accumX = car.x;
  let dx = Math.sin(angle);
  let prevCurve = 0;

  while (d < MAX_LOOKAHEAD) {
    d += STEP;
    const seg = track.segments[(segStart + Math.floor(d / SEG_LENGTH)) % track.segments.length];
    // Road drifts laterally by curve; the ray drifts by sin(angle).
    prevCurve += seg.curve * 0.01;
    accumX += dx * (STEP / SEG_LENGTH) * 0.6 - prevCurve * 0.02;

    if (Math.abs(accumX) > 1.05) {
      return { distance: d / MAX_LOOKAHEAD, hitCar: false, lateral: accumX };
    }
    // Car in front check
    for (const o of others) {
      if (o === car) continue;
      const relZ = ((o.z - car.z) + track.length) % track.length;
      if (Math.abs(relZ - d) < STEP * 0.6 && Math.abs(o.x - accumX) < 0.22) {
        return { distance: d / MAX_LOOKAHEAD, hitCar: true, lateral: accumX };
      }
    }
  }
  return { distance: 1, hitCar: false, lateral: accumX };
}

// Full sensor bundle consumed by the AI brain + overlays.
export function senseCar(track, car, others) {
  const rays = RAY_ANGLES.map((a) => ({ angle: a, ...castRay(track, car, a, others) }));

  const seg = findSegment(track, car.z);
  const ahead50  = projectRoadOffset(track, car.z, 50 * SEG_LENGTH);
  const ahead150 = projectRoadOffset(track, car.z, 150 * SEG_LENGTH);

  return {
    rays,
    roadOffset: car.x,
    speedNorm: car.speed / 12000,   // ≈ [0..1]
    curvature: seg.curve,
    curveAhead50: ahead50.dx,
    curveAhead150: ahead150.dx,
    offRoad: Math.abs(car.x) > 1 ? 1 : 0,
    hillGrad: (track.segments[(seg.index + 10) % track.segments.length].p2.world.y -
               seg.p2.world.y) / (10 * SEG_LENGTH),
  };
}
