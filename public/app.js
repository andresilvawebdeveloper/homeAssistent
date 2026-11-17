"use strict";

// =========================================================================
// Configuração
// =========================================================================
const LANG = "pt-PT";
const WAKE_WORD = /\b(jarvis|jarviz|jarves|jervis|djarvis|jarbas|já vis)\b[\s,.!?:;-]*/i;
const AWAKE_TIMEOUT_MS = 8000;

// Modo noite: entre NIGHT_START e NIGHT_END (horas locais) mostra o relógio grande.
const NIGHT_START = 22; // 22:00
const NIGHT_END = 7;    // 07:00
const PEEK_MS = 60 * 1000; // ao tocar no ecrã noturno, mostra o dashboard durante 1 minuto

const $ = (id) => document.getElementById(id);
const els = {
  boot: $("boot"), bootBtn: $("bootBtn"), reactor: $("reactor"), stateLabel: $("stateLabel"),
  live: $("liveTranscript"), reply: $("reply"), form: $("cmdForm"), input: $("cmdInput"),
  micBtn: $("micBtn"), micStatus: $("micStatus"), aiStatus: $("aiStatus"),
  devices: $("devices"), sensors: $("sensors"), weather: $("weather"), log: $("log"),
  time: $("time"), date: $("date"),
  night: $("night"), nightTime: $("nightTime"), nightDate: $("nightDate"),
  nightReply: $("nightReply"), themeBtn: $("themeBtn"),
};

// =========================================================================
// Relógio
// =========================================================================
function tickClock() {
  const now = new Date();
  els.time.textContent = now.toLocaleTimeString(LANG);
  const dateText = now.toLocaleDateString(LANG, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  els.date.textContent = dateText;
  els.nightTime.textContent = now.toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
  els.nightDate.textContent = dateText;
  updateDayNight(now);
}

// =========================================================================
// Dia / noite
// =========================================================================
const THEMES = ["auto", "day", "night"];
const THEME_LABEL = { auto: "AUTO", day: "☀ DIA", night: "☾ NOITE" };
let themePref = "auto";
try { themePref = localStorage.getItem("jarvis-theme") ?? "auto"; } catch {}
if (!THEMES.includes(themePref)) themePref = "auto";
let peekUntil = 0;

function isNightHour(date) {
  const h = date.getHours();
  return NIGHT_START > NIGHT_END ? h >= NIGHT_START || h < NIGHT_END : h >= NIGHT_START && h < NIGHT_END;
}

function updateDayNight(now = new Date()) {
  const wantNight = themePref === "night" || (themePref === "auto" && isNightHour(now));
  const night = wantNight && Date.now() > peekUntil;
  document.body.classList.toggle("is-night", night);
  els.night.setAttribute("aria-hidden", String(!night));
  els.themeBtn.textContent = THEME_LABEL[themePref];
}

els.themeBtn.addEventListener("click", () => {
  themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
  try { localStorage.setItem("jarvis-theme", themePref); } catch {}
  peekUntil = 0;
  updateDayNight();
});

// Tocar no ecrã noturno mostra o dashboard durante PEEK_MS
els.night.addEventListener("click", () => {
  peekUntil = Date.now() + PEEK_MS;
  updateDayNight();
});

setInterval(tickClock, 1000);
tickClock();

// =========================================================================
// Registo
// =========================================================================
function log(kind, text) {
  const div = document.createElement("div");
  div.className = `entry ${kind}`;
  const t = document.createElement("time");
  t.textContent = new Date().toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
  div.append(t, document.createTextNode(text));
  els.log.prepend(div);
  while (els.log.children.length > 60) els.log.lastChild.remove();
}

// =========================================================================
// Casa: dispositivos e sensores
// =========================================================================
const ICONS = { light: "💡", climate: "❄️", media: "📺", cover: "🪟", lock: "🔒", security: "🛡️" };
let lastState = null;

function deviceStateText(d) {
  if (d.type === "lock") return d.on ? "TRANCADA" : "DESTRANCADA";
  if (d.type === "security") return d.on ? "ARMADO" : "DESARMADO";
  if (d.type === "cover") return `${d.value}% ABERTO`;
  if (!d.on) return "DESLIGADO";
  return d.value !== null ? `LIGADO · ${d.value}${d.unit === "%" ? "%" : " " + d.unit}` : "LIGADO";
}

function renderState(state) {
  const prev = lastState;
  lastState = state;

  els.devices.replaceChildren(
    ...Object.entries(state.devices).map(([id, d]) => {
      const card = document.createElement("div");
      const active = d.type === "cover" ? d.value > 0 : d.on;
      card.className = "device" + (active ? " on" : "");
      const changed = prev && JSON.stringify(prev.devices[id]) !== JSON.stringify(d);
      if (changed) card.classList.add("flash");
      card.innerHTML = `
        <span class="dicon">${ICONS[d.type] ?? "◆"}</span>
        <div class="dname"></div>
        <div class="droom"></div>
        <div class="dstate"></div>`;
      card.querySelector(".dname").textContent = d.name;
      card.querySelector(".droom").textContent = d.room;
      card.querySelector(".dstate").textContent = deviceStateText(d);

      card.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        if (d.type === "cover") deviceAction(id, "set", d.value > 0 ? 0 : 100);
        else deviceAction(id, "toggle");
      });

      if (d.value !== null) {
        const range = document.createElement("input");
        range.type = "range";
        range.min = d.type === "climate" ? 16 : 0;
        range.max = d.type === "climate" ? 30 : 100;
        range.value = d.value;
        range.addEventListener("change", () => deviceAction(id, "set", Number(range.value)));
        card.append(range);
      }
      return card;
    }),
  );

  const s = state.sensors;
  els.sensors.innerHTML = "";
  for (const [label, value] of [
    ["Temperatura interior", `${s.temperatura_interior} °C`],
    ["Humidade", `${s.humidade} %`],
    ["Consumo energia", `${s.energia_kw} kW`],
  ]) {
    const row = document.createElement("div");
    row.className = "sensor";
    row.innerHTML = "<span></span><span></span>";
    row.children[0].textContent = label;
    row.children[1].textContent = value;
    els.sensors.append(row);
  }
}

async function loadState() {
  const res = await fetch("/api/state");
  renderState(await res.json());
}

async function deviceAction(id, action, value = null) {
  const res = await fetch(`/api/device/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value }),
  });
  if (res.ok) renderState(await res.json());
}

// =========================================================================
// Meteorologia
// =========================================================================
const WMO = [
  [[0], "☀️", "Céu limpo"], [[1, 2], "🌤️", "Pouco nublado"], [[3], "☁️", "Nublado"],
  [[45, 48], "🌫️", "Nevoeiro"], [[51, 53, 55, 56, 57], "🌦️", "Chuvisco"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "Chuva"], [[71, 73, 75, 77, 85, 86], "❄️", "Neve"],
  [[95, 96, 99], "⛈️", "Trovoada"],
];
const wmo = (code) => WMO.find(([codes]) => codes.includes(code)) ?? [[], "🌡️", "—"];

async function loadWeather() {
  try {
    const res = await fetch("/api/weather");
    const w = await res.json();
    if (!res.ok) throw new Error(w.error);
    const [, icon, desc] = wmo(w.current.weather_code);
    els.weather.innerHTML = `
      <div class="now"><span class="icon">${icon}</span><span class="temp">${Math.round(w.current.temperature_2m)}°</span></div>
      <div class="meta"></div>
      <div class="forecast"></div>`;
    els.weather.querySelector(".meta").textContent =
      `${w.city} · ${desc} · sensação ${Math.round(w.current.apparent_temperature)}° · ` +
      `humidade ${w.current.relative_humidity_2m}% · vento ${Math.round(w.current.wind_speed_10m)} km/h`;
    const fc = els.weather.querySelector(".forecast");
    w.daily.time.forEach((day, i) => {
      const d = document.createElement("div");
      const label = i === 0 ? "Hoje" : new Date(day).toLocaleDateString(LANG, { weekday: "short" });
      d.innerHTML = `<b></b>${wmo(w.daily.weather_code[i])[1]}<br>${Math.round(w.daily.temperature_2m_min[i])}° / ${Math.round(w.daily.temperature_2m_max[i])}°<br>☔ ${w.daily.precipitation_probability_max[i] ?? 0}%`;
      d.querySelector("b").textContent = label;
      fc.append(d);
    });
  } catch (err) {
    els.weather.textContent = "Meteorologia indisponível.";
  }
}

// =========================================================================
// Som (bips de ativação)
// =========================================================================
let audioCtx = null;
function beep(freq = 880, ms = 120, when = 0) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.05);
}
const wakeSound = () => { beep(660, 90); beep(990, 140, 0.1); };
const doneSound = () => { beep(990, 80); beep(660, 120, 0.09); };

// =========================================================================
// Voz do Jarvis (síntese)
// =========================================================================
let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => v.lang === LANG && /duarte|cristiano|male|homem/i.test(v.name)) ??
    voices.find((v) => v.lang === LANG) ??
    voices.find((v) => v.lang?.startsWith("pt")) ??
    null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.pitch = 0.9;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// =========================================================================
// Máquina de estados: idle → awake → thinking → speaking → idle
// =========================================================================
let mode = "idle";
let awakeTimer = null;

function setMode(next, label) {
  mode = next;
  const cls = { awake: "listening", thinking: "thinking", speaking: "speaking" }[next];
  for (const el of [els.reactor, els.night]) {
    el.classList.remove("listening", "thinking", "speaking");
    if (cls) el.classList.add(cls);
  }
  if (next === "idle") els.nightReply.textContent = "";
  els.stateLabel.textContent =
    label ??
    {
      idle: micEnabled ? 'Diga "Jarvis" para ativar' : "Microfone desligado",
      awake: "A ouvir, senhor…",
      thinking: "A processar…",
      speaking: "J.A.R.V.I.S.",
    }[next];
  els.aiStatus.className = "pill" + (next === "thinking" ? " busy" : "");
  els.aiStatus.textContent = next === "thinking" ? "IA A PENSAR" : "IA PRONTA";
}

function wake() {
  if (mode !== "idle") return;
  wakeSound();
  setMode("awake");
  clearTimeout(awakeTimer);
  awakeTimer = setTimeout(() => {
    if (mode === "awake") {
      els.live.textContent = "";
      setMode("idle");
    }
  }, AWAKE_TIMEOUT_MS);
}

async function sendCommand(text) {
  text = text.trim();
  if (!text) return;
  clearTimeout(awakeTimer);
  els.live.textContent = `“${text}”`;
  log("user", text);
  setMode("thinking");

  let reply;
  try {
    const res = await fetch("/api/jarvis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, time: new Date().toLocaleString(LANG, { dateStyle: "full", timeStyle: "short" }) }),
    });
    const data = await res.json();
    reply = data.reply ?? data.error;
    if (data.state) renderState(data.state);
    for (const a of data.actions ?? []) log("action", `⚙ ${a.tool} ${JSON.stringify(a.input)}`);
    log(res.ok ? "jarvis" : "error", reply);
    els.aiStatus.className = "pill" + (res.ok ? "" : " err");
  } catch {
    reply = "Perdi a ligação ao servidor, senhor.";
    log("error", reply);
  }

  els.reply.textContent = reply;
  els.nightReply.textContent = reply;
  doneSound();
  setMode("speaking");
  pauseRecognition();
  await speak(reply);
  els.live.textContent = "";
  setMode("idle");
  resumeRecognition();
}

// =========================================================================
// Reconhecimento de voz (palavra de ativação "Jarvis")
// =========================================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let micEnabled = false;
let paused = false;

function setMicPill() {
  els.micStatus.className = "pill " + (micEnabled && !paused ? "on" : "off");
  els.micStatus.textContent = micEnabled ? (paused ? "MIC PAUSA" : "MIC ATIVO") : "MIC OFF";
}

function handleFinal(text) {
  if (mode === "thinking" || mode === "speaking") return;
  if (mode === "awake") return sendCommand(text.replace(WAKE_WORD, ""));

  const m = text.match(WAKE_WORD);
  if (!m) return;
  const rest = text.slice(m.index + m[0].length).trim();
  if (rest.length > 2) {
    if (mode === "idle") wakeSound();
    sendCommand(rest);
  } else {
    wake();
  }
}

function initRecognition() {
  if (!SR) {
    log("error", "Este browser não suporta reconhecimento de voz. Use o Chrome ou o Edge — ou escreva os comandos.");
    setMode("idle", "Voz não suportada — use o teclado");
    return;
  }
  recognition = new SR();
  recognition.lang = LANG;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const text = r[0].transcript;
      if (r.isFinal) handleFinal(text);
      else interim += text;
    }
    if (interim && (mode === "awake" || WAKE_WORD.test(interim))) {
      if (mode === "idle") wake(); // feedback imediato ao ouvir "Jarvis"
      els.live.textContent = interim.replace(WAKE_WORD, "");
    }
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      micEnabled = false;
      log("error", "Acesso ao microfone negado.");
      setMode("idle");
    }
  };

  // O Chrome termina a sessão periodicamente — reiniciamos automaticamente.
  recognition.onend = () => {
    setMicPill();
    if (micEnabled && !paused) {
      setTimeout(() => { try { recognition.start(); } catch {} }, 250);
    }
  };

  startRecognition();
}

function startRecognition() {
  if (!recognition) return;
  micEnabled = true;
  paused = false;
  try { recognition.start(); } catch {}
  setMicPill();
  setMode(mode);
}

// Pausa enquanto o Jarvis fala, para não se ouvir a si próprio.
function pauseRecognition() {
  paused = true;
  try { recognition?.abort(); } catch {}
  setMicPill();
}
function resumeRecognition() {
  if (!micEnabled) return;
  paused = false;
  try { recognition?.start(); } catch {}
  setMicPill();
}

// =========================================================================
// Eventos da interface
// =========================================================================
els.bootBtn.addEventListener("click", async () => {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  els.boot.classList.add("hidden");
  initRecognition();
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 20 ? "Boa tarde" : "Boa noite";
  const msg = `${greet}, senhor. Todos os sistemas estão operacionais. Estou à sua disposição.`;
  els.reply.textContent = msg;
  log("jarvis", msg);
  wakeSound();
  setMode("speaking");
  pauseRecognition();
  await speak(msg);
  setMode("idle");
  resumeRecognition();
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value;
  els.input.value = "";
  if (mode === "thinking") return;
  speechSynthesis?.cancel();
  sendCommand(text);
});

els.micBtn.addEventListener("click", () => {
  if (!recognition) return;
  if (!micEnabled) startRecognition();
  speechSynthesis?.cancel();
  if (mode === "idle" || mode === "speaking") { setMode("idle"); wake(); }
});

document.querySelectorAll(".scene").forEach((b) =>
  b.addEventListener("click", () => mode !== "thinking" && sendCommand(b.dataset.cmd)),
);

// =========================================================================
// Arranque
// =========================================================================
loadState();
loadWeather();
setInterval(loadWeather, 15 * 60 * 1000);
setInterval(loadState, 10 * 1000);
setMode("idle");
