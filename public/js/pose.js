// Pose sources. Both emit MediaPipe-style landmark arrays (33 points, normalized 0–1)
// so the rep counter and silhouette renderer run the same code either way.
//
// REAL: CameraSource runs MediaPipe Pose Landmarker on-device in the browser.
//       Video frames never leave the device and are never drawn to the screen.
// SIMULATED: SimSource synthesizes a curling figure for demos without a camera.

const MP_VER = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let landmarkerPromise = null;

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { PoseLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1, // track only the one person at the station, not bystanders
      });
      try {
        return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
      } catch {
        return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
      }
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

export class CameraSource {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.kind = 'camera';
    this.running = false;
  }

  async start() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.className = 'hidden-video';
    document.body.appendChild(this.video);

    const [landmarker, stream] = await Promise.all([
      getLandmarker(),
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      }),
    ]);
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;

    let lastTime = -1;
    const loop = () => {
      if (!this.running) return;
      if (this.video.currentTime !== lastTime) {
        lastTime = this.video.currentTime;
        const res = landmarker.detectForVideo(this.video, performance.now());
        this.onFrame(res.landmarks?.[0] || null);
      }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video?.remove();
  }
}

// Base standing pose, roughly 3/4 facing the station.
const BASE = (() => {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
  const set = (i, x, y) => (p[i] = { x, y, visibility: 0.98 });
  set(0, 0.5, 0.17); // nose
  set(11, 0.585, 0.31); set(12, 0.415, 0.31); // shoulders (11 = person's left)
  set(13, 0.64, 0.46); set(14, 0.36, 0.46); // elbows
  set(15, 0.655, 0.61); set(16, 0.345, 0.61); // wrists
  set(23, 0.555, 0.6); set(24, 0.445, 0.6); // hips
  set(25, 0.56, 0.78); set(26, 0.44, 0.78); // knees
  set(27, 0.565, 0.95); set(28, 0.435, 0.95); // ankles
  return p;
})();

export class SimSource {
  constructor(onFrame, arm = 'right') {
    this.onFrame = onFrame;
    this.arm = arm;
    this.kind = 'sim';
    this.auto = false;
    this.queued = 0;
    this.repT = null; // ms into current rep, null when resting
    this.period = 2200;
  }

  async start() {
    this.running = true;
    let prev = performance.now();
    // Background tabs throttle timers to ~1 fps, which can skip the top of a curl.
    // A burst of identical frames at each turning point keeps every rep observable.
    const burst = (theta, now) => {
      for (let i = 0; i < 6; i++) this.onFrame(this.frame(theta, now));
    };
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = now - prev;
      prev = now;
      if (this.repT == null && (this.auto || this.queued > 0)) {
        this.repT = 0;
        if (this.queued > 0) this.queued--;
      }
      let theta = 0; // forearm rotation from hanging, degrees
      if (this.repT != null) {
        const before = this.repT / this.period;
        this.repT += dt;
        const f = Math.min(1, this.repT / this.period);
        theta = 72.5 * (1 - Math.cos(2 * Math.PI * f));
        if (before < 0.5 && f >= 0.5) burst(145, now);
        if (f >= 1) {
          this.repT = null;
          burst(0, now);
        }
      }
      this.onFrame(this.frame(theta, now));
      this.timer = setTimeout(loop, 33); // ~30 fps like a real camera
    };
    loop();
  }

  oneRep() {
    this.queued++;
  }

  frame(theta, now) {
    const sway = Math.sin(now / 900) * 0.004;
    const p = BASE.map((q) => ({ ...q, x: q.x + sway + (Math.random() - 0.5) * 0.003, y: q.y + (Math.random() - 0.5) * 0.003 }));
    const [ei, wi, dir] = this.arm === 'right' ? [14, 16, -1] : [13, 15, 1];
    const e = p[ei];
    const L = 0.15;
    const r = (theta * Math.PI) / 180;
    p[wi] = { x: e.x + dir * L * Math.sin(r) * 0.55, y: e.y + L * Math.cos(r), visibility: 0.97 };
    return p;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}

// Abstract silhouette: the only visual of the person ever shown. No camera pixels.
const LIMBS = [
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

export function drawSilhouette(canvas, lm, { arm, accent, body, mirror = true }) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;

  // Fit a 3:4 portrait frame inside the canvas.
  const fh = Math.min(h, (w * 4) / 3);
  const fw = (fh * 3) / 4;
  const ox = (w - fw) / 2;
  const oy = (h - fh) / 2;
  const P = (i) => ({ x: ox + (mirror ? 1 - lm[i].x : lm[i].x) * fw, y: oy + lm[i].y * fh, v: lm[i].visibility ?? 1 });

  const thick = fh * 0.036;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // torso
  const [ls, rs, rh, lh] = [P(11), P(12), P(24), P(23)];
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  ctx.lineWidth = thick * 0.6;
  ctx.beginPath();
  ctx.moveTo(ls.x, ls.y); ctx.lineTo(rs.x, rs.y); ctx.lineTo(rh.x, rh.y); ctx.lineTo(lh.x, lh.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // neck + head
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const nose = P(0);
  const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  ctx.lineWidth = thick * 0.8;
  ctx.beginPath(); ctx.moveTo(neck.x, neck.y); ctx.lineTo(nose.x, nose.y + sw * 0.2); ctx.stroke();
  ctx.beginPath(); ctx.arc(nose.x, nose.y, Math.max(sw * 0.38, fh * 0.045), 0, Math.PI * 2); ctx.fill();

  const tracked = arm === 'right' ? [[12, 14], [14, 16]] : [[11, 13], [13, 15]];
  for (const [a, b] of LIMBS) {
    const A = P(a), B = P(b);
    if (A.v < 0.3 || B.v < 0.3) continue;
    const isTracked = tracked.some(([x, y]) => x === a && y === b);
    ctx.strokeStyle = isTracked ? accent : body;
    ctx.lineWidth = isTracked ? thick * 1.05 : thick;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  // tracked joints
  ctx.fillStyle = accent;
  for (const i of arm === 'right' ? [12, 14, 16] : [11, 13, 15]) {
    const q = P(i);
    ctx.beginPath(); ctx.arc(q.x, q.y, thick * 0.32, 0, Math.PI * 2); ctx.fill();
  }
}
