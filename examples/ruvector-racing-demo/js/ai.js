// AI brain — wraps RuVector's AgentMemory with a state encoder, action
// selector, reward shaping, and episodic trajectory buffer.
//
// State vector layout (18-dim):
//   [0..6]   ray distances        (7 values, 0..1, length MAX_LOOKAHEAD)
//   [7..13]  ray-hit-car flags    (0 or 1)
//   [14]     roadOffset           (-1..1 typical, clamped)
//   [15]     speedNorm            (0..1)
//   [16]     curveAhead50         (normalized)
//   [17]     curveAhead150        (normalized)

import { senseCar, RAY_ANGLES } from './sensors.js';
import { AgentMemory } from './ruvector.js';

export const STATE_DIM = 18;

export function encodeState(track, car, others) {
  const s = senseCar(track, car, others);
  const v = new Array(STATE_DIM).fill(0);
  for (let i = 0; i < s.rays.length; i++) {
    v[i]     = s.rays[i].distance;
    v[7 + i] = s.rays[i].hitCar ? 1 : 0;
  }
  v[14] = Math.max(-1.5, Math.min(1.5, s.roadOffset));
  v[15] = Math.max(0, Math.min(1, s.speedNorm));
  v[16] = Math.max(-2, Math.min(2, s.curveAhead50));
  v[17] = Math.max(-2, Math.min(2, s.curveAhead150));
  return { vec: v, raw: s };
}

// Reward shaping — separated so hyperparameters from the sliders can tune it.
export function calculateReward(car, prevState, nextState, weights, dtDistance) {
  const speed = nextState.raw.speedNorm;
  const off   = Math.abs(nextState.raw.roadOffset) > 1 ? 1 : 0;
  const near  = Math.min(...nextState.raw.rays.map(r => r.distance));
  let reward = 0;

  reward += (dtDistance / 200) * weights.speed;        // progress
  reward += speed * 0.2 * weights.speed;               // maintain speed
  reward -= off * 2.0;                                 // off road
  reward -= Math.max(0, 0.15 - near) * 6;              // imminent danger
  if (car.crashed) reward -= weights.crash;
  // centering bonus
  reward += (1 - Math.abs(nextState.raw.roadOffset)) * 0.05;
  return reward;
}

export class AiBrain {
  constructor(car, memory, { epsilon = 0.25 } = {}) {
    this.car = car;
    this.memory = memory;         // shared AgentMemory (or per-car)
    this.epsilon = epsilon;
    this.lastState = null;
    this.lastAction = null;
    this.lastDistance = car.distance;
    this.recentRewards = [];
    this.lastRecall = null;       // for overlays
    this.tick = 0;
  }

  // Called each frame before updateCar. Sets car.steer/throttle/brake.
  step(track, others, weights, dt) {
    const state = encodeState(track, this.car, others);

    // Reward for the *previous* action (if any).
    if (this.lastState && this.lastAction) {
      const dDist = this.car.distance - this.lastDistance;
      const r = calculateReward(this.car, this.lastState, state, weights, dDist);
      this.memory.storeExperience({
        state: this.lastState.vec,
        action: this.lastAction,
        reward: r,
        nextState: state.vec,
        done: this.car.crashed,
        meta: { carId: this.car.id, tick: this.tick },
      });
      this.recentRewards.push(r);
      if (this.recentRewards.length > 200) this.recentRewards.shift();
    }

    // Pick an action.
    const action = this._selectAction(state);
    this.car.steer    = action.steer;
    this.car.throttle = action.throttle;
    this.car.brake    = action.brake;

    this.lastState = state;
    this.lastAction = action;
    this.lastDistance = this.car.distance;

    // Consolidate on crash (SONA deep loop).
    if (this.car.crashed) {
      const res = this.memory.consolidate({ deepLoopK: 10 });
      this.car.gen++;
      this.car.maturity = Math.min(1, this.car.maturity + 0.05);
      this.car._lastConsolidate = res;
    }
    // Periodic background learning.
    this.tick++;
    if (this.tick % 600 === 0) {
      this.memory.consolidate({ deepLoopK: 6 });
      this.car.maturity = Math.min(1, this.car.maturity + 0.02);
    }
  }

  _selectAction(state) {
    // ε-greedy exploration
    if (Math.random() < this.epsilon) {
      this.lastRecall = null;
      return randomAction();
    }
    const blended = this.memory.blendActionFromRecall(state.vec, 5);
    if (!blended) {
      this.lastRecall = null;
      return randomAction();
    }
    this.lastRecall = blended;

    // Small exploration noise even when exploiting — scaled by (1 - confidence).
    const noise = (1 - blended.confidence) * 0.3;
    return {
      steer:    clamp(blended.steer    + (Math.random() - 0.5) * noise, -1, 1),
      throttle: clamp(blended.throttle + (Math.random() - 0.5) * noise * 0.5, 0, 1),
      brake:    clamp(blended.brake    + (Math.random() - 0.5) * noise * 0.3, 0, 1),
    };
  }

  setEpsilon(e) { this.epsilon = e; }

  // Used by the manual-drive path: observe current state + externally-chosen
  // action so the player's demonstrations also land in AgentMemory with the
  // correct action attribution (imitation learning signal).
  observeExternalAction(track, others, weights, action) {
    const state = encodeState(track, this.car, others);
    if (this.lastState && this.lastAction) {
      const dDist = this.car.distance - this.lastDistance;
      const r = calculateReward(this.car, this.lastState, state, weights, dDist);
      this.memory.storeExperience({
        state: this.lastState.vec,
        action: this.lastAction,
        reward: r,
        nextState: state.vec,
        done: this.car.crashed,
        meta: { carId: this.car.id, source: 'player', tick: this.tick },
      });
      this.recentRewards.push(r);
      if (this.recentRewards.length > 200) this.recentRewards.shift();
    }
    this.lastState = state;
    this.lastAction = { ...action };
    this.lastDistance = this.car.distance;
    this.tick++;
  }

  avgReward() {
    if (!this.recentRewards.length) return 0;
    let s = 0;
    for (const r of this.recentRewards) s += r;
    return s / this.recentRewards.length;
  }
}

function randomAction() {
  // Biased random: usually accelerate, sometimes brake.
  const t = Math.random();
  return {
    steer:    (Math.random() - 0.5) * 1.8,
    throttle: t < 0.85 ? 0.6 + Math.random() * 0.4 : 0,
    brake:    t < 0.05 ? 0.5 + Math.random() * 0.5 : 0,
  };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
