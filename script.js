/* =====================================================================
   Inkling — air-writing engine
   MediaPipe Hands gives us 21 3D landmarks per hand, ~30x/sec.
   We turn finger poses into gestures, and gestures into ink.
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
helpToggle.addEventListener('click', () => helpDrawer.hidden = false);
helpClose.addEventListener('click', () => helpDrawer.hidden = true);
helpDrawer.addEventListener('click', (e) => { if (e.target === helpDrawer) helpDrawer.hidden = true; });

// ---------- Canvas sizing ----------
function resizeCanvases(){
  const w = viewport.clientWidth, h = viewport.clientHeight;
  [overlay, inkCanvas].forEach(c => {
    if (c.width !== w || c.height !== h){
      // preserve ink drawing across resizes as best we can
      const prev = document.createElement('canvas');
      prev.width = c.width; prev.height = c.height;
      prev.getContext('2d').drawImage(c, 0, 0);
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(prev, 0, 0, w, h);
    }
  });
}
window.addEventListener('resize', resizeCanvases);

// ---------- Stroke storage ----------
let strokes = [];       // finished + in-progress strokes: {color, width, points:[{x,y}]}
let currentStroke = null;
let particles = [];     // little sparkle bursts while drawing

function beginStroke(x, y, color, width){
  currentStroke = { color, width, points: [{x, y}] };
  strokes.push(currentStroke);
}
function extendStroke(x, y){
  if (!currentStroke) return;
  currentStroke.points.push({x, y});
  if (currentStroke.points.length > 4000) currentStroke.points.shift();
}
function endStroke(){ currentStroke = null; }

function eraseNear(x, y, radius){
  strokes.forEach(s => {
    s.points = s.points.filter(p => Math.hypot(p.x - x, p.y - y) > radius);
  });
  strokes = strokes.filter(s => s.points.length > 1);
}

function clearAll(){
  strokes = [];
  currentStroke = null;
  particles = [];
}
clearBtn.addEventListener('click', clearAll);

saveBtn.addEventListener('click', () => {
  // compose ink canvas onto a parchment-colored background for a clean export
  const out = document.createElement('canvas');
  out.width = inkCanvas.width; out.height = inkCanvas.height;
  const octx2 = out.getContext('2d');
  octx2.fillStyle = '#14101c';
  octx2.fillRect(0, 0, out.width, out.height);
  octx2.drawImage(inkCanvas, 0, 0);
  const link = document.createElement('a');
  link.download = `inkling-${Date.now()}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
});

// ---------- Drawing render loop ----------
function renderInk(){
  ictx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
  ictx.lineCap = 'round';
  ictx.lineJoin = 'round';

  strokes.forEach(s => {
    if (s.points.length < 2) return;
    ictx.beginPath();
    ictx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length - 1; i++){
      const midX = (s.points[i].x + s.points[i+1].x) / 2;
      const midY = (s.points[i].y + s.points[i+1].y) / 2;
      ictx.quadraticCurveTo(s.points[i].x, s.points[i].y, midX, midY);
    }
    ictx.strokeStyle = s.color;
    ictx.lineWidth = s.width;
    if (showGlow){
      ictx.shadowColor = s.color;
      ictx.shadowBlur = s.width * 1.8;
    } else {
      ictx.shadowBlur = 0;
    }
    ictx.stroke();
  });
  ictx.shadowBlur = 0;

  // sparkle particles
  particles.forEach(p => {
    p.life -= 1;
    p.x += p.vx; p.y += p.vy; p.vy += 0.02;
  });
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    ictx.globalAlpha = Math.max(p.life / p.maxLife, 0);
    ictx.fillStyle = p.color;
    ictx.beginPath();
    ictx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ictx.fill();
  });
  ictx.globalAlpha = 1;
}
function spawnSparkle(x, y, color){
  for (let i = 0; i < 2; i++){
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 1.6,
      vy: (Math.random() - 0.5) * 1.6 - 0.4,
      size: Math.random() * 2 + 0.6,
      life: 24, maxLife: 24,
      color
    });
  }
}

// ---------- Gesture detection ----------
// MediaPipe landmark indices we care about
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { index: 6, middle: 10, ring: 14, pinky: 18 };

function isExtended(lm, tipIdx, pipIdx){
  // In image-normalized coords, y grows downward. A finger pointing "up"
  // (extended, hand held naturally upright) has its tip above its pip joint.
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

// gesture state / debouncing
let lastGesture = null;
let fistHoldStart = null;
let cycleArmed = true; // only cycle once per gesture entry, not every frame
const FIST_HOLD_MS = 850;

function gestureLabel(g){
  return { draw: 'drawing ☝️', hover: 'hover ✌️', cycle: 'cycle colour 🤟',
           erase: 'erase 🖐️', fist: 'clear? ✊', none: '—' }[g] || '—';
}

// ---------- FPS ----------
let frameTimes = [];
function tickFps(){
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter(t => now - t < 1000);
  fpsReadout.textContent = frameTimes.length;
}

// ---------- MediaPipe Hands setup ----------
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.6,
});
hands.onResults(onResults);

let cameraUtil = null;

function onResults(results){
  tickFps();
  resizeCanvases();
  octx.clearRect(0, 0, overlay.width, overlay.height);

  const w = overlay.width, h = overlay.height;
  const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

  if (!hasHand){
    gestureReadout.textContent = '—';
    endStroke();
    lastGesture = null;
    fistHoldStart = null;
    renderInk();
    return;
  }

  const lm = results.multiHandLandmarks[0];

  if (showSkeleton && window.drawConnectors){
    drawConnectors(octx, lm, HAND_CONNECTIONS, { color: 'rgba(212,175,106,0.55)', lineWidth: 2 });
    drawLandmarks(octx, lm, { color: 'rgba(95,184,172,0.8)', radius: 2.5 });
  }

  const gesture = detectGesture(lm);
  gestureReadout.textContent = gestureLabel(gesture);

  // fingertip in canvas pixel space (landmarks are 0..1 normalized, already
  // in the mirrored video's coordinate frame since MediaPipe reads the raw
  // <video> element which we also mirror visually via CSS — both canvases
  // share that same transform, so we draw in the SAME unmirrored space and
  // let CSS mirror everything together)
  const tip = lm[TIP.index];
  const x = tip.x * w;
  const y = tip.y * h;

  if (gesture !== 'cycle') cycleArmed = true;

  switch(gesture){
    case 'draw': {
      if (lastGesture !== 'draw') beginStroke(x, y, INKS[inkIndex].hex, brushWidth);
      else extendStroke(x, y);
      spawnSparkle(x, y, INKS[inkIndex].hex);
      fistHoldStart = null;
      break;
    }
    case 'erase': {
      endStroke();
      eraseNear(x, y, brushWidth * 3.2);
      fistHoldStart = null;
      break;
    }
    case 'cycle': {
      endStroke();
      if (cycleArmed){
        setInk((inkIndex + 1) % INKS.length);
        cycleArmed = false;
      }
      fistHoldStart = null;
      break;
    }
    case 'fist': {
      endStroke();
      if (fistHoldStart === null) fistHoldStart = performance.now();
      else if (performance.now() - fistHoldStart > FIST_HOLD_MS){
        clearAll();
        fistHoldStart = null;
      }
      break;
    }
    case 'hover':
    default: {
      endStroke();
      fistHoldStart = null;
      break;
    }
  }

  lastGesture = gesture;
  renderInk();
}

// ---------- Camera bootstrap ----------
startBtn.addEventListener('click', async () => {
  permissionCard.hidden = true;
  loadingCard.hidden = false;
  try{
    cameraUtil = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 1280,
      height: 960,
    });
    await cameraUtil.start();
    loadingCard.hidden = true;
    resizeCanvases();
  } catch (err){
    loadingCard.hidden = true;
    permissionCard.hidden = false;
    permissionCard.querySelector('.permission-title').textContent = 'Camera access denied';
    permissionCard.querySelector('.permission-body').textContent =
      'Inkling can\'t draw without seeing your hand. Check your browser\'s camera permissions and try again.';
    console.error('Camera error:', err);
  }
});

// keep canvases correctly sized from the start
resizeCanvases();
