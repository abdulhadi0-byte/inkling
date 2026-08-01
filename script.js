/* =====================================================================
   Inkling — air-writing engine
   MediaPipe Hands gives us 21 3D landmarks per hand, ~15-30x/sec.
   A separate requestAnimationFrame loop turns that into smooth 60fps
   motion, and draws INCREMENTALLY (only the new bit of line each frame)
   rather than replaying the whole stroke history every frame — the old
   approach got slower the longer you drew; this one stays flat no
   matter how long the canvas has been going.
===================================================================== */

// ---------- DOM ----------
const video          = document.getElementById('webcam');
const overlay        = document.getElementById('overlay');
const inkCanvas       = document.getElementById('inkCanvas');
const viewport        = document.querySelector('.viewport');
const permissionCard  = document.getElementById('permissionCard');
const loadingCard     = document.getElementById('loadingCard');
const startBtn        = document.getElementById('startBtn');
const gestureReadout  = document.getElementById('gestureReadout');
const fpsReadout      = document.getElementById('fpsReadout');
const clearBtn        = document.getElementById('clearBtn');
const saveBtn         = document.getElementById('saveBtn');
const brushSize       = document.getElementById('brushSize');
const skeletonToggle  = document.getElementById('skeletonToggle');
const trailToggle     = document.getElementById('trailToggle');
const kaleidoToggle   = document.getElementById('kaleidoToggle');
const fadeToggle      = document.getElementById('fadeToggle');
const swatchesEl      = document.getElementById('swatches');
const helpToggle      = document.getElementById('helpToggle');
const helpDrawer      = document.getElementById('helpDrawer');
const helpClose       = document.getElementById('helpClose');

const octx = overlay.getContext('2d');
const ictx = inkCanvas.getContext('2d');

// ---------- Ink palette ----------
const INKS = [
  { name: 'brass',     hex: '#d4af6a' },
  { name: 'verdigris', hex: '#5fb8ac' },
  { name: 'rose',      hex: '#c97b6d' },
  { name: 'parchment', hex: '#f2e9d8' },
  { name: 'violet',    hex: '#9b8ad6' },
];
let inkIndex = 0;
let brushWidth = Number(brushSize.value);
let showSkeleton = false;
let showGlow = true;
let kaleidoMode = false;
let fadeMode = false;

INKS.forEach((ink, i) => {
  const dot = document.createElement('button');
  dot.className = 'swatch' + (i === 0 ? ' active' : '');
  dot.style.background = ink.hex;
  dot.title = ink.name;
  dot.addEventListener('click', () => setInk(i));
  swatchesEl.appendChild(dot);
});
function setInk(i){
  inkIndex = i;
  [...swatchesEl.children].forEach((el, idx) => el.classList.toggle('active', idx === i));
}
brushSize.addEventListener('input', () => brushWidth = Number(brushSize.value));
skeletonToggle.addEventListener('click', () => {
  showSkeleton = !showSkeleton;
  skeletonToggle.classList.toggle('active', showSkeleton);
});
trailToggle.addEventListener('click', () => {
  showGlow = !showGlow;
  trailToggle.classList.toggle('active', showGlow);
});
kaleidoToggle.addEventListener('click', () => {
  kaleidoMode = !kaleidoMode;
  kaleidoToggle.classList.toggle('active', kaleidoMode);
});
fadeToggle.addEventListener('click', () => {
  fadeMode = !fadeMode;
  fadeToggle.classList.toggle('active', fadeMode);
});
helpToggle.addEventListener('click', () => helpDrawer.hidden = false);
helpClose.addEventListener('click', () => helpDrawer.hidden = true);
helpDrawer.addEventListener('click', (e) => { if (e.target === helpDrawer) helpDrawer.hidden = true; });

// ---------- Canvas sizing ----------
function resizeCanvases(){
  const w = viewport.clientWidth, h = viewport.clientHeight;
  [overlay, inkCanvas].forEach(c => {
    if (c.width !== w || c.height !== h){
      // preserve existing ink pixels across resizes
      const prev = document.createElement('canvas');
      prev.width = c.width; prev.height = c.height;
      prev.getContext('2d').drawImage(c, 0, 0);
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(prev, 0, 0, w, h);
    }
  });
}
window.addEventListener('resize', resizeCanvases);

function clearAll(){
  ictx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
  particles.length = 0;
}
clearBtn.addEventListener('click', clearAll);

saveBtn.addEventListener('click', () => {
  // compose ink canvas onto a solid background for a clean export
  const out = document.createElement('canvas');
  out.width = inkCanvas.width; out.height = inkCanvas.height;
  const outCtx = out.getContext('2d');
  outCtx.fillStyle = '#14101c';
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(inkCanvas, 0, 0);
  const link = document.createElement('a');
  link.download = `inkling-${Date.now()}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
});

// ---------- Incremental ink drawing ----------
// Draws one new line segment straight onto the persistent ink canvas.
// In kaleido mode, also stamps N rotated + mirrored copies around the
// canvas centre for a live mandala effect. Cost is proportional to how
// much you're actively drawing this frame, never to total history.
const KALEIDO_FOLDS = 6;

function drawSegment(x0, y0, x1, y1, color, width){
  ictx.lineCap = 'round';
  ictx.lineJoin = 'round';
  ictx.strokeStyle = color;
  ictx.lineWidth = width;
  if (showGlow){
    ictx.shadowColor = color;
    ictx.shadowBlur = width * 1.8;
  } else {
    ictx.shadowBlur = 0;
  }

  if (!kaleidoMode){
    ictx.beginPath();
    ictx.moveTo(x0, y0);
    ictx.lineTo(x1, y1);
    ictx.stroke();
    return;
  }

  const cx = inkCanvas.width / 2, cy = inkCanvas.height / 2;
  for (let i = 0; i < KALEIDO_FOLDS; i++){
    const angle = (Math.PI * 2 / KALEIDO_FOLDS) * i;
    for (let mirror = 0; mirror < 2; mirror++){
      ictx.save();
      ictx.translate(cx, cy);
      ictx.rotate(angle);
      if (mirror) ictx.scale(-1, 1);
      ictx.translate(-cx, -cy);
      ictx.beginPath();
      ictx.moveTo(x0, y0);
      ictx.lineTo(x1, y1);
      ictx.stroke();
      ictx.restore();
    }
  }
  ictx.shadowBlur = 0;
}

function eraseAt(x, y, radius){
  ictx.save();
  ictx.globalCompositeOperation = 'destination-out';
  ictx.beginPath();
  ictx.arc(x, y, radius, 0, Math.PI * 2);
  ictx.fill();
  ictx.restore();
}

// ---------- Particles (ephemeral, drawn on the overlay layer) ----------
let particles = [];
function spawnSparkle(x, y, color, count = 2){
  for (let i = 0; i < count; i++){
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 1.8,
      vy: (Math.random() - 0.5) * 1.8 - 0.5,
      size: Math.random() * 2 + 0.6,
      life: 24, maxLife: 24,
      color
    });
  }
}
function updateAndDrawParticles(){
  particles.forEach(p => {
    p.life -= 1;
    p.x += p.vx; p.y += p.vy; p.vy += 0.02;
  });
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    octx.globalAlpha = Math.max(p.life / p.maxLife, 0);
    octx.fillStyle = p.color;
    octx.beginPath();
    octx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    octx.fill();
  });
  octx.globalAlpha = 1;
}

// ---------- Gesture detection ----------
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };

function isExtended(lm, tipIdx, pipIdx){
  return lm[tipIdx].y < lm[pipIdx].y - 0.02;
}

function detectGesture(lm){
  const index  = isExtended(lm, TIP.index, PIP.index);
  const middle = isExtended(lm, TIP.middle, PIP.middle);
  const ring   = isExtended(lm, TIP.ring, PIP.ring);
  const pinky  = isExtended(lm, TIP.pinky, PIP.pinky);
  const count = [index, middle, ring, pinky].filter(Boolean).length;

  if (count === 0) return 'fist';
  if (count === 1 && index) return 'draw';
  if (count === 2 && index && middle) return 'hover';
  if (count === 3 && index && middle && ring) return 'cycle';
  if (count >= 4) return 'erase';
  return 'hover';
}

function gestureLabel(g){
  return { draw: 'drawing ☝️', hover: 'hover ✌️', cycle: 'cycle colour 🤟',
           erase: 'erase 🖐️', fist: 'clear? ✊', none: '—' }[g] || '—';
}

// ---------- Shared state between MediaPipe callback and the render loop ----------
let latestGesture = null;      // gesture MediaPipe most recently reported
let handPresent = false;
let targetX = 0, targetY = 0;   // raw fingertip position from the latest detection
let smoothX = 0, smoothY = 0;   // interpolated position the render loop actually draws with
let hasSmoothPos = false;
let prevSmoothX = 0, prevSmoothY = 0;
let latestLandmarks = null;

let cycleArmed = true;
let fistHoldStart = null;
const FIST_HOLD_MS = 850;
let wasDrawing = false;

// ---------- FPS (tracking detections/sec, not render fps) ----------
let frameTimes = [];
function tickFps(){
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter(t => now - t < 1000);
  fpsReadout.textContent = frameTimes.length;
}

// ---------- MediaPipe Hands setup ----------
// Created lazily (on button click) rather than at script load time, so that
// a slow/blocked CDN script can't silently prevent the button from working.
let hands = null;
let cameraUtil = null;

function ensureHands(){
  if (hands) return hands;
  if (typeof Hands === 'undefined'){
    throw new Error('MediaPipe Hands failed to load from the CDN.');
  }
  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });
  hands.onResults(onResults);
  return hands;
}

// This runs at MediaPipe's own detection rate (~15-25fps typically on CPU).
// It only updates shared state — all drawing happens in the render loop below,
// decoupled and running at a steady 60fps regardless of detection rate.
function onResults(results){
  tickFps();

  const w = overlay.width, h = overlay.height;
  handPresent = !!(results.multiHandLandmarks && results.multiHandLandmarks.length > 0);

  if (!handPresent){
    latestGesture = null;
    latestLandmarks = null;
    fistHoldStart = null;
    return;
  }

  const lm = results.multiHandLandmarks[0];
  latestLandmarks = lm;
  latestGesture = detectGesture(lm);

  const tip = lm[TIP.index];
  targetX = tip.x * w;
  targetY = tip.y * h;
}

// ---------- Render loop: smoothing, drawing, effects — all at 60fps ----------
let lastTick = null;

function tick(now){
  requestAnimationFrame(tick);
  resizeCanvases();

  if (lastTick === null) lastTick = now;
  const dt = Math.min(now - lastTick, 50); // clamp so a tab pause doesn't cause a huge jump
  lastTick = now;

  octx.clearRect(0, 0, overlay.width, overlay.height);

  if (!handPresent){
    gestureReadout.textContent = '—';
    hasSmoothPos = false;
    wasDrawing = false;
    updateAndDrawParticles();
    return;
  }

  const gestureText = gestureLabel(latestGesture);
  if (gestureText !== gestureReadout.textContent){
    gestureReadout.textContent = gestureText;
    gestureReadout.classList.remove('pulse');
    void gestureReadout.offsetWidth; // restart the CSS animation
    gestureReadout.classList.add('pulse');
  }

  // exponential smoothing toward the latest detected fingertip position —
  // this both fills in the gaps between detections (buttery motion) and
  // damps hand-tracking jitter, for free
  if (!hasSmoothPos){
    smoothX = targetX; smoothY = targetY;
    hasSmoothPos = true;
  }
  const smoothing = 1 - Math.pow(0.001, dt / 1000); // framerate-independent lerp factor
  prevSmoothX = smoothX; prevSmoothY = smoothY;
  smoothX += (targetX - smoothX) * smoothing;
  smoothY += (targetY - smoothY) * smoothing;

  if (latestGesture !== 'cycle') cycleArmed = true;

  // ink-dissolve effect: wash a faint layer of background colour over the
  // whole canvas each frame so old strokes gradually fade to black
  if (fadeMode){
    ictx.save();
    ictx.globalCompositeOperation = 'source-over';
    ictx.fillStyle = 'rgba(20, 16, 28, 0.02)';
    ictx.fillRect(0, 0, inkCanvas.width, inkCanvas.height);
    ictx.restore();
  }

  switch (latestGesture){
    case 'draw': {
      const dist = Math.hypot(smoothX - prevSmoothX, smoothY - prevSmoothY);
      const speed = dist / Math.max(dt, 1); // px per ms
      // faster strokes taper thinner, slow strokes lay down more ink —
      // a rough approximation of a real calligraphy nib
      const dynamicWidth = Math.max(brushWidth * 0.35, Math.min(brushWidth * 1.6, brushWidth * (1.5 - speed * 6)));
      const color = INKS[inkIndex].hex;

      if (wasDrawing){
        drawSegment(prevSmoothX, prevSmoothY, smoothX, smoothY, color, dynamicWidth);
      }
      spawnSparkle(smoothX, smoothY, color, dist > 1 ? 2 : 1);
      wasDrawing = true;
      fistHoldStart = null;
      break;
    }
    case 'erase': {
      eraseAt(smoothX, smoothY, brushWidth * 3.2);
      wasDrawing = false;
      fistHoldStart = null;
      break;
    }
    case 'cycle': {
      wasDrawing = false;
      if (cycleArmed){
        setInk((inkIndex + 1) % INKS.length);
        cycleArmed = false;
      }
      fistHoldStart = null;
      break;
    }
    case 'fist': {
      wasDrawing = false;
      if (fistHoldStart === null) fistHoldStart = now;
      else if (now - fistHoldStart > FIST_HOLD_MS){
        clearAll();
        fistHoldStart = null;
      }
      break;
    }
    case 'hover':
    default: {
      wasDrawing = false;
      fistHoldStart = null;
      break;
    }
  }

  // ---------- overlay: skeleton, cursor ring, fist-hold progress ----------
  if (showSkeleton && latestLandmarks && window.drawConnectors){
    drawConnectors(octx, latestLandmarks, HAND_CONNECTIONS, { color: 'rgba(212,175,106,0.55)', lineWidth: 2 });
    drawLandmarks(octx, latestLandmarks, { color: 'rgba(95,184,172,0.8)', radius: 2.5 });
  }

  drawCursorRing(smoothX, smoothY, latestGesture);

  updateAndDrawParticles();
}

function drawCursorRing(x, y, gesture){
  octx.save();
  if (gesture === 'fist' && fistHoldStart !== null){
    const progress = Math.min((performance.now() - fistHoldStart) / FIST_HOLD_MS, 1);
    octx.strokeStyle = 'rgba(212,175,106,0.9)';
    octx.lineWidth = 3;
    octx.beginPath();
    octx.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    octx.stroke();
    octx.fillStyle = 'rgba(212,175,106,0.15)';
    octx.beginPath();
    octx.arc(x, y, 22, 0, Math.PI * 2);
    octx.fill();
  } else {
    const color = gesture === 'draw' ? INKS[inkIndex].hex
                : gesture === 'erase' ? 'rgba(242,233,216,0.8)'
                : 'rgba(242,233,216,0.5)';
    octx.strokeStyle = color;
    octx.lineWidth = gesture === 'draw' ? 2 : 1.4;
    if (gesture === 'hover') octx.setLineDash([3, 4]);
    octx.beginPath();
    octx.arc(x, y, gesture === 'erase' ? 16 : 8, 0, Math.PI * 2);
    octx.stroke();
    octx.setLineDash([]);
  }
  octx.restore();
}

// ---------- Camera bootstrap ----------
startBtn.addEventListener('click', async () => {
  permissionCard.hidden = true;
  loadingCard.hidden = false;
  try{
    const handsInstance = ensureHands(); // throws early, clear message, if the CDN script never loaded

    if (typeof Camera === 'undefined'){
      throw new Error('CAMERA_UTIL_MISSING');
    }

    cameraUtil = new Camera(video, {
      onFrame: async () => { await handsInstance.send({ image: video }); },
      width: 1280,
      height: 960,
    });
    await cameraUtil.start();
    loadingCard.hidden = true;
    resizeCanvases();
    requestAnimationFrame(tick);
  } catch (err){
    loadingCard.hidden = true;
    permissionCard.hidden = false;
    console.error('Inkling start error:', err);

    if (err && (err.message === 'MediaPipe Hands failed to load from the CDN.' || err.message === 'CAMERA_UTIL_MISSING')){
      permissionCard.querySelector('.permission-title').textContent = "Couldn't load the hand-tracking library";
      permissionCard.querySelector('.permission-body').textContent =
        'A required script didn\'t load from the CDN — try disabling ad blockers/extensions for this page, checking your connection, or reloading.';
    } else {
      permissionCard.querySelector('.permission-title').textContent = 'Camera access denied';
      permissionCard.querySelector('.permission-body').textContent =
        'Inkling can\'t draw without seeing your hand. Check your browser\'s camera permissions and try again.';
    }
  }
});

// keep canvases correctly sized from the start
resizeCanvases();
