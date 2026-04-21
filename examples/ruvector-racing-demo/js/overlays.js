// Visual learning overlays — drawn on the same scene canvas after the road
// + cars render, plus sidebar DOM updates for AgentMemory / pipeline stats.

import { RAY_ANGLES } from './sensors.js';
import { SEG_LENGTH, projectPoint } from './road.js';

const CRASH_HEATMAP_MAX = 200;

export function drawCarOverlays(ctx, car, width, height, { showSensors = true } = {}) {
  if (!car._screen) return;
  const scr = car._screen;
  const rays = car.brain?.lastState?.raw?.rays;
  if (!rays) return;

  if (showSensors) {
    // Sensor rays — color by confidence (green→red).
    const conf = car.brain?.lastRecall?.confidence ?? 0;
    for (let i = 0; i < rays.length; i++) {
      const ray = rays[i];
      const len = 40 + ray.distance * 120;
      const ang = -Math.PI / 2 + RAY_ANGLES[i];
      const x2 = scr.x + Math.cos(ang) * len;
      const y2 = scr.y - scr.h * 0.6 + Math.sin(ang) * len;
      const g = Math.floor(255 * ray.distance);
      const r = 255 - g;
      ctx.strokeStyle = ray.hitCar
        ? `rgba(255,120,120,${0.5 + 0.5 * conf})`
        : `rgba(${r},${g},120,${0.35 + 0.55 * ray.distance})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(scr.x, scr.y - scr.h * 0.6);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  // Confidence bar above the car.
  if (car.brain) {
    const conf = car.brain.lastRecall?.confidence ?? 0;
    const bw = Math.max(24, scr.w * 0.8);
    const bx = scr.x - bw / 2;
    const by = scr.y - scr.h - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#ff6b7a');
    grad.addColorStop(1, '#7dffb1');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw * conf, 3);

    // Car label (gen + maturity)
    ctx.fillStyle = '#fff';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${car.label} • Gen ${car.gen}`, scr.x, by - 4);
  }
}

// Draw faint "ghost" trajectories — project each recalled neighbor's
// next-state ray distances forward from the car's current screen position.
export function drawGhostTrajectories(ctx, car, track, camera, width, height) {
  const recall = car.brain?.lastRecall;
  if (!recall || !car._screen) return;

  const baseX = car._screen.x;
  const baseY = car._screen.y - car._screen.h * 0.5;

  const neighbors = recall.neighbors.slice(0, 3);
  for (let i = 0; i < neighbors.length; i++) {
    const { sim, exp } = neighbors[i];
    const alpha = 0.18 + 0.25 * sim;
    ctx.strokeStyle = `rgba(109,224,255,${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);

    // Use the recalled neighbor's ray profile to trace a forward curve.
    const rays = exp.state.slice(0, 7); // distances
    let px = baseX, py = baseY;
    for (let k = 0; k < rays.length; k++) {
      const ang = -Math.PI / 2 + RAY_ANGLES[k] * 0.6;
      const len = 20 + rays[k] * 110 * (1 + i * 0.1);
      px += Math.cos(ang) * len * 0.5;
      py += Math.sin(ang) * len * 0.5;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

// Crash heatmap — fixed-size ring buffer of { x, z }.
export class Heatmap {
  constructor() { this.points = []; }
  add(p) {
    this.points.push({ ...p, t: performance.now() });
    if (this.points.length > CRASH_HEATMAP_MAX) this.points.shift();
  }
  draw(ctx, track, camera, width, height) {
    const now = performance.now();
    for (const p of this.points) {
      const worldX = p.x * 1000; // ROAD_WIDTH / 2 — heatmap uses car.x
      const worldZ = p.z;
      const proj = projectPoint(worldX, worldZ, camera, width, height);
      if (!proj) continue;
      const age = (now - p.t) / 20000; // fade over 20s
      const a = Math.max(0, 0.55 - age * 0.55);
      if (a <= 0) continue;
      const r = Math.max(6, 40 * proj.scale);
      const g = ctx.createRadialGradient(proj.x, proj.y, 1, proj.x, proj.y, r);
      g.addColorStop(0, `rgba(255,80,80,${a})`);
      g.addColorStop(1, 'rgba(255,80,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  prune(maxAgeMs = 60_000) {
    const now = performance.now();
    this.points = this.points.filter(p => now - p.t < maxAgeMs);
  }
}

// HUD in top-left of the scene canvas.
export function drawHUD(ctx, { fps, queryMs, experiences, clusters, avgReward }) {
  ctx.save();
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  const lines = [
    `FPS ${fps.toFixed(0)}   RuVector query ${queryMs.toFixed(2)} ms`,
    `exp ${experiences}   clusters ${clusters}   avgR ${avgReward.toFixed(2)}`,
  ];
  const pad = 6, w = 320, h = lines.length * 14 + pad * 2;
  ctx.fillStyle = 'rgba(12,18,40,0.7)';
  ctx.fillRect(10, 10, w, h);
  ctx.strokeStyle = 'rgba(109,224,255,0.4)';
  ctx.strokeRect(10.5, 10.5, w, h);
  ctx.fillStyle = '#e7ecff';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 10 + pad, 10 + pad + 11 + i * 14);
  }
  ctx.restore();
}

// Sidebar panels — plain DOM for simplicity.
export function renderSidebar({ memoryEl, pipelineEl, carsEl, chart, memory, cars, aiEpisodes }) {
  const snap = memory.snapshot();
  memoryEl.innerHTML = `
    <div class="row"><span class="k">Experiences</span><span class="v">${snap.size.toLocaleString()} / ${snap.capacity.toLocaleString()}</span></div>
    <div class="row"><span class="k">Total stored</span><span class="v">${snap.total.toLocaleString()}</span></div>
    <div class="row"><span class="k">GNN clusters</span><span class="v">${snap.clusters}</span></div>
    <div class="row"><span class="k">Mean reward</span><span class="v">${snap.meanReward.toFixed(3)}</span></div>
    <div class="row"><span class="k">Recall latency</span><span class="v">${snap.queryLatencyMs.toFixed(2)} ms</span></div>
  `;

  pipelineEl.innerHTML = `
    <div class="row"><span class="k">RETRIEVE</span><span class="v">top-k cosine over ${snap.size} vectors</span></div>
    <div class="row"><span class="k">JUDGE</span><span class="v">reward-weighted blend</span></div>
    <div class="row"><span class="k">DISTILL</span><span class="v">${snap.deepLoopInserts} deep-loop inserts</span></div>
    <div class="row"><span class="k">CONSOLIDATE</span><span class="v">${snap.consolidations} passes</span></div>
  `;

  carsEl.innerHTML = cars.map((c) => {
    const avgR = c.brain?.avgReward().toFixed(2) ?? '–';
    const conf = Math.round((c.brain?.lastRecall?.confidence || 0) * 100);
    return `
      <div class="car-row">
        <span class="swatch" style="background:${c.color}"></span>
        <div>
          <div class="label">${c.label} ${c.isPlayer ? '(you)' : ''} • Gen ${c.gen}</div>
          <div class="meta">lap ${c.lap} • crashes ${c.crashCount} • avgR ${avgR} • conf ${conf}%</div>
          <div class="bar"><i style="width:${Math.round(c.maturity * 100)}%"></i></div>
        </div>
        <span class="meta">${c.bestLapTime ? c.bestLapTime.toFixed(1) + 's' : '–'}</span>
      </div>
    `;
  }).join('');

  drawRewardChart(chart, aiEpisodes);
}

function drawRewardChart(canvas, episodes) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f1630';
  ctx.fillRect(0, 0, w, h);

  if (episodes.length < 2) {
    ctx.fillStyle = '#8a93b5';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('waiting for episodes…', 10, 20);
    return;
  }

  const xs = episodes.slice(-60);
  const vals = xs.map(e => e.avgReward);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(0.001, max - min);

  // grid
  ctx.strokeStyle = '#1e2a55';
  ctx.lineWidth = 1;
  for (let g = 0; g < 5; g++) {
    const y = (h - 16) * (g / 4) + 4;
    ctx.beginPath();
    ctx.moveTo(6, y); ctx.lineTo(w - 6, y);
    ctx.stroke();
  }

  // line
  ctx.strokeStyle = '#6de0ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const x = 6 + (w - 12) * (i / Math.max(1, xs.length - 1));
    const y = 4 + (h - 20) * (1 - (vals[i] - min) / range);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#8a93b5';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(`avg reward (last ${xs.length})`, 8, h - 4);
  ctx.textAlign = 'right';
  ctx.fillText(max.toFixed(2), w - 6, 12);
  ctx.fillText(min.toFixed(2), w - 6, h - 4);
}
