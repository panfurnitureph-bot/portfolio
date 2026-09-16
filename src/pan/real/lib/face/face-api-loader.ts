// @ts-nocheck — copied verbatim; typed against the real face-api, the demo shim is untyped
// Browser-only face-api helpers. face-api pulls in tfjs (large, browser-only),
// so it is loaded via dynamic import() — this module must only ever run in the
// browser (it's imported by client components). No "use client" needed: it's a
// plain util, not a component.

// Match threshold — euclidean distance between two 128-float descriptors below this
// counts as the same person. face-api's "strict" default is 0.5. 0.68 was too lenient —
// it FALSE-matched a different person as the enrolled one. The correct person measured
// ~0.35 on the tablet, so 0.5 comfortably accepts them while rejecting a stranger (whose
// distance sits well above 0.5). Lower = stricter (fewer false accepts). Never raise this
// to "help" a genuine person match — re-enroll on the kiosk camera instead.
export const MATCH_THRESHOLD = 0.5;

// Cache the dynamic import + the model-load promise so they run at most once.
let faceapiPromise: Promise<typeof import("@vladmandic/face-api")> | null = null;
let modelsPromise: Promise<void> | null = null;

async function getFaceApi() {
  if (!faceapiPromise) {
    faceapiPromise = import("@vladmandic/face-api");
  }
  return faceapiPromise;
}

// Force the WebGL (GPU) tfjs backend before any inference. Without this, tfjs may
// fall back to the CPU/WASM backend, which runs the nets ON THE MAIN THREAD — every
// detect blocks the requestAnimationFrame overlay draw and React updates, so the
// scanning box freezes/jumps and the recognized pop-up feels delayed. WebGL runs the
// convolutions on the GPU and keeps the main thread free, so the box tracks smoothly
// and the response is snappy. Falls back gracefully if WebGL is unavailable.
// The tfjs backend actually in use (webgl / wasm / cpu) — surfaced to the kiosk debug
// HUD so we can see whether a slow tablet fell back to CPU (10-20× slower than WebGL).
let _activeBackend = "unknown";
export function activeBackend(): string { return _activeBackend; }

// Pick the fastest AVAILABLE backend: WebGL (GPU) first; if it's missing or fails —
// common in a stripped-down tablet WebView — fall back to WASM (with SIMD auto-detected),
// which is 5-10× faster than the plain-CPU backend that tfjs would otherwise use and was
// the cause of the "scanning forever" lag. Plain CPU is the last resort. The .wasm
// binaries are self-hosted from /wasm (setWasmPaths) so no CDN is needed at runtime.
async function ensureFastBackend(faceapi: typeof import("@vladmandic/face-api")): Promise<void> {
  const tf = faceapi.tf as unknown as {
    getBackend: () => string;
    setBackend: (b: string) => Promise<boolean>;
    ready: () => Promise<void>;
    env: () => { getAsync: (f: string) => Promise<boolean> };
    setWasmPaths?: (p: string) => void;
  };
  const tryBackend = async (name: string) => {
    try {
      if (tf.getBackend() === name) { await tf.ready(); return true; }
      const ok = await tf.setBackend(name);
      if (ok) { await tf.ready(); return tf.getBackend() === name; }
    } catch { /* try the next backend */ }
    return false;
  };

  // Point the WASM backend at our self-hosted binaries before selecting it.
  try {
    const wasmApi = faceapi.tf as unknown as { setWasmPaths?: (p: string) => void };
    wasmApi.setWasmPaths?.("/wasm/");
  } catch { /* setWasmPaths may already have run; ignore */ }

  if (await tryBackend("webgl")) { _activeBackend = "webgl"; return; }
  if (await tryBackend("wasm"))  { _activeBackend = "wasm"; return; }
  try { await tf.ready(); } catch { /* ignore */ }
  try { _activeBackend = tf.getBackend(); } catch { _activeBackend = "cpu?"; }
}

// Idempotently load the three nets we need from /models. Awaiting again after
// the first call resolves immediately (the promise is cached).
export function loadFaceModels(): Promise<void> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const faceapi = await getFaceApi();
      await ensureFastBackend(faceapi);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      // Warm-up: run one throwaway inference so the first REAL detect doesn't pay the
      // WebGL shader-compile + texture-upload cold-start (a visible first-scan stall).
      try {
        const c = document.createElement("canvas");
        c.width = 160; c.height = 160;
        await faceapi.detectSingleFace(c, detOptsFast(faceapi));
      } catch { /* warm-up is best-effort */ }
    })().catch((e) => {
      // Reset so a later call can retry after a transient failure.
      modelsPromise = null;
      throw e;
    });
  }
  return modelsPromise;
}

// Detect exactly one face in a source element + compute its 128-float descriptor.
// Returns null when there is no face (and we deliberately treat the single-face
// detector's "no detection" the same as a miss). Uses TinyFaceDetectorOptions.
// Detector options. inputSize 224 is ~3-4× faster than 416 on CPU (no GPU on most
// kiosk tablets) and is plenty for a face filling the on-screen oval; the full
// landmarks+descriptor pass is the expensive part, so we keep the detector cheap.
function detOpts(faceapi: typeof import("@vladmandic/face-api")) {
  // 160: the recognition pass needs enough resolution to reliably PRODUCE a descriptor
  // and keep the distance within MATCH_THRESHOLD. 128 was too small — the detector often
  // returned a face with NO usable descriptor, so the scan sat on "Scanning…" forever
  // (faces=1 in the HUD but no match). 160 restores reliable matching, still much faster
  // than the original 224.
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 });
}

// FAST detector for the per-tick cheap pass (box overlay + mask/liveness gates). The
// recognition descriptor is NOT computed here, so a smaller inputSize (160) roughly
// halves the per-tick detection time on a GPU-less kiosk — the biggest win against
// lag — with no effect on match accuracy (the descriptor pass below still uses 224).
function detOptsFast(faceapi: typeof import("@vladmandic/face-api")) {
  // 96 (was 160→128): the per-tick box pass runs several ×/sec, so its cost dominates the
  // felt lag; on this tablet a 128 detect measured ~220ms. 96 keeps the tracking box and
  // the mask/box gate usable while cutting per-tick time hard — the biggest capture-speed
  // win now that liveness (which needed richer landmarks) is skipped.
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 96, scoreThreshold: 0.4 });
}

// Cheap "is there a face?" check — detection only, no landmarks/descriptor. Used by
// the kiosk to flip the "Scanning…" hint instantly while the heavy descriptor runs.
export async function hasFace(input: HTMLVideoElement): Promise<boolean> {
  if (!input || input.readyState < 2) return false;
  const faceapi = await getFaceApi();
  const det = await faceapi.detectSingleFace(input, detOptsFast(faceapi));
  return !!det;
}

async function descriptorFrom(
  input: HTMLVideoElement | HTMLImageElement,
): Promise<Float32Array | null> {
  const faceapi = await getFaceApi();
  const res = await faceapi
    .detectSingleFace(input, detOpts(faceapi))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!res || !res.descriptor) return null;
  return res.descriptor;
}

export function getDescriptorFromVideo(video: HTMLVideoElement): Promise<Float32Array | null> {
  if (!video || video.readyState < 2) return Promise.resolve(null);
  return descriptorFrom(video);
}

// QUALITY-GATED enrollment sample. Rejects a capture that would poison matching:
// - more/less than one face, low detector confidence, a face too small in frame
//   (too far / turned away), or a mask/sunglasses covering it.
// Returns the descriptor only when the sample is enrollment-grade, else a reason.
export type SampleResult =
  | { ok: true; descriptor: Float32Array }
  | { ok: false; reason: string };
export async function captureQualitySample(video: HTMLVideoElement): Promise<SampleResult> {
  if (!video || video.readyState < 2) return { ok: false, reason: "Camera not ready." };
  const faceapi = await getFaceApi();
  const all = await faceapi
    .detectAllFaces(video, detOpts(faceapi))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (all.length === 0) return { ok: false, reason: "No face detected. Center your face in the oval." };
  if (all.length > 1) return { ok: false, reason: "More than one face — only the person enrolling should be in frame." };
  const r = all[0];
  if (r.detection.score < 0.7) return { ok: false, reason: "Face unclear — improve lighting and hold still." };
  // Face must fill a reasonable share of the frame (guards tiny/far/turned faces).
  const frac = r.detection.box.width / (video.videoWidth || 640);
  if (frac < 0.22) return { ok: false, reason: "Move closer — your face is too small in the frame." };
  const lite: LiteDetection = {
    box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
    landmarks: r.landmarks.positions.map((p) => [p.x, p.y] as number[]),
    score: r.detection.score,
  };
  if (looksMasked(lite)) return { ok: false, reason: "Remove your face mask to enroll." };
  if (looksSunglasses(lite)) return { ok: false, reason: "Remove your sunglasses to enroll." };
  if (!r.descriptor) return { ok: false, reason: "Could not read the face — try again." };
  return { ok: true, descriptor: r.descriptor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Richer single-pass detector for the kiosk overlay/liveness/mask pipeline.
// One detect call returns everything the kiosk needs to (a) draw the tracking
// box, (b) check for a mask, (c) feed the liveness buffer, AND (d) match — so we
// avoid running the detector + landmark + descriptor nets three separate times.
//
// Coordinates: `box` and `landmarks` are in the source video's INTRINSIC pixel
// space (video.videoWidth × video.videoHeight). The kiosk scales them to the
// displayed element and mirrors X (the <video> is rendered with scaleX(-1)).
// ─────────────────────────────────────────────────────────────────────────────
export type FullDetection = {
  box: { x: number; y: number; width: number; height: number };
  landmarks: number[][]; // 68 [x,y] points in video-intrinsic pixels
  descriptor: Float32Array;
  score: number;         // detector confidence 0..1
};

// CHEAP per-tick pass: detection + landmarks ONLY (no 128-float descriptor).
// The expensive recognition net does NOT run here. This is enough to draw the
// tracking box, run looksMasked, and feed the liveness buffer every fast tick.
// Same shape as FullDetection minus `descriptor`.
export type LiteDetection = {
  box: { x: number; y: number; width: number; height: number };
  landmarks: number[][]; // 68 [x,y] points in video-intrinsic pixels
  score: number;
};

export async function detectFace(video: HTMLVideoElement): Promise<LiteDetection | null> {
  if (!video || video.readyState < 2) return null;
  const faceapi = await getFaceApi();
  const res = await faceapi
    .detectSingleFace(video, detOptsFast(faceapi))  // fast per-tick pass (no descriptor)
    .withFaceLandmarks(); // NO .withFaceDescriptor() — recognition net skipped
  if (!res) return null;
  const box = res.detection.box;
  const landmarks = res.landmarks.positions.map((p) => [p.x, p.y] as number[]);
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    landmarks,
    score: res.detection.score,
  };
}

// How many faces are currently in frame. Detection-only (no landmarks/descriptor)
// so it's cheap enough to run on the same tick as the gate. Used to BLOCK idle
// auto-clock when 2+ people are in front of the camera (prevents clocking the
// wrong/second person whose face happens to win detectSingleFace on a tick).
export async function countFaces(video: HTMLVideoElement): Promise<number> {
  if (!video || video.readyState < 2) return 0;
  const faceapi = await getFaceApi();
  const res = await faceapi.detectAllFaces(video, detOptsFast(faceapi));
  return res.length;
}

// HEAVY pass: detection + landmarks + 128-float descriptor. Run ONCE only after
// the cheap gate (mask-clear + liveness) has passed, to feed bestMatch — so the
// recognition net runs ~once per recognition, not 2.5×/sec.
export async function detectFull(video: HTMLVideoElement): Promise<FullDetection | null> {
  if (!video || video.readyState < 2) return null;
  const faceapi = await getFaceApi();
  const res = await faceapi
    .detectSingleFace(video, detOpts(faceapi))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!res || !res.descriptor) return null;
  const box = res.detection.box;
  const landmarks = res.landmarks.positions.map((p) => [p.x, p.y] as number[]);
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    landmarks,
    descriptor: res.descriptor,
    score: res.detection.score,
  };
}

// ENTERPRISE heavy pass — descriptor AND face count from ONE detection on ONE frame.
// The old flow ran detectFull (descriptor) then countFaces (a separate detectAllFaces
// on a DIFFERENT frame): between them a second person could enter, and the identity
// being matched could alternate frame-to-frame in a two-person queue. Detecting all
// faces once and matching the single face closes that race and drops a detector pass.
// Returns the count so the caller can enforce exactly-one-face, and the descriptor of
// that one face (null when count !== 1).
export type FullDetectionWithCount = FullDetection & { faceCount: number };
export async function detectFullWithCount(video: HTMLVideoElement): Promise<{ faceCount: number; face: FullDetection | null }> {
  if (!video || video.readyState < 2) return { faceCount: 0, face: null };
  const faceapi = await getFaceApi();
  const all = await faceapi
    .detectAllFaces(video, detOpts(faceapi))
    .withFaceLandmarks()
    .withFaceDescriptors();
  const faceCount = all.length;
  if (faceCount !== 1 || !all[0]?.descriptor) return { faceCount, face: null };
  const r = all[0];
  const box = r.detection.box;
  return {
    faceCount,
    face: {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      landmarks: r.landmarks.positions.map((p) => [p.x, p.y] as number[]),
      descriptor: r.descriptor,
      score: r.detection.score,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVENESS / ANTI-SPOOF — landmark micro-motion across a short frame buffer.
//
// Core idea: a real face is never perfectly still. Even when someone "holds
// still", their 68 landmarks jitter frame-to-frame from breathing, micro head
// sway, eye/lid motion and the detector's own sub-pixel noise on live skin. A
// flat printed photo or a phone/tablet screen held up produces landmark sets
// that are essentially identical frame-to-frame (variance ≈ the detector's
// floor on a static image, which is far lower than on a live face).
//
// We measure the mean per-landmark displacement between consecutive frames,
// NORMALIZED by face size (inter-frame motion ÷ face diagonal) so the score is
// scale-invariant (works whether the person is near or far from the camera).
//
// `buffer` is a rolling list of frames; each frame is the 68 [x,y] landmark
// array from detectFull. Returns a 0..~N motion score (higher = more alive).
//
// Honest limitation: this is a *motion* liveness check, not true 3D depth or
// texture anti-spoofing. A high-effort attacker who *animates* a spoof (e.g.
// plays a video of the person, or wobbles a photo) can manufacture motion and
// defeat a pure-motion check. With landmarks alone (no depth camera, no IR,
// no challenge-response) that class of attack cannot be fully closed. This
// reliably stops the common case — a static printed photo or a still image on
// a screen — which is the stated threat. For stronger assurance, pair with the
// optional blink signal below and/or a challenge ("turn your head"). Tunable.
export function livenessScore(buffer: number[][][]): number {
  // Need at least two frames to measure motion.
  if (!buffer || buffer.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let f = 1; f < buffer.length; f++) {
    const prev = buffer[f - 1];
    const cur = buffer[f];
    if (!prev || !cur || prev.length !== cur.length || cur.length < 68) continue;
    // Face scale for this frame = bounding diagonal of the landmark cloud.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of cur) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
    // Mean per-landmark displacement, normalized by face diagonal.
    let disp = 0;
    for (let i = 0; i < cur.length; i++) {
      disp += Math.hypot(cur[i][0] - prev[i][0], cur[i][1] - prev[i][1]);
    }
    disp /= cur.length;
    total += disp / diag;
    pairs += 1;
  }
  if (pairs === 0) return 0;
  // Scale up so the threshold is a readable small integer-ish number.
  return (total / pairs) * 1000;
}

// Liveness threshold (units of livenessScore above). Empirically:
//   • a live person holding "still" still scores well above this from natural
//     micro-motion + detector jitter on skin;
//   • a static printed photo / frozen screen image sits near 0–~0.3.
// Field testing on real kiosk hardware (webcam, indoor light, person wearing
// headphones / sitting fairly still) showed the original 1.2 too strict — a
// genuine seated person scored ~0.4–0.9 and got stuck "recognized but never
// clocked". With the LIGHT 2-frame window (fast Payslip/Advance-style scanner)
// 0.18 keeps the photo block while letting a real person through near-instantly
// even in DIM light (where micro-motion + detector jitter are smaller). A static
// photo's normalized motion still sits at ~0–0.12, so 0.18 rejects it. Combined
// with the sticky live-latch in the kiosk (one good read holds for the presence),
// this stops the dim-light pass/fail flap. Lower = more lenient (risks a very
// steady photo); higher = stricter. Tune on-device with the kiosk debug readout.
export const LIVENESS_THRESHOLD = 0.18;

// A live person also blinks / has eye-lid micro-motion that a flat photo lacks.
// We OR this in so a very-still-but-real face still passes via the blink signal
// even if its raw displacement dips below the motion threshold. A photo has flat
// EAR (no blink) so it can't sneak through here.
const BLINK_THRESHOLD = 0.6;

export function isLive(buffer: number[][][]): boolean {
  return livenessScore(buffer) >= LIVENESS_THRESHOLD || blinkVariance(buffer) >= BLINK_THRESHOLD;
}

// CONFIDENT liveness — clearly a live person (strong motion OR a real blink), well
// above the minimum bar. When this is true the kiosk latches immediately (no friction).
// When a frame only BARELY clears isLive() (weak motion, no blink) it's ambiguous —
// exactly what a wobbled photo / replayed video produces — so the kiosk falls back to
// an explicit blink CHALLENGE before trusting it (hybrid anti-spoof).
const STRONG_LIVENESS = LIVENESS_THRESHOLD * 1.8; // clearly-moving, not borderline
export function isConfidentLive(buffer: number[][][]): boolean {
  return livenessScore(buffer) >= STRONG_LIVENESS || blinkVariance(buffer) >= BLINK_THRESHOLD;
}

// Did a blink occur across the buffer? Used to satisfy the challenge. Reuses the EAR
// variance signal — a genuine blink drives it well above the flat-photo floor.
export function blinked(buffer: number[][][]): boolean {
  return blinkVariance(buffer) >= BLINK_THRESHOLD;
}

// Optional cheap blink/eye-motion signal — eye-aspect-ratio (EAR) variance over
// the buffer. A real person's EAR changes (blinks, lid micro-motion); a photo's
// is flat. Not required by the gate (motion score is the core), but exposed so
// the kiosk can OR it in for extra tolerance toward very still live faces.
// Landmark indices (68-pt model): left eye 36–41, right eye 42–47.
function eyeAspectRatio(pts: number[][], idx: number[]): number {
  const p = idx.map((i) => pts[i]);
  // EAR = (||p2-p6|| + ||p3-p5||) / (2·||p1-p4||)
  const v1 = Math.hypot(p[1][0] - p[5][0], p[1][1] - p[5][1]);
  const v2 = Math.hypot(p[2][0] - p[4][0], p[2][1] - p[4][1]);
  const h = Math.hypot(p[0][0] - p[3][0], p[0][1] - p[3][1]) || 1;
  return (v1 + v2) / (2 * h);
}

export function blinkVariance(buffer: number[][][]): number {
  const ears: number[] = [];
  for (const f of buffer) {
    if (!f || f.length < 68) continue;
    const l = eyeAspectRatio(f, [36, 37, 38, 39, 40, 41]);
    const r = eyeAspectRatio(f, [42, 43, 44, 45, 46, 47]);
    ears.push((l + r) / 2);
  }
  if (ears.length < 2) return 0;
  const mean = ears.reduce((a, b) => a + b, 0) / ears.length;
  const varc = ears.reduce((a, b) => a + (b - mean) ** 2, 0) / ears.length;
  return varc * 1000; // scaled like livenessScore
}

// ─────────────────────────────────────────────────────────────────────────────
// FACEMASK detection — landmark-geometry heuristic.
//
// We only have the 68-pt landmark model + detector score (no dedicated mask
// classifier). A surgical/cloth mask covers the nose bridge → chin region, so
// the landmark fitter has no real skin texture to lock onto for the nose and
// mouth points. Two reliable proxies fall out of that:
//
//  1) Lower detector/landmark confidence. A clean unobscured face scores high
//     (often >0.7 on the tiny detector); a masked face the model still "finds"
//     but with a noticeably depressed score.
//  2) Degenerate lower-face geometry. With the nose/mouth hidden, the fitter
//     tends to collapse those points toward the face center / each other, so
//     the nose-tip → mouth-center vertical span shrinks abnormally relative to
//     the eye-to-eye width of the same face (a real, visible lower face keeps a
//     roughly stable ratio).
//
// `looksMasked` returns true when the geometry looks collapsed AND/OR the score
// is low. Tuned to favor *recall* on the clock path (better to ask an unmasked
// person to "remove mask" once than to clock a masked spoof) while not nuking
// every slightly-low-score frame — the kiosk also requires this across the gate.
//
// Honest limitation: landmarks alone cannot perfectly distinguish a mask from,
// e.g., a hand over the mouth, a heavy beard, or harsh shadow — and a thin/loose
// mask may still fit "normal" geometry. This is a best-effort proxy, not a
// trained mask classifier. Documented per the brief; do not over-claim.
export function looksMasked(d: { landmarks: number[][]; score: number }): boolean {
  const L = d.landmarks;
  if (!L || L.length < 68) return false; // can't judge → don't block on this alone

  // Eye centers (36–41 left, 42–47 right) → inter-ocular width = stable scale.
  const eyeCenter = (idx: number[]) => {
    let x = 0, y = 0;
    for (const i of idx) { x += L[i][0]; y += L[i][1]; }
    return [x / idx.length, y / idx.length];
  };
  const le = eyeCenter([36, 37, 38, 39, 40, 41]);
  const re = eyeCenter([42, 43, 44, 45, 46, 47]);
  const interOcular = Math.hypot(re[0] - le[0], re[1] - le[1]) || 1;
  const eyeMid = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];

  const noseTip = L[30];           // tip of nose
  const mouthTop = L[51];          // top of upper lip
  const mouthBottom = L[57];       // bottom of lower lip
  const mouthMid = [(mouthTop[0] + mouthBottom[0]) / 2, (mouthTop[1] + mouthBottom[1]) / 2];

  // Vertical span eyes→nose and nose→mouth, normalized by inter-ocular width.
  // On a clean face: nose sits well below the eyes, mouth well below the nose,
  // giving ratios in a healthy range. A mask collapses these.
  const eyeToNose = Math.hypot(noseTip[0] - eyeMid[0], noseTip[1] - eyeMid[1]) / interOcular;
  const noseToMouth = Math.hypot(mouthMid[0] - noseTip[0], mouthMid[1] - noseTip[1]) / interOcular;
  const mouthOpeness = Math.hypot(mouthBottom[0] - mouthTop[0], mouthBottom[1] - mouthTop[1]) / interOcular;

  // Collapsed lower face: nose→mouth span tiny, or lip points nearly coincident.
  // A real visible mouth keeps noseToMouth well above this; a mask collapses it.
  // Tuned down slightly from the first pass — headphones / side shadow were
  // nudging borderline real faces over the line.
  const collapsedGeometry = noseToMouth < 0.14 || mouthOpeness < 0.025 || eyeToNose < 0.26;

  // Low detector confidence is corroborating, NOT sufficient. Lowered from 0.55:
  // headphones + dim indoor light routinely drop the tiny detector's score on a
  // perfectly unmasked face, which was triggering false "remove mask" rejects.
  // Mask detection now leans on the geometry collapse (the real signal), with a
  // very-low score only corroborating an already-borderline geometry.
  const lowScore = d.score < 0.4;

  // Block when geometry looks collapsed (strong signal), or when geometry is
  // borderline AND the detector is also very unsure.
  return collapsedGeometry || (lowScore && noseToMouth < 0.2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUNGLASSES detection — landmark-geometry heuristic (eye region).
//
// Same caveat class as looksMasked: we only have the 68-pt landmark model, no
// dedicated eyewear classifier. Dark sunglasses hide the eye/iris texture, so the
// landmark fitter has nothing to lock the eye-contour points onto. Two proxies:
//
//  1) Degenerate eye-aspect-ratio. A visible open eye has a healthy EAR (lid gap
//     vs eye width). Sunglasses collapse the fitted eye contour toward a flat
//     line → EAR drops abnormally low on BOTH eyes at once (a real blink is brief
//     and usually not dead-flat on both eyes across the whole gate).
//  2) Eye-width asymmetry / implausibly small eyes relative to inter-ocular width.
//
// `looksSunglasses` returns true when both eyes read as collapsed/occluded. Tuned
// to favor recall on the clock path. NOTE: this is checked across the liveness
// gate window in the kiosk, so a momentary natural blink (one frame) won't trip
// it — only a sustained both-eyes-hidden reading does.
//
// Honest limitation: clear/prescription glasses, squinting, very narrow eyes, or
// strong downlight can mimic low EAR; a light-tinted lens that the model still
// fits through may slip past. Best-effort proxy, not an eyewear classifier.
export function looksSunglasses(d: { landmarks: number[][] }): boolean {
  const L = d.landmarks;
  if (!L || L.length < 68) return false;

  const eyeCenter = (idx: number[]) => {
    let x = 0, y = 0;
    for (const i of idx) { x += L[i][0]; y += L[i][1]; }
    return [x / idx.length, y / idx.length];
  };
  const leIdx = [36, 37, 38, 39, 40, 41];
  const reIdx = [42, 43, 44, 45, 46, 47];
  const le = eyeCenter(leIdx);
  const re = eyeCenter(reIdx);
  const interOcular = Math.hypot(re[0] - le[0], re[1] - le[1]) || 1;

  // EAR per eye (lid gap ÷ eye width). Open eye ≈ 0.2–0.35; a collapsed/occluded
  // contour from a dark lens trends toward ~0.10 or below.
  const earL = eyeAspectRatio(L, leIdx);
  const earR = eyeAspectRatio(L, reIdx);

  // Eye horizontal span normalized by inter-ocular width — sunglasses often warp
  // the fitted eye box so the per-eye width gets implausibly small or large.
  const widthL = Math.hypot(L[39][0] - L[36][0], L[39][1] - L[36][1]) / interOcular;
  const widthR = Math.hypot(L[45][0] - L[42][0], L[45][1] - L[42][1]) / interOcular;

  // BOTH eyes flat (rules out a one-eye wink / asymmetric squint) AND eye boxes
  // look degenerate. Threshold 0.13 sits below a normal open eye's EAR floor.
  const bothFlat = earL < 0.13 && earR < 0.13;
  const degenerateWidth = widthL < 0.22 || widthR < 0.22;

  return bothFlat && degenerateWidth;
}

export function getDescriptorFromImage(img: HTMLImageElement): Promise<Float32Array | null> {
  return descriptorFrom(img);
}

// Plain euclidean distance between two descriptors (number[] or Float32Array).
export function euclideanDistance(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// `descriptor` is the enrolled face vector(s). It's kept as number[] for backward
// compatibility, but may hold EITHER a single 128-float vector (legacy single-sample
// enrollment) OR several concatenated 128-float vectors (multi-sample enrollment:
// length is a multiple of 128). samplesOf() splits it back into individual vectors.
export type EnrolledFace = { employee_id: number; name: string; descriptor: number[]; photo_url?: string | null; role?: string | null };
export type FaceMatch = { employee_id: number; name: string; distance: number };

export const DESCRIPTOR_LEN = 128;

// Split a stored descriptor blob into its individual 128-float sample vectors.
// Handles both a single vector and a concatenation of several.
export function samplesOf(descriptor: number[] | null | undefined): number[][] {
  if (!descriptor || descriptor.length < DESCRIPTOR_LEN) return [];
  const n = Math.floor(descriptor.length / DESCRIPTOR_LEN);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push(descriptor.slice(i * DESCRIPTOR_LEN, (i + 1) * DESCRIPTOR_LEN));
  return out;
}

// Minimum gap between the best and second-best enrolled distance for a match to be
// trusted. Without it, two people with similar descriptors (siblings, or just close
// single-sample enrollments) can flip tick-to-tick and clock the wrong person. If the
// runner-up is within this margin the match is AMBIGUOUS → we refuse rather than guess.
export const MATCH_MARGIN = 0.06;

// Closest enrolled face to `descriptor`, or null if none is within threshold OR the
// match is ambiguous (a second identity is nearly as close). For a payroll biometric,
// refusing an uncertain match is safer than clocking the wrong person. An employee's
// distance is the MIN across all their enrolled samples (multi-sample enrollment makes
// recognition robust to angle/lighting: a live frame need only be close to ONE sample).
export function bestMatch(
  descriptor: ArrayLike<number>,
  enrolled: EnrolledFace[],
): FaceMatch | null {
  let best: FaceMatch | null = null;
  // Second-best distance among DIFFERENT people only. A person enrolled more than once
  // (e.g. a regular + a "WFH" entry, or multi-sample re-enrollment) would otherwise be
  // their own runner-up, tripping the ambiguity gate and blocking a correct match — the
  // "NO MATCH · nearest <self>" stall. Only a DIFFERENT employee nearby is ambiguous.
  let secondBestOther = Infinity;
  for (const e of enrolled) {
    const samples = samplesOf(e.descriptor);
    if (!samples.length) continue;
    let distance = Infinity;
    for (const s of samples) {
      const d = euclideanDistance(descriptor, s);
      if (d < distance) distance = d;
    }
    if (!best || distance < best.distance) {
      // The previous best belongs to a different person iff its employee_id differs.
      if (best && best.employee_id !== e.employee_id && best.distance < secondBestOther) {
        secondBestOther = best.distance;
      }
      best = { employee_id: e.employee_id, name: e.name, distance };
    } else if (best && e.employee_id !== best.employee_id && distance < secondBestOther) {
      secondBestOther = distance;
    }
  }
  if (!best || best.distance >= MATCH_THRESHOLD) return null;
  // Ambiguity gate: a DIFFERENT person is nearly as close → don't guess.
  if (secondBestOther - best.distance < MATCH_MARGIN) return null;
  return best;
}

// Nearest enrolled face + its distance, IGNORING the match/ambiguity thresholds — for the
// kiosk debug HUD, so we can see WHY a face isn't matching (distance too high vs. below
// threshold-but-ambiguous). Not for gating a clock; use bestMatch() for that.
export function nearestDistance(
  descriptor: ArrayLike<number>,
  enrolled: EnrolledFace[],
): { name: string; distance: number } | null {
  let best: { name: string; distance: number } | null = null;
  for (const e of enrolled) {
    for (const s of samplesOf(e.descriptor)) {
      const d = euclideanDistance(descriptor, s);
      if (!best || d < best.distance) best = { name: e.name, distance: d };
    }
  }
  return best;
}
