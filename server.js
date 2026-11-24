
const express = require("express");
const cron = require("node-cron");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v23.0";

if (!ADMIN_PASSWORD) {
  throw new Error("Falta configurar ADMIN_PASSWORD");
}

// Proteger el panel con usuario y contraseña.
app.use((req, res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString();
      const separator = decoded.indexOf(":");
      const password = decoded.slice(separator + 1);

      if (
        separator >= 0 &&
        decoded.slice(0, separator) === "admin" &&
        password === ADMIN_PASSWORD
      ) return next();
    } catch (_) {}
  }

  res.set("WWW-Authenticate", 'Basic realm="Isabella Store"');
  res.status(401).send("Acceso restringido");
});

let settings = {
  message: "Hola, gracias por formar parte de Isabella Store ❤️",
  recipients: [],
  enabled: false
};

let sending = false;

async function sendMessage(number, message) {
  if (!WA_TOKEN || !PHONE_ID) {
    throw new Error("Falta configurar WhatsApp Cloud API");
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: number,
        type: "text",
        text: { body: message }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(result.error || result));
  }

  return result;
}

async function sendCampaign() {
  if (sending || !settings.enabled) return;

  sending = true;

  try {
    for (const number of settings.recipients) {
      try {
        await sendMessage(number, settings.message);
      } catch (error) {
        console.error("Error enviando a", number, error.message);
      }
    }
  } finally {
    sending = false;
  }
}

// Enviar automáticamente al inicio de cada hora.
cron.schedule("0 * * * *", sendCampaign, {
  timezone: "America/Managua"
});

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Isabella Store</title>
<style>
body {
  margin:0;
  background:#fff5f5;
  font-family:Arial,sans-serif;
  color:#292929;
}
header {
  background:#bd1832;
  color:white;
  padding:25px;
  text-align:center;
}
main {
  max-width:550px;
  margin:25px auto;
  padding:20px;
}
.card {
  background:white;
  border-radius:15px;
  padding:20px;
  margin-bottom:18px;
  box-shadow:0 3px 12px #0001;
}
textarea,input {
  width:100%;
  box-sizing:border-box;
  padding:13px;
  margin:10px 0;
  border:1px solid #ddd;
  border-radius:9px;
  font-size:15px;
}
textarea { min-height:120px; }
button {
  border:0;
  padding:14px;
  border-radius:9px;
  background:#bd1832;
  color:white;
  font-weight:bold;
  width:100%;
  margin-top:10px;
}
.status { font-weight:bold; }
</style>
</head>
<body>
<header>
<h1>Isabella Store</h1>
<p>Panel de mensajes de WhatsApp</p>
</header>
<main>
<div class="card">
<h3>Estado del bot</h3>
<p class="status" id="status">Cargando...</p>
<button onclick="toggle()">Activar / Detener</button>
<button onclick="sendNow()">Enviar ahora</button>
</div>
<div class="card">
<h3>Editar mensaje</h3>
<textarea id="message"></textarea>
<h3>Destinatarios autorizados</h3>
<p>Escribe números internacionales separados por comas.</p>
<input id="recipients" placeholder="50588888888,50587777777">
<button onclick="save()">Guardar configuración</button>
</div>
<p id="result"></p>
</main>
<script>
async function load() {
  const r = await fetch("/api/settings");
  const d = await r.json();
  message.value = d.message;
  recipients.value = d.recipients.join(",");
  status.textContent = d.enabled ? "ACTIVO" : "DETENIDO";
}
async function save() {
  const r = await fetch("/api/settings", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      message:message.value,
      recipients:recipients.value
        .split(",").map(x=>x.trim()).filter(Boolean)
    })
  });
  result.textContent = r.ok ? "Configuración guardada ❤️" : "Error al guardar";
}
async function toggle() {
  const r = await fetch("/api/toggle",{method:"POST"});
  if(r.ok) load();
  else result.textContent = "No se pudo cambiar el estado";
}
async function sendNow() {
  result.textContent = "Enviando...";
  const r = await fetch("/api/send",{method:"POST"});
  const d = await r.json();
  result.textContent = d.message || d.error;
}
load();
</script>
</body>
</html>
`);
});

app.get("/api/settings", (req, res) => {
  res.json(settings);
});

app.post("/api/settings", (req, res) => {
  const { message, recipients } = req.body;

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Mensaje vacío" });
  }

  if (!Array.isArray(recipients) || recipients.length > 100) {
    return res.status(400).json({ error: "Lista no válida" });
  }

  const valid = recipients.every(
    n => typeof n === "string" && /^\d{8,15}$/.test(n)
  );

  if (!valid) {
    return res.status(400).json({
      error: "Usa números internacionales sin + ni espacios"
    });
  }

  settings.message = message.trim();
  settings.recipients = recipients;
  res.json({ message: "Guardado" });
});

app.post("/api/toggle", (req, res) => {
  settings.enabled = !settings.enabled;
  res.json({ enabled: settings.enabled });
});

app.post("/api/send", async (req, res) => {
  if (sending) {
    return res.status(409).json({ error: "Ya hay un envío en curso" });
  }

  try {
    settings.enabled = false;
    sending = true;

    for (const number of settings.recipients) {
      await sendMessage(number, settings.message);
    }

    res.json({ message: "Envío finalizado" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    sending = false;
  }
});

app.listen(PORT, () => {
  console.log("Isabella Store iniciado en puerto " + PORT);
});
  
