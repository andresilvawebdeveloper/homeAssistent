# J.A.R.V.I.S. Home Dashboard

Dashboard de casa inteligente ao estilo HUD do Homem de Ferro, com um assistente de IA (Claude) que **acorda quando diz "Jarvis"**, ouve o seu pedido, controla a casa e responde em voz alta.

## Funcionalidades

- **Palavra de ativação "Jarvis"**: o microfone fica à escuta no browser; ao ouvir "Jarvis" o reator acende, toca um bip e o Jarvis ouve o comando. Pode dizer tudo de seguida ("Jarvis, liga a luz da cozinha") ou fazer uma pausa depois de "Jarvis".
- **Resposta por voz** em português de Portugal (síntese de voz do browser). O microfone fica em pausa enquanto o Jarvis fala, para ele não se ouvir a si próprio.
- **IA com ferramentas**: o Jarvis consegue ligar/desligar e ajustar dispositivos, ativar cenários (cinema, sair de casa, chegar a casa, dormir, trabalho) e consultar a meteorologia real.
- **Dashboard**: relógio, meteorologia (Open-Meteo, sem chave), sensores, dispositivos clicáveis com sliders, cenários e registo de atividade.
- Campo de texto para escrever comandos quando não quer (ou não pode) falar.

## Como correr

Requisitos: Node.js 20.12 ou superior e uma chave da API da Anthropic.

```bash
npm install
```

```bash
cp .env.example .env
```

Edite `.env` e coloque a sua `ANTHROPIC_API_KEY` (e, opcionalmente, a sua cidade para a meteorologia). Depois:

```bash
npm start
```

Abra **http://localhost:3000** no **Chrome ou Edge** (o reconhecimento de voz não funciona no Firefox), clique em **Iniciar sistemas**, autorize o microfone e diga **"Jarvis"**.

> O microfone só funciona em `localhost` ou em HTTPS. Para usar num tablet na parede, sirva o dashboard atrás de HTTPS (por exemplo com um proxy reverso).

## Exemplos de comandos

- "Jarvis, liga a luz da sala a cinquenta por cento"
- "Jarvis, põe o ar condicionado a vinte e um graus"
- "Jarvis, vou ver um filme" → ativa o cenário cinema
- "Jarvis, vai chover amanhã?"
- "Jarvis, vou sair de casa" → desliga tudo, tranca a porta, arma o alarme

## Estrutura

| Ficheiro | O quê |
|---|---|
| `server.js` | Servidor Express: estado da casa, meteorologia e o ciclo de ferramentas com o Claude (`/api/jarvis`). A chave da API fica só no servidor. |
| `public/index.html` | Layout do dashboard |
| `public/style.css` | Estilo HUD / reator |
| `public/app.js` | Palavra de ativação, reconhecimento e síntese de voz, renderização do dashboard |

## Ligar a dispositivos reais

Os dispositivos estão simulados em memória (objeto `home` em `server.js`). Para controlar a sua casa a sério, altere `applyDeviceAction()` para chamar a API do Home Assistant, MQTT, etc., e acrescente os seus dispositivos ao objeto `home.devices` — o Jarvis passa a conhecê-los automaticamente.

## Notas

- Modelo: `claude-opus-5-5` com esforço `low` para respostas rápidas em voz. Pode mudar em `server.js`.
- Está ativado o *fallback* do lado do servidor (`fallbacks: "default"`): se o modelo recusar um pedido, a API tenta automaticamente outro modelo.
- A palavra de ativação é detetada pelo reconhecimento de voz do browser (no Chrome, o áudio é processado pelos serviços da Google). Para deteção 100% local seria preciso um motor como o Porcupine ou o openWakeWord.
