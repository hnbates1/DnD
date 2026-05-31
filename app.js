const params = new URLSearchParams(location.search);
const isProjector = params.get("screen") === "projector";

const stage = document.getElementById("stage");
const ambientCanvas = document.getElementById("ambientCanvas");
const ambientCtx = ambientCanvas.getContext("2d");
const video = document.getElementById("mapVideo");
const effectCanvas = document.getElementById("effectCanvas");
const effectCtx = effectCanvas.getContext("2d");
const fogLayer = document.getElementById("fogLayer");
const tokenLayer = document.getElementById("tokenLayer");
const menuRing = document.getElementById("menuRing");
const projectorHint = document.getElementById("projectorHint");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const cameraCtx = cameraCanvas.getContext("2d", { willReadFrequently: true });
const cameraStatus = document.getElementById("cameraStatus");
const aiStatus = document.getElementById("aiStatus");
const aiMode = document.getElementById("aiMode");
const encounterNotes = document.getElementById("encounterNotes");
const aiQuestion = document.getElementById("aiQuestion");
const aiLog = document.getElementById("aiLog");

const state = {
  tool: "token",
  fog: false,
  particles: [],
  tokens: [],
  nextTokenId: 1,
  lastMotion: null,
  previousFrame: null,
  cameraRunning: false,
  calibrating: false,
  calibrationPoints: [],
  currentMap: "",
  lastEffect: "",
  detectedThisSecond: 0,
  lastPieceBroadcast: 0,
};

if (isProjector) {
  document.body.classList.add("projector");
}

function broadcast(type, payload = {}) {
  localStorage.setItem("dnd-projector-event", JSON.stringify({
    type,
    payload,
    time: Date.now(),
  }));
}

window.addEventListener("storage", (event) => {
  if (event.key !== "dnd-projector-event" || !event.newValue) return;
  const message = JSON.parse(event.newValue);
  handleMessage(message.type, message.payload);
});

function handleMessage(type, payload) {
  if (type === "play") video.play();
  if (type === "pause") video.pause();
  if (type === "map") loadMapUrl(payload.url);
  if (type === "brightness") setBrightness(payload.value);
  if (type === "grid") setGrid(payload.value);
  if (type === "effect") triggerEffect(payload.effect, payload.x, payload.y);
  if (type === "token") addToken(payload.x, payload.y, payload);
  if (type === "piece") upsertDetectedPiece(payload);
  if (type === "fog") setFog(payload.enabled);
  if (type === "reveal") revealAt(payload.x, payload.y);
  if (type === "menu") showMenu(payload.x, payload.y);
  if (type === "clear") clearOverlays();
}

function loadMapUrl(url) {
  if (!url) return;
  state.currentMap = url;
  video.src = url;
  projectorHint.hidden = true;
  video.play();
}

function sizeCanvas() {
  const rect = stage.getBoundingClientRect();
  ambientCanvas.width = Math.max(1, Math.floor(rect.width));
  ambientCanvas.height = Math.max(1, Math.floor(rect.height));
  effectCanvas.width = Math.max(1, Math.floor(rect.width));
  effectCanvas.height = Math.max(1, Math.floor(rect.height));
}

window.addEventListener("resize", sizeCanvas);
sizeCanvas();

function setBrightness(value) {
  stage.style.setProperty("--video-brightness", String(value / 100));
}

function setGrid(value) {
  document.documentElement.style.setProperty("--grid-opacity", String(value / 100));
}

function stagePoint(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100,
  };
}

function tokenDefaults(overrides = {}) {
  return {
    id: overrides.id || `token-${state.nextTokenId++}`,
    x: overrides.x ?? 50,
    y: overrides.y ?? 50,
    health: overrides.health ?? 100,
    mana: overrides.mana ?? 70,
    buffs: overrides.buffs || [],
    debuffs: overrides.debuffs || [],
    detected: Boolean(overrides.detected),
    color: overrides.color || "gold",
    lastSeen: Date.now(),
  };
}

function statusBadge(label, type) {
  const badge = document.createElement("span");
  badge.className = `status-badge ${type}`;
  badge.title = label;
  badge.textContent = {
    Bless: "B",
    Shield: "S",
    Wound: "W",
    Hex: "H",
  }[label] || label.slice(0, 1).toUpperCase();
  return badge;
}

function renderToken(tokenData) {
  let token = tokenLayer.querySelector(`[data-token-id="${tokenData.id}"]`);
  if (!token) {
    token = document.createElement("div");
    token.className = "token";
    token.dataset.tokenId = tokenData.id;
    token.innerHTML = `
      <div class="health-ring"></div>
      <div class="mana-ring"></div>
      <div class="piece-core"></div>
      <div class="badge-row buffs"></div>
      <div class="badge-row debuffs"></div>
    `;
    tokenLayer.appendChild(token);
  }

  token.classList.toggle("detected", tokenData.detected);
  token.classList.toggle("stale", Date.now() - tokenData.lastSeen > 2500);
  token.style.left = `${tokenData.x}%`;
  token.style.top = `${tokenData.y}%`;
  token.style.setProperty("--hp", `${Math.max(0, Math.min(100, tokenData.health))}%`);
  token.style.setProperty("--mp", `${Math.max(0, Math.min(100, tokenData.mana))}%`);
  token.style.setProperty("--piece-color", tokenColor(tokenData.color));

  const buffs = token.querySelector(".badge-row.buffs");
  const debuffs = token.querySelector(".badge-row.debuffs");
  buffs.innerHTML = "";
  debuffs.innerHTML = "";
  for (const buff of tokenData.buffs.slice(0, 3)) buffs.appendChild(statusBadge(buff, "buff"));
  for (const debuff of tokenData.debuffs.slice(0, 3)) debuffs.appendChild(statusBadge(debuff, "debuff"));
}

function tokenColor(color) {
  return {
    red: "#e75b4d",
    green: "#5ee085",
    blue: "#63b3ff",
    purple: "#b879ff",
    gold: "#d9b35d",
  }[color] || "#d9b35d";
}

function addToken(x, y, overrides = {}) {
  const tokenData = tokenDefaults({ ...overrides, x, y });
  state.tokens.push(tokenData);
  renderToken(tokenData);
  return tokenData;
}

function upsertDetectedPiece(piece) {
  if (!piece || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return;
  const existingById = state.tokens.find((token) => token.id === piece.id);
  const status = pieceStatus(piece.color);
  if (existingById) {
    Object.assign(existingById, {
      x: existingById.x * 0.72 + piece.x * 0.28,
      y: existingById.y * 0.72 + piece.y * 0.28,
      health: piece.health,
      mana: piece.mana,
      buffs: status.buffs,
      debuffs: status.debuffs,
      color: piece.color,
      detected: true,
      lastSeen: Date.now(),
    });
    renderToken(existingById);
    return;
  }

  const nearest = state.tokens
    .filter((token) => token.detected)
    .map((token) => ({
      token,
      distance: Math.hypot(token.x - piece.x, token.y - piece.y),
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearest && nearest.distance < 8) {
    Object.assign(nearest.token, {
      x: nearest.token.x * 0.72 + piece.x * 0.28,
      y: nearest.token.y * 0.72 + piece.y * 0.28,
      health: piece.health,
      mana: piece.mana,
      buffs: status.buffs,
      debuffs: status.debuffs,
      color: piece.color,
      detected: true,
      lastSeen: Date.now(),
    });
    renderToken(nearest.token);
    return;
  }

  addToken(piece.x, piece.y, {
    id: piece.id,
    health: piece.health,
    mana: piece.mana,
    buffs: status.buffs,
    debuffs: status.debuffs,
    color: piece.color,
    detected: true,
  });
}

function pieceStatus(color) {
  if (color === "green") return { buffs: ["Bless"], debuffs: [] };
  if (color === "blue") return { buffs: ["Shield"], debuffs: [] };
  if (color === "red") return { buffs: [], debuffs: ["Wound"] };
  if (color === "purple") return { buffs: [], debuffs: ["Hex"] };
  return { buffs: [], debuffs: [] };
}

function pieceVitals(color, count) {
  const sizeBonus = Math.min(18, Math.floor(count / 90));
  if (color === "red") return { health: Math.max(20, 42 + sizeBonus), mana: 55 };
  if (color === "purple") return { health: 72, mana: Math.max(20, 44 + sizeBonus) };
  if (color === "blue") return { health: 88, mana: Math.min(100, 82 + sizeBonus) };
  if (color === "green") return { health: Math.min(100, 86 + sizeBonus), mana: 70 };
  return { health: 100, mana: 70 };
}

function pruneStaleDetectedPieces() {
  for (const token of state.tokens) {
    if (!token.detected) continue;
    renderToken(token);
  }
}

function setActiveToolButton(tool) {
  for (const button of document.querySelectorAll("button[data-tool]")) {
    button.classList.toggle("active", button.dataset.tool === tool);
  }
}

function setFog(enabled) {
  state.fog = enabled;
  fogLayer.classList.toggle("active", enabled);
}

function revealAt(x, y) {
  fogLayer.style.setProperty("--reveal-x", `${x}%`);
  fogLayer.style.setProperty("--reveal-y", `${y}%`);
  setFog(true);
}

function showMenu(x, y) {
  menuRing.classList.remove("hidden");
  menuRing.style.left = `${x}%`;
  menuRing.style.top = `${y}%`;
}

function hideMenu() {
  menuRing.classList.add("hidden");
}

function triggerEffect(effect, x, y) {
  hideMenu();
  state.lastEffect = `${effect} at ${Math.round(x)}, ${Math.round(y)}`;
  const colors = {
    fire: ["#ffcf66", "#ff5b2e", "#7d1f16"],
    ice: ["#e4fbff", "#73d7f2", "#316da3"],
    heal: ["#fbffe4", "#65db7d", "#2d8f57"],
    shock: ["#f2e85c", "#7e6cff", "#ffffff"],
  }[effect] || ["#ffffff", "#d7aa4d", "#db4d37"];

  const centerX = (x / 100) * effectCanvas.width;
  const centerY = (y / 100) * effectCanvas.height;
  state.particles.push({
    x: centerX,
    y: centerY,
    vx: 0,
    vy: 0,
    life: 34,
    maxLife: 34,
    size: 18,
    color: colors[1],
    ring: true,
  });

  for (let i = 0; i < 120; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.9 + Math.random() * 5.6;
    state.particles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 44 + Math.random() * 34,
      maxLife: 78,
      size: 2 + Math.random() * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      ring: false,
    });
  }
}

function animateAmbient(time = 0) {
  const w = ambientCanvas.width;
  const h = ambientCanvas.height;
  ambientCtx.clearRect(0, 0, w, h);
  ambientCtx.globalCompositeOperation = "source-over";

  const glowA = ambientCtx.createRadialGradient(
    w * (0.25 + Math.sin(time / 3600) * 0.03),
    h * 0.28,
    0,
    w * 0.25,
    h * 0.28,
    w * 0.52,
  );
  glowA.addColorStop(0, "rgba(230, 178, 82, 0.28)");
  glowA.addColorStop(0.55, "rgba(190, 76, 45, 0.12)");
  glowA.addColorStop(1, "rgba(0, 0, 0, 0)");
  ambientCtx.fillStyle = glowA;
  ambientCtx.fillRect(0, 0, w, h);

  const glowB = ambientCtx.createRadialGradient(
    w * 0.76,
    h * (0.68 + Math.cos(time / 4200) * 0.04),
    0,
    w * 0.76,
    h * 0.68,
    w * 0.46,
  );
  glowB.addColorStop(0, "rgba(54, 168, 151, 0.22)");
  glowB.addColorStop(0.65, "rgba(53, 90, 105, 0.09)");
  glowB.addColorStop(1, "rgba(0, 0, 0, 0)");
  ambientCtx.fillStyle = glowB;
  ambientCtx.fillRect(0, 0, w, h);

  ambientCtx.globalAlpha = 0.22;
  for (let i = 0; i < 16; i += 1) {
    const px = (Math.sin(time / 1800 + i * 7.13) * 0.5 + 0.5) * w;
    const py = (Math.cos(time / 2200 + i * 4.71) * 0.5 + 0.5) * h;
    ambientCtx.fillStyle = i % 2 ? "#d9b35d" : "#35a18e";
    ambientCtx.beginPath();
    ambientCtx.arc(px, py, 1.3 + (i % 4), 0, Math.PI * 2);
    ambientCtx.fill();
  }
  ambientCtx.globalAlpha = 1;

  requestAnimationFrame(animateAmbient);
}
animateAmbient();

function animateEffects() {
  effectCtx.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const p of state.particles) {
    const alpha = Math.max(0, p.life / (p.maxLife || 70));
    if (p.ring) {
      const radius = (1 - alpha) * 130 + p.size;
      effectCtx.globalAlpha = alpha * 0.9;
      effectCtx.lineWidth = 5;
      effectCtx.strokeStyle = p.color;
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      effectCtx.stroke();
      p.life -= 1;
    } else {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.035;
      p.life -= 1;
      effectCtx.globalAlpha = alpha;
      effectCtx.shadowColor = p.color;
      effectCtx.shadowBlur = 18;
      effectCtx.beginPath();
      effectCtx.fillStyle = p.color;
      effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      effectCtx.fill();
      effectCtx.shadowBlur = 0;
    }
  }
  effectCtx.globalAlpha = 1;
  requestAnimationFrame(animateEffects);
}
animateEffects();

function clearOverlays() {
  tokenLayer.innerHTML = "";
  state.tokens = [];
  state.particles = [];
  setFog(false);
  hideMenu();
}

stage.addEventListener("click", (event) => {
  const point = stagePoint(event);
  if (state.tool === "token") {
    addToken(point.x, point.y);
    broadcast("token", point);
  }
  if (state.tool === "menu") {
    showMenu(point.x, point.y);
    broadcast("menu", point);
  }
  if (state.tool === "fog") {
    setFog(!state.fog);
    broadcast("fog", { enabled: state.fog });
  }
  if (state.tool === "reveal") {
    revealAt(point.x, point.y);
    broadcast("reveal", point);
  }
});

menuRing.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-effect]");
  if (!button) return;
  event.stopPropagation();
  const x = parseFloat(menuRing.style.left);
  const y = parseFloat(menuRing.style.top);
  triggerEffect(button.dataset.effect, x, y);
  broadcast("effect", { effect: button.dataset.effect, x, y });
});

for (const button of menuRing.querySelectorAll("button[data-effect]")) {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const x = parseFloat(menuRing.style.left);
    const y = parseFloat(menuRing.style.top);
    triggerEffect(button.dataset.effect, x, y);
    broadcast("effect", { effect: button.dataset.effect, x, y });
  });
}

function bindControls() {
  const videoInput = document.getElementById("videoInput");
  if (!videoInput) return;
  const mediaSelect = document.getElementById("mediaSelect");

  refreshMediaLibrary(mediaSelect);

  mediaSelect.addEventListener("change", () => {
    if (!mediaSelect.value) return;
    loadMapUrl(mediaSelect.value);
    broadcast("map", { url: mediaSelect.value });
  });

  videoInput.addEventListener("change", () => {
    const file = videoInput.files[0];
    if (!file) return;
    video.src = URL.createObjectURL(file);
    projectorHint.hidden = true;
    video.play();
  });

  document.getElementById("playPauseButton").addEventListener("click", () => {
    if (video.paused) {
      video.play();
      broadcast("play");
    } else {
      video.pause();
      broadcast("pause");
    }
  });

  document.getElementById("fullscreenButton").addEventListener("click", () => {
    stage.requestFullscreen();
  });

  document.getElementById("projectorButton").addEventListener("click", () => {
    window.open(`${location.pathname}?screen=projector`, "dnd-projector");
  });

  document.getElementById("brightnessSlider").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    setBrightness(value);
    broadcast("brightness", { value });
  });

  document.getElementById("gridSlider").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    setGrid(value);
    broadcast("grid", { value });
  });

  for (const button of document.querySelectorAll("button[data-tool]")) {
    button.addEventListener("click", () => {
      state.tool = button.dataset.tool;
      setActiveToolButton(state.tool);
    });
  }
  setActiveToolButton(state.tool);

  for (const button of document.querySelectorAll(".spell-grid button[data-effect]")) {
    button.addEventListener("click", () => {
      triggerEffect(button.dataset.effect, 50, 50);
      broadcast("effect", { effect: button.dataset.effect, x: 50, y: 50 });
    });
  }

  document.getElementById("clearButton").addEventListener("click", () => {
    clearOverlays();
    broadcast("clear");
  });

  document.getElementById("cameraButton").addEventListener("click", startCamera);
  document.getElementById("calibrateButton").addEventListener("click", () => {
    state.calibrating = true;
    state.calibrationPoints = [];
    cameraStatus.textContent = "Calibration armed: tap four board corners in camera view";
  });

  bindAiControls();
}

bindControls();

async function bindAiControls() {
  await refreshAiStatus();

  document.getElementById("askAiButton").addEventListener("click", () => {
    askAi(aiQuestion.value);
  });

  for (const button of document.querySelectorAll("button[data-ai-prompt]")) {
    button.addEventListener("click", () => {
      aiQuestion.value = button.dataset.aiPrompt;
      askAi(button.dataset.aiPrompt);
    });
  }
}

async function refreshAiStatus() {
  try {
    const response = await fetch("/api/ai/status");
    const status = await response.json();
    aiStatus.textContent = status.configured ? status.model : "No key";
    aiStatus.classList.toggle("ready", status.configured);
    aiStatus.classList.toggle("missing", !status.configured);
  } catch {
    aiStatus.textContent = "Offline";
    aiStatus.classList.add("missing");
  }
}

function encounterContext() {
  return {
    map: state.currentMap || "No synced media map selected",
    fog_enabled: state.fog,
    token_count: state.tokens.length,
    token_positions_percent: state.tokens.slice(-12),
    last_camera_motion_percent: state.lastMotion,
    last_spell_effect: state.lastEffect || "None",
    active_tool: state.tool,
    video_time_seconds: Number.isFinite(video.currentTime) ? Math.round(video.currentTime) : 0,
    dm_notes: encounterNotes.value.trim(),
  };
}

function addAiMessage(text, type = "assistant") {
  const message = document.createElement("div");
  message.className = `ai-message ${type}`;
  message.textContent = text;
  aiLog.appendChild(message);
  aiLog.scrollTop = aiLog.scrollHeight;
}

async function askAi(question) {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) return;
  addAiMessage(cleanQuestion, "user");
  aiQuestion.value = "";
  const pending = document.createElement("div");
  pending.className = "ai-message";
  pending.textContent = "Thinking...";
  aiLog.appendChild(pending);
  aiLog.scrollTop = aiLog.scrollHeight;

  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: aiMode.value,
        question: cleanQuestion,
        context: encounterContext(),
      }),
    });
    const payload = await response.json();
    pending.remove();
    if (!payload.ok) {
      addAiMessage(payload.error || "AI request failed.", "error");
      await refreshAiStatus();
      return;
    }
    addAiMessage(payload.answer);
  } catch {
    pending.remove();
    addAiMessage("Could not reach the local AI endpoint.", "error");
  }
}

async function refreshMediaLibrary(select) {
  try {
    const response = await fetch("/api/media");
    const files = await response.json();
    for (const file of files) {
      const option = document.createElement("option");
      option.value = file.url;
      option.textContent = file.name;
      select.appendChild(option);
    }
  } catch {
    const option = document.createElement("option");
    option.textContent = "Media library unavailable";
    option.disabled = true;
    select.appendChild(option);
  }
}

async function startCamera() {
  if (state.cameraRunning) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false,
  });
  cameraVideo.srcObject = stream;
  await cameraVideo.play();
  state.cameraRunning = true;
  cameraStatus.textContent = "Camera running: colored pieces become health, mana, buff, and debuff rings";
  trackCamera();
}

cameraCanvas.addEventListener("click", (event) => {
  if (!state.calibrating) return;
  const rect = cameraCanvas.getBoundingClientRect();
  state.calibrationPoints.push({
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  });
  cameraStatus.textContent = `Calibration point ${state.calibrationPoints.length}/4`;
  if (state.calibrationPoints.length >= 4) {
    state.calibrating = false;
    cameraStatus.textContent = "Calibration saved for this session";
  }
});

function trackCamera() {
  if (!state.cameraRunning) return;
  const w = cameraCanvas.width = cameraVideo.videoWidth || 640;
  const h = cameraCanvas.height = cameraVideo.videoHeight || 360;
  cameraCtx.drawImage(cameraVideo, 0, 0, w, h);
  const frame = cameraCtx.getImageData(0, 0, w, h);
  const data = frame.data;

  let motionX = 0;
  let motionY = 0;
  let motionCount = 0;
  let brightX = 0;
  let brightY = 0;
  let brightCount = 0;
  const pieces = {
    red: { x: 0, y: 0, count: 0 },
    green: { x: 0, y: 0, count: 0 },
    blue: { x: 0, y: 0, count: 0 },
    purple: { x: 0, y: 0, count: 0 },
  };

  if (state.previousFrame) {
    const previous = state.previousFrame.data;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const diff = Math.abs(data[i] - previous[i]) + Math.abs(data[i + 1] - previous[i + 1]) + Math.abs(data[i + 2] - previous[i + 2]);
      const pixel = i / 4;
      const x = pixel % w;
      const y = Math.floor(pixel / w);
      const brightness = r + g + b;
      if (diff > 90) {
        motionX += x;
        motionY += y;
        motionCount += 1;
      }
      if (brightness > 690) {
        brightX += x;
        brightY += y;
        brightCount += 1;
      }
      const color = classifyPieceColor(r, g, b);
      if (color) {
        pieces[color].x += x;
        pieces[color].y += y;
        pieces[color].count += 1;
      }
    }
  }

  cameraCtx.lineWidth = 6;
  if (motionCount > 120) {
    const x = motionX / motionCount;
    const y = motionY / motionCount;
    cameraCtx.strokeStyle = "#3b9c90";
    cameraCtx.beginPath();
    cameraCtx.arc(x, y, 28, 0, Math.PI * 2);
    cameraCtx.stroke();
    const boardPoint = cameraToBoard(x / w, y / h);
    state.lastMotion = boardPoint;
    revealAt(boardPoint.x, boardPoint.y);
    broadcast("reveal", boardPoint);
  }

  if (brightCount > 80) {
    const x = brightX / brightCount;
    const y = brightY / brightCount;
    cameraCtx.strokeStyle = "#d7aa4d";
    cameraCtx.beginPath();
    cameraCtx.arc(x, y, 34, 0, Math.PI * 2);
    cameraCtx.stroke();
    const boardPoint = cameraToBoard(x / w, y / h);
    showMenu(boardPoint.x, boardPoint.y);
    broadcast("menu", boardPoint);
  }

  const detectedPieces = [];
  for (const [color, piece] of Object.entries(pieces)) {
    if (piece.count < 45) continue;
    const x = piece.x / piece.count;
    const y = piece.y / piece.count;
    cameraCtx.strokeStyle = tokenColor(color);
    cameraCtx.beginPath();
    cameraCtx.arc(x, y, 22, 0, Math.PI * 2);
    cameraCtx.stroke();
    const boardPoint = cameraToBoard(x / w, y / h);
    const vitals = pieceVitals(color, piece.count);
    const detected = {
      id: `camera-${color}`,
      x: boardPoint.x,
      y: boardPoint.y,
      color,
      health: vitals.health,
      mana: vitals.mana,
    };
    detectedPieces.push(detected);
    upsertDetectedPiece(detected);
  }

  if (detectedPieces.length) {
    cameraStatus.textContent = `Tracking ${detectedPieces.length} colored piece${detectedPieces.length === 1 ? "" : "s"} with health, mana, and status rings`;
    const now = Date.now();
    if (now - state.lastPieceBroadcast > 280) {
      for (const piece of detectedPieces) broadcast("piece", piece);
      state.lastPieceBroadcast = now;
    }
  } else {
    pruneStaleDetectedPieces();
  }

  state.previousFrame = frame;
  requestAnimationFrame(trackCamera);
}

function classifyPieceColor(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 115 || max - min < 45) return "";
  if (r > 145 && r > g * 1.25 && r > b * 1.2) return "red";
  if (g > 135 && g > r * 1.18 && g > b * 1.12) return "green";
  if (b > 145 && b > r * 1.18 && b > g * 1.05) return "blue";
  if (r > 125 && b > 125 && r > g * 1.2 && b > g * 1.2) return "purple";
  return "";
}

function cameraToBoard(x, y) {
  return {
    x: Math.min(100, Math.max(0, x * 100)),
    y: Math.min(100, Math.max(0, y * 100)),
  };
}

