// ---------------------------------------------------------------------------
// RuVector — browser stand-in for the Rust/WASM AgentMemory + SONA + GNN.
// Mirrors the public API surface shown in the ruvector repo so this module
// can be swapped for real @ruvector/core WASM bindings when available.
//
// RU VECTOR INTEGRATION — every public method marked below is the equivalent
// of a call into the upstream Rust crate; we implement it in JS here.
// ---------------------------------------------------------------------------

// -------- Vector helpers ---------------------------------------------------

export function l2norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s) || 1;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// -------- AgentMemory -------------------------------------------------------
//
// Stores Experience records: { state, action, reward, nextState, done, meta }.
// Provides top-k cosine recall, reservoir-style capped storage, online
// consolidation, and a light GNN-style clustering pass (SONA + GNN proxies).

export class AgentMemory {
  constructor(name = 'racer-demo', opts = {}) {
    this.name = name;
    this.capacity = opts.capacity ?? 4000;
    this.experiences = [];
    this.totalStored = 0;

    // SONA-ish online stats (self-optimizing).
    this.stats = {
      meanReward: 0,
      varianceReward: 1,
      recallHits: 0,
      recallMisses: 0,
      lastConsolidate: 0,
      consolidations: 0,
      deepLoopInserts: 0,
      queryLatencyMsEma: 0,
    };

    // GNN cluster proxy — k-means in memory.
    this.clusters = [];   // [{ centroid, count, avgReward, id }]
    this.k = opts.k ?? 7;

    this._tick = 0;
  }

  // RU VECTOR INTEGRATION: AgentMemory::store_experience
  storeExperience(exp) {
    if (!exp.state || !Array.isArray(exp.state)) {
      throw new Error('storeExperience requires a numeric state vector');
    }
    this.experiences.push(exp);
    this.totalStored++;

    // Reservoir-style cap: drop oldest low-reward entries first.
    if (this.experiences.length > this.capacity) {
      const drop = Math.floor(this.capacity * 0.05);
      this.experiences.sort((a, b) => a.reward - b.reward);
      this.experiences.splice(0, drop);
    }

    // Running reward stats (Welford-lite).
    const r = exp.reward;
    const n = this.totalStored;
    const delta = r - this.stats.meanReward;
    this.stats.meanReward += delta / n;
    this.stats.varianceReward += delta * (r - this.stats.meanReward);
  }

  // RU VECTOR INTEGRATION: AgentMemory::recall (top-k cosine).
  // Returns up to k neighbors with similarity + reward.
  recall(query, k = 5, { minReward = -Infinity } = {}) {
    const t0 = performance.now();
    const heap = [];
    for (const exp of this.experiences) {
      if (exp.reward < minReward) continue;
      const sim = cosine(query, exp.state);
      if (heap.length < k) {
        heap.push({ sim, exp });
        heap.sort((a, b) => a.sim - b.sim);
      } else if (sim > heap[0].sim) {
        heap[0] = { sim, exp };
        heap.sort((a, b) => a.sim - b.sim);
      }
    }
    heap.sort((a, b) => b.sim - a.sim);
    if (heap.length) this.stats.recallHits++;
    else this.stats.recallMisses++;

    const dt = performance.now() - t0;
    this.stats.queryLatencyMsEma = this.stats.queryLatencyMsEma * 0.9 + dt * 0.1;
    return heap;
  }

  // Average the actions of the top-k recalled neighbors, weighted by
  // (sim * normalized_reward). This is the "policy head" — in the real stack
  // it would be a MicroLoRA adapter sitting on top of the vector recall.
  blendActionFromRecall(query, k = 5) {
    const neighbors = this.recall(query, k);
    if (neighbors.length === 0) return null;

    let wSum = 0;
    let steer = 0, throttle = 0, brake = 0;
    const maxR = Math.max(...neighbors.map(n => n.exp.reward));
    const minR = Math.min(...neighbors.map(n => n.exp.reward));
    const range = Math.max(1e-6, maxR - minR);

    for (const { sim, exp } of neighbors) {
      const r = (exp.reward - minR) / range;     // [0..1]
      const w = Math.max(0, sim) * (0.2 + r);
      steer    += w * exp.action.steer;
      throttle += w * exp.action.throttle;
      brake    += w * exp.action.brake;
      wSum     += w;
    }
    if (wSum === 0) return null;
    return {
      steer:    clamp(steer / wSum, -1, 1),
      throttle: clamp(throttle / wSum, 0, 1),
      brake:    clamp(brake / wSum, 0, 1),
      confidence: clamp(neighbors[0].sim, 0, 1),
      neighbors,
    };
  }

  // RU VECTOR INTEGRATION: AgentMemory::consolidate (SONA deep loop).
  // Runs when: lap complete, crash, or every N frames. Promotes high-reward
  // experiences by re-inserting a jittered copy ("replay") and rebuilds
  // the GNN clusters.
  consolidate({ deepLoopK = 12 } = {}) {
    this.stats.consolidations++;
    this.stats.lastConsolidate = this._tick;

    // Deep-loop: find top-K by reward, replay them with tiny gaussian jitter.
    const top = [...this.experiences]
      .sort((a, b) => b.reward - a.reward)
      .slice(0, deepLoopK);
    let inserts = 0;
    for (const e of top) {
      const jittered = {
        ...e,
        state: e.state.map(v => v + (Math.random() - 0.5) * 0.015),
        reward: e.reward * (0.98 + Math.random() * 0.04),
        meta: { ...(e.meta || {}), replayed: true },
      };
      this.experiences.push(jittered);
      inserts++;
    }
    this.stats.deepLoopInserts += inserts;

    // Cluster rebuild (GNN proxy).
    this._rebuildClusters();

    return { inserts, clusters: this.clusters.length };
  }

  // RU VECTOR INTEGRATION: GNN cluster rebuild. In the real stack this is
  // a graph neural net over the experience graph — here we use a few rounds
  // of k-means in the same embedding space, which is enough to visualize
  // "driving styles".
  _rebuildClusters() {
    const data = this.experiences;
    const k = Math.min(this.k, Math.max(1, Math.floor(data.length / 20)));
    if (data.length < k * 2 || k < 2) { this.clusters = []; return; }

    const dim = data[0].state.length;
    // init: pick k random distinct points
    const picks = new Set();
    while (picks.size < k) picks.add(Math.floor(Math.random() * data.length));
    const centroids = [...picks].map(i => data[i].state.slice());

    const assign = new Array(data.length).fill(0);
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 0; i < data.length; i++) {
        let best = 0, bestSim = -2;
        for (let c = 0; c < k; c++) {
          const s = cosine(data[i].state, centroids[c]);
          if (s > bestSim) { bestSim = s; best = c; }
        }
        assign[i] = best;
      }
      const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < data.length; i++) {
        const a = assign[i];
        counts[a]++;
        for (let d = 0; d < dim; d++) sums[a][d] += data[i].state[d];
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] === 0) continue;
        for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c];
      }
    }

    // Build summaries
    const summaries = Array.from({ length: k }, (_, i) => ({
      id: i,
      centroid: centroids[i],
      count: 0,
      avgReward: 0,
    }));
    for (let i = 0; i < data.length; i++) {
      const s = summaries[assign[i]];
      s.count++;
      s.avgReward += (data[i].reward - s.avgReward) / s.count;
    }
    this.clusters = summaries.filter(s => s.count > 0);
  }

  // Serialization for localStorage persistence.
  serialize() {
    return JSON.stringify({
      name: this.name,
      capacity: this.capacity,
      totalStored: this.totalStored,
      experiences: this.experiences.slice(-Math.min(2000, this.experiences.length)),
      stats: this.stats,
    });
  }
  static deserialize(str) {
    const o = JSON.parse(str);
    const m = new AgentMemory(o.name, { capacity: o.capacity });
    m.experiences = o.experiences || [];
    m.totalStored = o.totalStored || m.experiences.length;
    m.stats = { ...m.stats, ...(o.stats || {}) };
    m._rebuildClusters();
    return m;
  }

  snapshot() {
    return {
      name: this.name,
      total: this.totalStored,
      size: this.experiences.length,
      capacity: this.capacity,
      clusters: this.clusters.length,
      consolidations: this.stats.consolidations,
      deepLoopInserts: this.stats.deepLoopInserts,
      meanReward: this.stats.meanReward,
      queryLatencyMs: this.stats.queryLatencyMsEma,
    };
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
