// Bicep-curl rep counter driven by pose landmarks (MediaPipe 33-point layout).
// Elbow angle = shoulder–elbow–wrist. A rep counts when the arm goes from extended
// (angle > DOWN) to flexed (angle < UP). Hysteresis + smoothing reject jitter.

const IDX = { left: [11, 13, 15], right: [12, 14, 16] };
const DOWN = 140; // degrees: arm extended
const UP = 65; // degrees: arm curled
const MIN_REP_MS = 600;
const MIN_VIS = 0.5;

function angle(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y];
  const v2 = [c.x - b.x, c.y - b.y];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const m = Math.hypot(...v1) * Math.hypot(...v2) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

export class CurlCounter {
  constructor(arm = 'right') {
    this.arm = arm;
    this.reset();
  }

  reset() {
    this.phase = 'unknown'; // 'down' | 'up' | 'unknown'
    this.smoothed = null;
    this.lastRepAt = 0;
    this.reps = 0;
  }

  // Returns { visible, angle, progress (0 extended → 1 curled), rep (true on the frame a rep completes) }
  update(landmarks, t = performance.now()) {
    if (!landmarks) return { visible: false };
    const [s, e, w] = IDX[this.arm].map((i) => landmarks[i]);
    const vis = Math.min(s.visibility ?? 1, e.visibility ?? 1, w.visibility ?? 1);
    if (vis < MIN_VIS) return { visible: false };

    const raw = angle(s, e, w);
    this.smoothed = this.smoothed == null ? raw : this.smoothed * 0.55 + raw * 0.45;
    const a = this.smoothed;
    let rep = false;

    if (a > DOWN) {
      this.phase = 'down';
    } else if (a < UP && this.phase === 'down') {
      this.phase = 'up';
      if (t - this.lastRepAt > MIN_REP_MS) {
        this.reps += 1;
        this.lastRepAt = t;
        rep = true;
      }
    }
    const progress = Math.max(0, Math.min(1, (170 - a) / (170 - 40)));
    return { visible: true, angle: a, progress, rep, phase: this.phase };
  }
}
