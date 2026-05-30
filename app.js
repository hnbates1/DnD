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
const playerSelect = document.getElementById("playerSelect");
const selectedTokenBadge = document.getElementById("selectedTokenBadge");
const healthInput = document.getElementById("healthInput");
const manaInput = document.getElementById("manaInput");
const diceTotalBadge = document.getElementById("diceTotalBadge");
const diceResult = document.getElementById("diceResult");
const diceHistory = document.getElementById("diceHistory");
const diceCountInput = document.getElementById("diceCountInput");
const diceModInput = document.getElementById("diceModInput");

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

  lastPieceBroadcast: 0,
  selectedTokenId: "",
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
  try {
    const message = JSON.parse(event.newValue);
    handleMessage(message.type, message.payload);
  } catch {
    // ignore malformed storage values from other tabs
  }
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
  if (type === "tokenStatus") updateTokenStatus(payload.id, payload, false);
  if (type === "roll") showRollToast(payload);
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
  token.classList.toggle("selected", tokenData.id === state.selectedTokenId);
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
  if (!state.selectedTokenId && !isProjector) selectToken(tokenData.id);
  refreshPlayerSelect();
  return tokenData;
}

function tokenLabel(token, index) {
  const source = token.detected ? token.color : "player";
  return `${source.charAt(0).toUpperCase()}${source.slice(1)} ${index + 1}`;
}

function refreshPlayerSelect() {
  if (!playerSelect) return;
  const previous = playerSelect.value || state.selectedTokenId;
  playerSelect.innerHTML = '<option value="">Select player</option>';
  state.tokens.forEach((token, index) => {
    const option = document.createElement("option");
    option.value = token.id;
    option.textContent = tokenLabel(token, index);
    playerSelect.appendChild(option);
  });
  if (state.tokens.some((token) => token.id === previous)) {
    playerSelect.value = previous;
    state.selectedTokenId = previous;
  } else if (state.tokens.length) {
    playerSelect.value = state.tokens[0].id;
    state.selectedTokenId = state.tokens[0].id;
  } else {
    state.selectedTokenId = "";
  }
  syncStatusInputs();
}

function selectedToken() {
  return state.tokens.find((token) => token.id === state.selectedTokenId);
}

function selectToken(id) {
  state.selectedTokenId = id || "";
  if (playerSelect) playerSelect.value = state.selectedTokenId;
  syncStatusInputs();
  for (const token of state.tokens) renderToken(token);
}

function syncStatusInputs() {
  const token = selectedToken();
  if (selectedTokenBadge) {
    selectedTokenBadge.textContent = token ? token.id.replace("camera-", "") : "No player";
    selectedTokenBadge.classList.toggle("ready", Boolean(token));
  }
  if (!healthInput || !manaInput) return;
  healthInput.disabled = !token;
  manaInput.disabled = !token;
  if (!token) {
    healthInput.value = 100;
    manaInput.value = 70;
    return;
  }
  healthInput.value = Math.round(token.health);
  manaInput.value = Math.round(token.mana);
}

function clampStat(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function updateTokenStatus(id, changes, shouldBroadcast = true) {
  const token = state.tokens.find((item) => item.id === id);
  if (!token) return;
  if (changes.health !== undefined) token.health = clampStat(Number(changes.health));
  if (changes.mana !== undefined) token.mana = clampStat(Number(changes.mana));
  if (changes.buffs) token.buffs = changes.buffs;
  if (changes.debuffs) token.debuffs = changes.debuffs;
  token.lastSeen = Date.now();
  renderToken(token);
  syncStatusInputs();
  if (shouldBroadcast) {
    broadcast("tokenStatus", {
      id: token.id,
      health: token.health,
      mana: token.mana,
      buffs: token.buffs,
      debuffs: token.debuffs,
    });
  }
}

function adjustSelectedStat(stat, delta) {
  const token = selectedToken();
  if (!token) return;
  updateTokenStatus(token.id, { [stat]: clampStat(Number(token[stat]) + delta) });
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

function refreshDetectedPieces() {
  const removeCutoff = Date.now() - 8000;
  let changed = false;
  state.tokens = state.tokens.filter((token) => {
    if (token.detected && token.lastSeen < removeCutoff) {
      tokenLayer.querySelector(`[data-token-id="${token.id}"]`)?.remove();
      if (state.selectedTokenId === token.id) state.selectedTokenId = "";
      changed = true;
      return false;
    }
    return true;
  });
  for (const token of state.tokens) {
    if (token.detected) renderToken(token);
  }
  if (changed) refreshPlayerSelect();
}

setInterval(refreshDetectedPieces, 1000);

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
  const cx = (x / 100) * effectCanvas.width;
  const cy = (y / 100) * effectCanvas.height;
  const spawn = { fire: spawnFire, ice: spawnIce, shock: spawnShock, heal: spawnHeal }[effect];
  if (spawn) spawn(cx, cy);
  else spawnDefaultEffect(cx, cy);
}

function spawnFire(cx, cy) {
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 28, maxLife: 28, size: 16, color: "#ff8c2e" });
  for (let i = 0; i < 90; i++) {
    const angle = (Math.random() - 0.5) * 1.4 - Math.PI / 2;
    const speed = 1.5 + Math.random() * 5;
    const life = 35 + Math.random() * 45;
    state.particles.push({ kind: "flame", x: cx + (Math.random() - 0.5) * 24, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, size: 4 + Math.random() * 14 });
  }
  for (let i = 0; i < 45; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    const life = 40 + Math.random() * 50;
    state.particles.push({ kind: "ember", x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, life, maxLife: life, size: 1.5 + Math.random() * 3 });
  }
}

function spawnIce(cx, cy) {
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 40, maxLife: 40, size: 14, color: "#c8f0ff" });
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 26, maxLife: 26, size: 10, color: "#e4fbff" });
  const shardColors = ["#e4fbff", "#73d7f2", "#a8e8ff", "#316da3", "#ffffff"];
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    const life = 55 + Math.random() * 40;
    state.particles.push({ kind: "frost", x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life,
      size: 2 + Math.random() * 9, color: shardColors[Math.floor(Math.random() * shardColors.length)], friction: 0.91 });
  }
  for (let i = 0; i < 28; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    const life = 65 + Math.random() * 35;
    state.particles.push({ kind: "crystal", x: cx + (Math.random() - 0.5) * 40, y: cy + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed * 0.4, vy: Math.sin(angle) * speed * 0.4, life, maxLife: life,
      size: 3 + Math.random() * 6, friction: 0.97 });
  }
}

function spawnShock(cx, cy) {
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 18, maxLife: 18, size: 20, color: "#ffffff" });
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 14, maxLife: 14, size: 14, color: "#f2e85c" });
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    const life = 14 + Math.random() * 14;
    state.particles.push({ kind: "bolt", x: cx, y: cy, angle, len: 60 + Math.random() * 100,
      segments: 5 + Math.floor(Math.random() * 4), life, maxLife: life,
      color: Math.random() > 0.5 ? "#f2e85c" : "#a89dff" });
  }
  const sparkColors = ["#ffffff", "#f2e85c", "#c8b8ff", "#7e6cff"];
  for (let i = 0; i < 100; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 14;
    const life = 15 + Math.random() * 22;
    state.particles.push({ kind: "spark", x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life,
      size: 1.5 + Math.random() * 4, color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
      wobble: 1.2 + Math.random() * 2 });
  }
}

function spawnHeal(cx, cy) {
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 34, maxLife: 34, size: 18, color: "#65db7d" });
  const healColors = ["#fbffe4", "#65db7d", "#2d8f57"];
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 4;
    const life = 44 + Math.random() * 34;
    state.particles.push({ kind: "heal", x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1, life, maxLife: life,
      size: 2 + Math.random() * 10, color: healColors[Math.floor(Math.random() * healColors.length)] });
  }
}

function spawnDefaultEffect(cx, cy) {
  const colors = ["#ffffff", "#d7aa4d", "#db4d37"];
  state.particles.push({ kind: "ring", x: cx, y: cy, life: 34, maxLife: 34, size: 18, color: colors[1] });
  for (let i = 0; i < 120; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.9 + Math.random() * 5.6;
    const life = 44 + Math.random() * 34;
    state.particles.push({ kind: "default", x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life,
      size: 2 + Math.random() * 10, color: colors[Math.floor(Math.random() * colors.length)] });
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
    const t = Math.max(0, p.life / (p.maxLife || 60));

    if (p.kind === "ring") {
      const radius = (1 - t) * 130 + p.size;
      effectCtx.globalAlpha = t * 0.9;
      effectCtx.lineWidth = 5;
      effectCtx.strokeStyle = p.color;
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      effectCtx.stroke();
      p.life -= 1;
      continue;
    }

    if (p.kind === "flame") {
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.07;                          // fire rises
      p.vx += (Math.random() - 0.5) * 0.3;  // turbulence
      p.size *= 0.985;
      p.life -= 1;
      const fireColors = ["#fff8d0", "#ffdd55", "#ff8822", "#dd3311", "#8b0000"];
      const idx = Math.min(fireColors.length - 1, Math.floor((1 - t) * fireColors.length));
      effectCtx.globalAlpha = Math.min(1, t * 2.5);
      effectCtx.shadowColor = "#ff6600";
      effectCtx.shadowBlur = 20;
      effectCtx.fillStyle = fireColors[idx];
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
      effectCtx.fill();
      effectCtx.shadowBlur = 0;
      continue;
    }

    if (p.kind === "ember") {
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.04;
      p.vx *= 0.99;
      p.life -= 1;
      effectCtx.globalAlpha = t * 0.9;
      effectCtx.shadowColor = "#ff8822";
      effectCtx.shadowBlur = 8;
      effectCtx.fillStyle = t > 0.5 ? "#ffdd55" : "#ff6622";
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      effectCtx.fill();
      effectCtx.shadowBlur = 0;
      continue;
    }

    if (p.kind === "frost") {
      p.vx *= p.friction;
      p.vy *= p.friction;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      effectCtx.globalAlpha = t;
      effectCtx.shadowColor = "#73d7f2";
      effectCtx.shadowBlur = 14;
      effectCtx.fillStyle = p.color;
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      effectCtx.fill();
      effectCtx.shadowBlur = 0;
      continue;
    }

    if (p.kind === "crystal") {
      p.vx *= p.friction;
      p.vy *= p.friction;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      effectCtx.globalAlpha = t * 0.85;
      effectCtx.strokeStyle = "#c8f0ff";
      effectCtx.shadowColor = "#73d7f2";
      effectCtx.shadowBlur = 10;
      effectCtx.lineWidth = 1.5;
      effectCtx.save();
      effectCtx.translate(p.x, p.y);
      for (let arm = 0; arm < 6; arm++) {
        effectCtx.save();
        effectCtx.rotate((arm / 6) * Math.PI * 2);
        effectCtx.beginPath();
        effectCtx.moveTo(0, 0);
        effectCtx.lineTo(0, p.size);
        effectCtx.stroke();
        effectCtx.restore();
      }
      effectCtx.restore();
      effectCtx.shadowBlur = 0;
      continue;
    }

    if (p.kind === "bolt") {
      p.life -= 1;
      if (p.life % 3 !== 0) continue; // flicker like real lightning
      effectCtx.globalAlpha = t * 0.9;
      effectCtx.strokeStyle = p.color;
      effectCtx.shadowColor = "#ffffff";
      effectCtx.shadowBlur = 16;
      effectCtx.lineWidth = 2;
      effectCtx.beginPath();
      let bx = p.x, by = p.y;
      const segLen = p.len / p.segments;
      effectCtx.moveTo(bx, by);
      for (let s = 0; s < p.segments; s++) {
        bx += Math.cos(p.angle) * segLen + (Math.random() - 0.5) * 28;
        by += Math.sin(p.angle) * segLen + (Math.random() - 0.5) * 28;
        effectCtx.lineTo(bx, by);
      }
      effectCtx.stroke();
      effectCtx.shadowBlur = 0;
      continue;
    }

    if (p.kind === "spark") {
      p.vx += (Math.random() - 0.5) * p.wobble;
      p.vy += (Math.random() - 0.5) * p.wobble;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      effectCtx.globalAlpha = t;
      effectCtx.shadowColor = p.color;
      effectCtx.shadowBlur = 12;
      effectCtx.fillStyle = p.color;
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      effectCtx.fill();
      effectCtx.shadowBlur = 0;
      continue;
    }

    if (p.kind === "heal") {
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.02; // gentle upward drift
      p.vx *= 0.98;
      p.life -= 1;
      effectCtx.globalAlpha = t;
      effectCtx.shadowColor = "#65db7d";
      effectCtx.shadowBlur = 15;
      effectCtx.fillStyle = p.color;
      effectCtx.beginPath();
      effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      effectCtx.fill();
      effectCtx.shadowBlur = 0;
      continue;
    }

    // default (fallback for any unlabeled particle)
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.035;
    p.life -= 1;
    effectCtx.globalAlpha = t;
    effectCtx.shadowColor = p.color;
    effectCtx.shadowBlur = 18;
    effectCtx.fillStyle = p.color;
    effectCtx.beginPath();
    effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    effectCtx.fill();
    effectCtx.shadowBlur = 0;
  }

  effectCtx.globalAlpha = 1;
  requestAnimationFrame(animateEffects);
}
animateEffects();

function clearOverlays() {
  tokenLayer.innerHTML = "";
  state.tokens = [];
  state.selectedTokenId = "";
  state.particles = [];
  setFog(false);
  hideMenu();
  refreshPlayerSelect();
}

function randomInt(max) {
  return Math.floor(Math.random() * max) + 1;
}

function clampNumberInput(input, fallback, min, max) {
  const value = Number(input?.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function rollDice(sides, options = {}) {
  const count = options.count ?? clampNumberInput(diceCountInput, 1, 1, 20);
  const modifier = options.modifier ?? clampNumberInput(diceModInput, 0, -99, 99);
  const mode = options.mode || "normal";
  let rolls = [];
  let kept = [];

  if (sides === 20 && mode !== "normal") {
    rolls = [randomInt(20), randomInt(20)];
    kept = [mode === "advantage" ? Math.max(...rolls) : Math.min(...rolls)];
  } else {
    rolls = Array.from({ length: count }, () => randomInt(sides));
    kept = rolls;
  }

  const subtotal = kept.reduce((sum, value) => sum + value, 0);
  const total = subtotal + modifier;
  const formula = mode === "normal"
    ? `${count}d${sides}${modifier ? signedModifier(modifier) : ""}`
    : `d20 ${mode}${modifier ? signedModifier(modifier) : ""}`;
  return {
    sides,
    count,
    modifier,
    mode,
    rolls,
    kept,
    total,
    formula,
    detail: rollDetail(rolls, kept, modifier, mode),
  };
}

function signedModifier(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function rollDetail(rolls, kept, modifier, mode) {
  const base = mode === "normal" ? `[${rolls.join(", ")}]` : `[${rolls.join(", ")} keep ${kept[0]}]`;
  return modifier ? `${base} ${signedModifier(modifier)}` : base;
}

function renderRoll(roll) {
  diceTotalBadge.textContent = String(roll.total);
  diceTotalBadge.classList.add("ready");
  diceResult.textContent = `${roll.formula}: ${roll.total}`;
  const line = document.createElement("div");
  line.className = "roll-line";
  line.textContent = `${roll.formula} = ${roll.total} ${roll.detail}`;
  diceHistory.prepend(line);
  while (diceHistory.children.length > 8) diceHistory.lastElementChild.remove();
}

function showRollToast(roll) {
  if (!roll) return;
  const diceFaces = (roll.kept?.length ? roll.kept : roll.rolls || []).slice(0, 12);
  const toast = document.createElement("div");
  toast.className = "roll-toss";
  toast.innerHTML = `
    <canvas class="dice-canvas"></canvas>
    <div class="roll-summary">
      <span class="roll-total">${roll.total}</span>
      <span class="roll-formula">${roll.formula} ${roll.detail || ""}</span>
    </div>
  `;
  stage.appendChild(toast);
  const canvas = toast.querySelector(".dice-canvas");
  animate3dDice(canvas, diceFaces.map((face, index) => ({ face, sides: roll.sides, index })));
  setTimeout(() => toast.remove(), 4300);
}

function animate3dDice(canvas, dice) {
  const ctx = canvas.getContext("2d");
  const bounds = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
  canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
  ctx.scale(dpr, dpr);

  const start = performance.now();
  const duration = 3300;
  const models = dice.map((die) => {
    const spread = dice.length > 1 ? (die.index - (dice.length - 1) / 2) * 82 : 0;
    return {
      ...die,
      geometry: dieGeometry(die.sides),
      startX: die.index % 2 === 0 ? -bounds.width * 0.34 : bounds.width * 1.34,
      startY: -90 - (die.index % 3) * 36,
      landX: bounds.width / 2 + spread,
      landY: bounds.height / 2 + ((die.index % 3) - 1) * 28,
      spinX: 5.2 + die.index * 0.7,
      spinY: 6.1 + die.index * 0.5,
      spinZ: 3.4 + die.index * 0.37,
    };
  });

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    for (const die of models) draw3dDie(ctx, die, t);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function dieGeometry(sides) {
  if (sides === 4) return tetrahedron();
  if (sides === 6) return cube();
  if (sides === 8) return octahedron();
  if (sides === 10 || sides === 100) return bipyramid(10);
  return icosahedron();
}

function tetrahedron() {
  const v = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];
  return { vertices: v, faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]] };
}

function cube() {
  const v = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  return { vertices: v, faces: [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]] };
}

function octahedron() {
  const v = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  return { vertices: v, faces: [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]] };
}

function bipyramid(points) {
  const vertices = [[0, 0, 1.25], [0, 0, -1.25]];
  for (let i = 0; i < points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    vertices.push([Math.cos(a), Math.sin(a), 0]);
  }
  const faces = [];
  for (let i = 0; i < points; i += 1) {
    const a = 2 + i;
    const b = 2 + ((i + 1) % points);
    faces.push([0, a, b], [1, b, a]);
  }
  return { vertices, faces };
}

function icosahedron() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(normalize3);
  const faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  return { vertices: v, faces };
}

function draw3dDie(ctx, die, t) {
  const ease = 1 - Math.pow(1 - t, 3);
  const bounce = Math.sin(Math.min(1, t * 1.28) * Math.PI) * 110 * (1 - t);
  const x = lerp(die.startX, die.landX, ease);
  const y = lerp(die.startY, die.landY, ease) - bounce;
  const scale = 48 + Math.sin(t * Math.PI) * 8;
  const rx = die.spinX * (1 - ease) + 0.45;
  const ry = die.spinY * (1 - ease) + 0.35;
  const rz = die.spinZ * (1 - ease) + 0.2;
  const verts = die.geometry.vertices.map((p) => rotate3(p, rx, ry, rz));
  const projected = verts.map((p) => project3(p, x, y, scale));
  const faces = die.geometry.faces.map((face) => {
    const pts = face.map((i) => verts[i]);
    const z = pts.reduce((sum, p) => sum + p[2], 0) / pts.length;
    const normal = faceNormal(pts[0], pts[1], pts[2]);
    return { face, z, normal };
  }).sort((a, b) => a.z - b.z);

  ctx.save();
  ctx.globalAlpha = Math.min(1, t * 5);
  drawDieShadow(ctx, x, die.landY + 58, t);
  for (const item of faces) {
    if (item.normal[2] < -0.2) continue;
    drawFace(ctx, item.face.map((i) => projected[i]), item.normal, die.sides);
  }
  drawDieNumber(ctx, String(die.face), x, y, scale, die.sides);
  ctx.restore();
}

function drawFace(ctx, pts, normal, sides) {
  const light = normalize3([-0.35, -0.55, 1]);
  const intensity = Math.max(0.18, dot3(normalize3(normal), light));
  const hue = sides === 100 ? [72, 143, 186] : [206, 105, 54];
  const fill = `rgb(${Math.round(hue[0] * intensity + 34)}, ${Math.round(hue[1] * intensity + 22)}, ${Math.round(hue[2] * intensity + 18)})`;
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = "rgba(255, 239, 190, 0.72)";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

function drawDieNumber(ctx, text, x, y, scale, sides) {
  ctx.font = `900 ${Math.max(20, scale * 0.52)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillStyle = sides === 100 ? "#e9f7ff" : "#fff4d8";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function drawDieShadow(ctx, x, y, t) {
  ctx.save();
  ctx.globalAlpha = 0.18 + t * 0.32;
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.beginPath();
  ctx.ellipse(x, y, 58, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function project3(p, x, y, scale) {
  const distance = 4.2;
  const perspective = distance / (distance - p[2]);
  return { x: x + p[0] * scale * perspective, y: y + p[1] * scale * perspective };
}

function rotate3(p, rx, ry, rz) {
  let [x, y, z] = p;
  let cy = Math.cos(rx), sy = Math.sin(rx);
  [y, z] = [y * cy - z * sy, y * sy + z * cy];
  cy = Math.cos(ry); sy = Math.sin(ry);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  cy = Math.cos(rz); sy = Math.sin(rz);
  [x, y] = [x * cy - y * sy, x * sy + y * cy];
  return [x, y, z];
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function normalize3(p) {
  const len = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / len, p[1] / len, p[2] / len];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function performRoll(sides, mode = "normal") {
  const roll = rollDice(sides, { mode });
  renderRoll(roll);
  showRollToast(roll);
  broadcast("roll", roll);
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

  bindPlayerStatusControls();
  bindDiceControls();

  document.getElementById("cameraButton").addEventListener("click", startCamera);
  document.getElementById("calibrateButton").addEventListener("click", () => {
    state.calibrating = true;
    state.calibrationPoints = [];
    cameraStatus.textContent = "Calibration armed: tap four board corners in camera view";
  });

  bindAiControls();
}

bindControls();

function bindPlayerStatusControls() {
  if (!playerSelect || !healthInput || !manaInput) return;
  playerSelect.addEventListener("change", () => selectToken(playerSelect.value));
  healthInput.addEventListener("change", () => {
    const token = selectedToken();
    if (token) updateTokenStatus(token.id, { health: healthInput.value });
  });
  healthInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const token = selectedToken();
    if (token) updateTokenStatus(token.id, { health: healthInput.value });
  });
  manaInput.addEventListener("change", () => {
    const token = selectedToken();
    if (token) updateTokenStatus(token.id, { mana: manaInput.value });
  });
  manaInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const token = selectedToken();
    if (token) updateTokenStatus(token.id, { mana: manaInput.value });
  });

  for (const button of document.querySelectorAll("button[data-stat][data-delta]")) {
    button.addEventListener("click", () => {
      adjustSelectedStat(button.dataset.stat, Number(button.dataset.delta));
    });
  }

  document.getElementById("fullHealthButton").addEventListener("click", () => {
    const token = selectedToken();
    if (token) updateTokenStatus(token.id, { health: 100 });
  });
  document.getElementById("fullManaButton").addEventListener("click", () => {
    const token = selectedToken();
    if (token) updateTokenStatus(token.id, { mana: 100 });
  });
  refreshPlayerSelect();
}

function bindDiceControls() {
  if (!diceResult || !diceHistory) return;
  for (const button of document.querySelectorAll("button[data-die]")) {
    button.addEventListener("click", () => performRoll(Number(button.dataset.die)));
  }
  document.getElementById("advantageButton").addEventListener("click", () => performRoll(20, "advantage"));
  document.getElementById("disadvantageButton").addEventListener("click", () => performRoll(20, "disadvantage"));
  document.getElementById("clearDiceButton").addEventListener("click", () => {
    diceHistory.innerHTML = "";
    diceResult.textContent = "Choose a die";
    diceTotalBadge.textContent = "Ready";
    diceTotalBadge.classList.remove("ready");
  });
}

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
    refreshDetectedPieces();
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

function cameraToBoard(nx, ny) {
  if (state.calibrationPoints.length < 4) {
    return { x: Math.min(100, Math.max(0, nx * 100)), y: Math.min(100, Math.max(0, ny * 100)) };
  }

  // Sort the 4 tapped corners into top-left, top-right, bottom-left, bottom-right
  const pts = [...state.calibrationPoints].sort((a, b) => a.y - b.y);
  const top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = pts.slice(2).sort((a, b) => a.x - b.x);
  const tl = top[0], tr = top[1], bl = bot[0], br = bot[1];

  // Iterative inverse bilinear interpolation: find (s,t) in [0,1] such that
  // the bilinear blend of the four corners equals the camera point (nx,ny).
  // s=0→left edge, s=1→right edge; t=0→top edge, t=1→bottom edge.
  let s = 0.5, t = 0.5;
  for (let i = 0; i < 20; i++) {
    const px = (1 - s) * (1 - t) * tl.x + s * (1 - t) * tr.x + (1 - s) * t * bl.x + s * t * br.x;
    const py = (1 - s) * (1 - t) * tl.y + s * (1 - t) * tr.y + (1 - s) * t * bl.y + s * t * br.y;
    const ex = px - nx;
    const ey = py - ny;
    if (ex * ex + ey * ey < 1e-10) break;

    const dpxds = (1 - t) * (tr.x - tl.x) + t * (br.x - bl.x);
    const dpyds = (1 - t) * (tr.y - tl.y) + t * (br.y - bl.y);
    const dpxdt = (1 - s) * (bl.x - tl.x) + s * (br.x - tr.x);
    const dpydt = (1 - s) * (bl.y - tl.y) + s * (br.y - tr.y);

    const det = dpxds * dpydt - dpyds * dpxdt;
    if (Math.abs(det) < 1e-10) break;

    s -= (dpydt * ex - dpxdt * ey) / det;
    t -= (dpxds * ey - dpyds * ex) / det;
    s = Math.max(0, Math.min(1, s));
    t = Math.max(0, Math.min(1, t));
  }

  return { x: s * 100, y: t * 100 };
}
