import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MODEL = "claude-opus-5-5";
const WEATHER = {
  lat: Number(process.env.WEATHER_LAT ?? 38.72),
  lon: Number(process.env.WEATHER_LON ?? -9.14),
  city: process.env.WEATHER_CITY ?? "Lisboa",
};

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Estado da casa (simulado, em memória). Substitui por integrações reais
// (Home Assistant, MQTT, Tuya, ...) dentro de applyDeviceAction().
// ---------------------------------------------------------------------------
const home = {
  devices: {
    luz_sala: { name: "Luz da sala", type: "light", room: "Sala", on: true, value: 80, unit: "%" },
    luz_cozinha: { name: "Luz da cozinha", type: "light", room: "Cozinha", on: false, value: 100, unit: "%" },
    luz_quarto: { name: "Luz do quarto", type: "light", room: "Quarto", on: false, value: 60, unit: "%" },
    ar_condicionado: { name: "Ar condicionado", type: "climate", room: "Sala", on: false, value: 22, unit: "°C" },
    tv_sala: { name: "Televisão", type: "media", room: "Sala", on: false, value: 30, unit: "vol" },
    estores: { name: "Estores", type: "cover", room: "Sala", on: true, value: 100, unit: "% aberto" },
    porta_entrada: { name: "Fechadura da entrada", type: "lock", room: "Entrada", on: true, value: null, unit: "" },
    alarme: { name: "Alarme", type: "security", room: "Casa", on: false, value: null, unit: "" },
  },
  sensors: { temperatura_interior: 21.4, humidade: 54, energia_kw: 1.2 },
};

const SCENES = {
  cinema: { luz_sala: [true, 15], tv_sala: [true, 35], estores: [true, 0], luz_cozinha: [false] },
  sair_de_casa: {
    luz_sala: [false], luz_cozinha: [false], luz_quarto: [false], tv_sala: [false],
    ar_condicionado: [false], porta_entrada: [true], alarme: [true],
  },
  chegar_a_casa: { luz_sala: [true, 80], alarme: [false], porta_entrada: [false], estores: [true, 100] },
  dormir: {
    luz_sala: [false], luz_cozinha: [false], luz_quarto: [true, 10], tv_sala: [false],
    estores: [true, 0], porta_entrada: [true], alarme: [true],
  },
  trabalho: { luz_sala: [true, 100], estores: [true, 100], tv_sala: [false] },
};

function applyDeviceAction(id, action, value) {
  const d = home.devices[id];
  if (!d) throw new Error(`Dispositivo desconhecido: ${id}`);
  if (action === "on") d.on = true;
  else if (action === "off") d.on = false;
  else if (action === "toggle") d.on = !d.on;
  else if (action === "set") {
    if (value === null || value === undefined || d.value === null) {
      throw new Error(`O dispositivo ${d.name} não aceita valores.`);
    }
    const limits = d.type === "climate" ? [16, 30] : [0, 100];
    d.value = Math.max(limits[0], Math.min(limits[1], Number(value)));
    if (d.type !== "cover") d.on = true;
  }
  return d;
}

function homeSnapshot() {
  return JSON.stringify(home);
}

async function fetchWeather() {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER.lat}&longitude=${WEATHER.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=auto&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meteorologia indisponível (${res.status})`);
  const data = await res.json();
  return { city: WEATHER.city, current: data.current, daily: data.daily };
}

// ---------------------------------------------------------------------------
// Ferramentas que o Jarvis pode usar
// ---------------------------------------------------------------------------
const deviceIds = Object.keys(home.devices);

const tools = [
  {
    name: "control_device",
    description:
      "Controla um dispositivo da casa. action: 'on' liga, 'off' desliga, 'toggle' alterna, " +
      "'set' define o valor (brilho 0-100 para luzes, temperatura 16-30 para o ar condicionado, " +
      "volume 0-100 para a TV, abertura 0-100 para estores). Para fechaduras 'on' = trancada; " +
      "para o alarme 'on' = armado. Usa value=null quando action não é 'set'.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        device_id: { type: "string", enum: deviceIds },
        action: { type: "string", enum: ["on", "off", "toggle", "set"] },
        value: { type: ["number", "null"] },
      },
      required: ["device_id", "action", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "activate_scene",
    description:
      "Ativa um cenário pré-definido que altera vários dispositivos de uma vez: " +
      "cinema, sair_de_casa, chegar_a_casa, dormir, trabalho.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { scene: { type: "string", enum: Object.keys(SCENES) } },
      required: ["scene"],
      additionalProperties: false,
    },
  },
  {
    name: "get_weather",
    description: "Obtém a meteorologia atual e a previsão para 3 dias (códigos WMO) na cidade do utilizador.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case "control_device": {
      const d = applyDeviceAction(input.device_id, input.action, input.value);
      return { ok: true, device: input.device_id, state: d };
    }
    case "activate_scene": {
      const scene = SCENES[input.scene];
      if (!scene) throw new Error(`Cenário desconhecido: ${input.scene}`);
      for (const [id, [on, value]] of Object.entries(scene)) {
        const d = home.devices[id];
        d.on = on;
        if (value !== undefined) d.value = value;
      }
      return { ok: true, scene: input.scene };
    }
    case "get_weather":
      return await fetchWeather();
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `És o J.A.R.V.I.S., o assistente pessoal e de casa inteligente do utilizador, inspirado no mordomo digital do Homem de Ferro: educado, eficiente, confiante e com um humor britânico subtil. Tratas o utilizador por "senhor" (ou "senhora", se ele o indicar).

Falas português de Portugal. As tuas respostas são lidas em voz alta por um sintetizador, por isso:
- Responde em 1 a 3 frases curtas, naturais para serem ouvidas.
- Nunca uses markdown, listas, emojis, símbolos ou URLs.
- Escreve números e unidades de forma que soe bem falada (ex.: "vinte e dois graus").

Tens ferramentas para controlar os dispositivos da casa, ativar cenários e consultar a meteorologia. Quando o utilizador pede uma ação, executa-a com as ferramentas e confirma brevemente o que fizeste. Cada mensagem do utilizador inclui o estado atual da casa e a hora local; usa-os para responder sem chamar ferramentas desnecessariamente. Se um pedido for ambíguo, escolhe a interpretação mais sensata em vez de perguntar.`;

const MAX_HISTORY = 60;
let history = [];

function textOf(content) {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

async function askJarvis(userText, clientTime) {
  // Histórico apenas cresce (append-only) — reinicia quando fica muito longo.
  if (history.length > MAX_HISTORY) history = [];

  history.push({
    role: "user",
    content: [
      { type: "text", text: userText },
      {
        type: "text",
        text: `<contexto>Hora local: ${clientTime ?? new Date().toString()}\nEstado da casa: ${homeSnapshot()}</contexto>`,
      },
    ],
  });

  const actions = [];
  for (let i = 0; i < 8; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      tools,
      messages: history,
    });

    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return { reply: "Lamento, senhor, mas não posso ajudar com isso.", actions };
    }
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") {
      return { reply: textOf(response.content) || "Feito, senhor.", actions };
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const result = await executeTool(block.name, block.input);
        actions.push({ tool: block.name, input: block.input });
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: String(err.message), is_error: true });
      }
    }
    history.push({ role: "user", content: toolResults });
  }
  return { reply: "Peço desculpa, senhor, essa tarefa está a demorar mais do que o previsto.", actions };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(
  express.static(path.join(here, "public"), {
    setHeaders(res, filePath) {
      // O service worker nunca deve ficar em cache, para as atualizações chegarem logo.
      if (filePath.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

app.get("/api/state", (_req, res) => res.json(home));

app.post("/api/device/:id", (req, res) => {
  try {
    const { action, value = null } = req.body ?? {};
    applyDeviceAction(req.params.id, action, value);
    res.json(home);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/weather", async (_req, res) => {
  try {
    res.json(await fetchWeather());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

let busy = Promise.resolve();
app.post("/api/jarvis", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Texto vazio" });

  // Serializa os pedidos para manter o histórico consistente.
  const run = busy.then(() => askJarvis(text, req.body?.time));
  busy = run.catch(() => {});
  try {
    const result = await run;
    res.json({ ...result, state: home });
  } catch (err) {
    history = []; // estado da conversa pode estar inconsistente após um erro
    let message = "Os meus sistemas estão com problemas, senhor.";
    if (err instanceof Anthropic.AuthenticationError) {
      message = "Não consigo autenticar-me. Verifique a chave da API, senhor.";
    } else if (err instanceof Anthropic.RateLimitError) {
      message = "Estou sobrecarregado neste momento, senhor. Tente daqui a pouco.";
    } else if (err instanceof Anthropic.APIConnectionError) {
      message = "Perdi a ligação aos meus servidores, senhor.";
    }
    console.error("[jarvis]", err);
    res.status(500).json({ error: message, reply: message, state: home });
  }
});

app.post("/api/reset", (_req, res) => {
  history = [];
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`J.A.R.V.I.S. online em http://localhost:${PORT}`);
});
