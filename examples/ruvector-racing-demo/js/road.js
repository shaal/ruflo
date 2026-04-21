// Pseudo-3D road engine — faithful to Jake Gordon's v4 technique.
// Each segment has a pair of world-space points (p1, p2) along z.
// Segments can carry a horizontal curve and a vertical hill increment.

export const SEG_LENGTH = 200;        // world units per road segment
export const RUMBLE_LEN = 3;          // segments per rumble stripe
export const ROAD_WIDTH = 2000;       // world units (half = lane boundary)
export const CAMERA_HEIGHT = 1000;    // camera y above road
export const CAMERA_DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180); // fov 100
export const DRAW_DIST = 220;         // segments to project per frame

const COLOR_SETS = {
  light: { road: '#4a4a5a', grass: '#2e5a3a', rumble: '#eaeaea', lane: '#ffffff' },
  dark:  { road: '#3e3e50', grass: '#26513a', rumble: '#b83c3c', lane: '#3e3e50' },
  start: { road: '#ffffff', grass: '#2e5a3a', rumble: '#ffffff', lane: '#ffffff' },
};

// Mulberry32 PRNG so tracks are reproducible by seed.
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTrack(seed = 1) {
  const rand = rng(seed);
  const segments = [];

  function lastY() {
    return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
  }

  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n,
      curve,
      p1: { world: { y: lastY(), z: n * SEG_LENGTH }, camera: {}, screen: {} },
      p2: { world: { y,          z: (n + 1) * SEG_LENGTH }, camera: {}, screen: {} },
      color: (Math.floor(n / RUMBLE_LEN) % 2) ? COLOR_SETS.dark : COLOR_SETS.light,
      cars: [],
    });
  }

  // Smooth ease-in-out helpers for curves / hills.
  function easeIn(a, b, p)    { return a + (b - a) * Math.pow(p, 2); }
  function easeOut(a, b, p)   { return a + (b - a) * (1 - Math.pow(1 - p, 2)); }
  function easeInOut(a, b, p) { return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5); }

  function addRoad(enter, hold, leave, curve, height) {
    const startY = lastY();
    const endY = startY + height;
    const total = enter + hold + leave;
    for (let i = 0; i < enter; i++) {
      addSegment(easeIn(0, curve, i / enter), easeInOut(startY, endY, i / total));
    }
    for (let i = 0; i < hold; i++) {
      addSegment(curve, easeInOut(startY, endY, (enter + i) / total));
    }
    for (let i = 0; i < leave; i++) {
      addSegment(easeInOut(curve, 0, i / leave), easeInOut(startY, endY, (enter + hold + i) / total));
    }
  }

  function addStraight(n = 50) { addRoad(n, n, n, 0, 0); }
  function addCurve(n = 30, curve = 2, height = 0) { addRoad(n, n, n, curve, height); }
  function addHill(n = 30, height = 60) { addRoad(n, n, n, 0, height); }
  function addLowRollingHills(n = 20, h = 20) {
    addRoad(n, n, n, 0, h / 2);
    addRoad(n, n, n, 0, -h);
    addRoad(n, n, n, 0, h);
    addRoad(n, n, n, 0, 0);
    addRoad(n, n, n, 0, h / 2);
    addRoad(n, n, n, 0, 0);
  }

  addStraight(30);
  addLowRollingHills();
  addCurve(30, -2, 20);
  addHill(40, 80);
  addCurve(40, 3, -20);
  addStraight(20);
  addCurve(40, -3, 40);
  addHill(40, -40);
  addLowRollingHills();
  addCurve(30, 2, 0);
  addStraight(30);

  // Procedural tail for replayability per seed.
  for (let i = 0; i < 6; i++) {
    const c = (rand() * 6 - 3);
    const h = (rand() * 80 - 40);
    addCurve(20 + Math.floor(rand() * 30), c, h);
    if (rand() < 0.4) addStraight(20);
  }
  addStraight(40);

  // Mark start/finish.
  for (let i = 0; i < RUMBLE_LEN; i++) segments[i].color = COLOR_SETS.start;
  for (let i = segments.length - RUMBLE_LEN; i < segments.length; i++) segments[i].color = COLOR_SETS.start;

  return {
    segments,
    length: segments.length * SEG_LENGTH,
    trackLengthSeg: segments.length,
    seed,
  };
}

export function findSegment(track, z) {
  const n = track.segments.length;
  return track.segments[Math.floor(((z % track.length) + track.length) % track.length / SEG_LENGTH) % n];
}

function project(p, camX, camY, camZ, camDepth, w, h) {
  p.camera.x = (p.world.x || 0) - camX;
  p.camera.y = (p.world.y || 0) - camY;
  p.camera.z = (p.world.z || 0) - camZ;
  p.screen.scale = camDepth / p.camera.z;
  p.screen.x = (w / 2) + (p.screen.scale * p.camera.x * w / 2);
  p.screen.y = (h / 2) - (p.screen.scale * p.camera.y * h / 2);
  p.screen.w = (p.screen.scale * ROAD_WIDTH * w / 2);
}

function drawPolygon(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function drawSegment(ctx, w, h, lanes, x1, y1, w1, x2, y2, w2, color) {
  const r1 = w1 / Math.max(6, 2 * lanes);
  const r2 = w2 / Math.max(6, 2 * lanes);
  const l1 = w1 / Math.max(32, 8 * lanes);
  const l2 = w2 / Math.max(32, 8 * lanes);

  ctx.fillStyle = color.grass;
  ctx.fillRect(0, y2, w, y1 - y2);

  drawPolygon(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, color.rumble);
  drawPolygon(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, color.rumble);
  drawPolygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, color.road);

  if (color.lane !== color.road) {
    const lanew1 = (w1 * 2) / lanes;
    const lanew2 = (w2 * 2) / lanes;
    let lanex1 = x1 - w1;
    let lanex2 = x2 - w2;
    for (let lane = 1; lane < lanes; lane++) {
      lanex1 += lanew1;
      lanex2 += lanew2;
      drawPolygon(ctx, lanex1 - l1 / 2, y1, lanex1 + l1 / 2, y1,
                       lanex2 + l2 / 2, y2, lanex2 - l2 / 2, y2, color.lane);
    }
  }
}

export function renderRoad(ctx, track, camera, opts = {}) {
  const { width, height, cars = [] } = opts;
  const baseSegment = findSegment(track, camera.z);
  const basePercent = ((camera.z % SEG_LENGTH) + SEG_LENGTH) % SEG_LENGTH / SEG_LENGTH;
  const maxY = height;

  // Sky + ground
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.6);
  sky.addColorStop(0, '#0a1238');
  sky.addColorStop(1, '#3e6ab0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  let x = 0;
  let dx = -(baseSegment.curve * basePercent);
  let maxYOut = height;

  // Attach cars to segments (clear & re-bucket this frame).
  for (const seg of track.segments) seg.cars.length = 0;
  for (const car of cars) {
    const seg = findSegment(track, car.z);
    seg.cars.push(car);
  }

  for (let n = 0; n < DRAW_DIST; n++) {
    const seg = track.segments[(baseSegment.index + n) % track.segments.length];
    const looped = seg.index < baseSegment.index ? track.length : 0;

    project(seg.p1, camera.x * ROAD_WIDTH - x, camera.y + CAMERA_HEIGHT, camera.z - looped, CAMERA_DEPTH, width, height);
    project(seg.p2, camera.x * ROAD_WIDTH - x - dx, camera.y + CAMERA_HEIGHT, camera.z - looped, CAMERA_DEPTH, width, height);

    x += dx;
    dx += seg.curve;

    if (seg.p1.camera.z <= CAMERA_DEPTH ||
        seg.p2.screen.y >= seg.p1.screen.y ||
        seg.p2.screen.y >= maxYOut) continue;

    drawSegment(ctx, width, height, 3,
      seg.p1.screen.x, seg.p1.screen.y, seg.p1.screen.w,
      seg.p2.screen.x, seg.p2.screen.y, seg.p2.screen.w,
      seg.color);

    maxYOut = seg.p2.screen.y;
  }

  // Cars: draw back-to-front so near ones overlap far ones.
  for (let n = DRAW_DIST - 1; n >= 0; n--) {
    const seg = track.segments[(baseSegment.index + n) % track.segments.length];
    for (const car of seg.cars) drawCar(ctx, seg, car, width, height);
  }
}

function drawCar(ctx, seg, car, w, h) {
  const scale = seg.p1.screen.scale;
  const x = seg.p1.screen.x + scale * car.x * ROAD_WIDTH * w / 2;
  const y = seg.p1.screen.y;
  const cw = scale * 1.5 * ROAD_WIDTH * w / 2 * 0.12;
  const ch = cw * 0.75;
  if (cw < 1) return;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, cw * 0.5, ch * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  ctx.fillStyle = car.color;
  ctx.fillRect(x - cw * 0.5, y - ch, cw, ch * 0.85);
  // windshield
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - cw * 0.38, y - ch * 0.85, cw * 0.76, ch * 0.4);
  // label
  if (car.label && cw > 24) {
    ctx.fillStyle = '#fff';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(car.label, x, y - ch - 4);
  }

  // cache projection for overlay use
  car._screen = { x, y, w: cw, h: ch, scale };
}

// Utility — used by overlays to project an arbitrary (x,z) world point
// onto screen given the current camera. Mirrors `project()` exactly.
export function projectPoint(worldX, worldZ, camera, width, height) {
  const cx = (worldX) - camera.x * ROAD_WIDTH;
  const cy = -CAMERA_HEIGHT - camera.y;
  const cz = worldZ - camera.z;
  if (cz <= CAMERA_DEPTH) return null;
  const scale = CAMERA_DEPTH / cz;
  return {
    x: (width / 2) + (scale * cx * width / 2),
    y: (height / 2) - (scale * cy * height / 2),
    scale,
  };
}
