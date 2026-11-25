// Zero-dependency backend for the Thameez Ahamed A portfolio.
// Run:  node server.js        (Node 18+)
// Env:  PORT=3000  ADMIN_TOKEN=choose-a-secret
//       SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=your@gmail.com SMTP_PASS=your-app-password
//       CONTACT_EMAIL=thameezonline@gmail.com
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const FILE = path.join(__dirname, "messages.jsonl");
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "thameezonline@gmail.com";
const hits = new Map(); // ip -> [timestamps]

const dns = require("dns");
const net = require("net");

async function resolveHost(host) {
  try {
    const addrs = await new Promise((resolve, reject) => {
      dns.resolve4(host, (err, addrs) => err ? reject(err) : resolve(addrs));
    });
    return addrs[0];
  } catch {
    return host;
  }
}

// SMTP transporter (Gmail / any SMTP)
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  (async () => {
    const ip = await resolveHost(smtpHost);
    console.log("SMTP host resolved:", smtpHost, "->", ip);
    transporter = nodemailer.createTransport({
      host: ip,
      port: smtpPort,
      secure: false,
      family: 4,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    // verify connection
    transporter.verify(err => {
      if (err) console.error("SMTP verify failed:", err.message);
      else console.log("SMTP ready");
    });
  })();
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10; // 10 messages / hour / IP
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => {
      data += c;
      if (data.length > 20000) { reject(new Error("Too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Bad JSON")); } });
  });
}

async function sendContactEmail({ name, email, message, at }) {
  if (!transporter) {
    console.log("SMTP not configured — skipping email send.");
    return { error: "SMTP not configured" };
  }
  try {
    console.log("Attempting to send email to:", CONTACT_EMAIL);
    await transporter.sendMail({
      from: `"Portfolio Contact" <${process.env.SMTP_USER}>`,
      to: CONTACT_EMAIL,
      subject: `New portfolio message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nMessage:\n${message}\n\nReceived: ${at}`,
      html: `
        <div style="font-family:sans-serif;line-height:1.6;color:#111">
          <h2 style="color:#ff3b1d">New Portfolio Contact</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p style="background:#f3f1ea;padding:1rem;border-radius:.5rem">${message.replace(/\n/g, "<br>")}</p>
          <p><small>Received: ${at}</small></p>
        </div>
      `,
    });
    console.log("Email sent successfully!");
    return { success: true };
  } catch (e) {
    console.error("Email send failed:", e.message);
    return { error: e.message };
  }
}

http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "POST" && url === "/api/contact") {
    try {
      const ip = req.socket.remoteAddress;
      if (limited(ip)) return json(res, 429, { error: "Too many messages. Try again later." });
      const d = await body(req);
      if (d.website) return json(res, 200, { ok: true }); // honeypot
      const name = String(d.name || "").trim().slice(0, 120);
      const email = String(d.email || "").trim().slice(0, 200);
      const message = String(d.message || "").trim().slice(0, 4000);
      if (!name || !message || !/^\S+@\S+\.\S+$/.test(email))
        return json(res, 400, { error: "Name, valid email and message are required." });
      const at = new Date().toISOString();
      fs.appendFileSync(FILE, JSON.stringify({ name, email, message, ip, at }) + "\n");
      const emailResult = await sendContactEmail({ name, email, message, at });
      if (emailResult.error) {
        console.error("Email failed:", emailResult.error);
        return json(res, 200, { ok: true, warning: "Message saved but email notification failed." });
      }
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && url === "/api/messages") {
    const auth = req.headers.authorization || "";
    if (!ADMIN_TOKEN || auth !== "Bearer " + ADMIN_TOKEN) return json(res, 401, { error: "Unauthorized" });
    const rows = fs.existsSync(FILE)
      ? fs.readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
      : [];
    return json(res, 200, rows);
  }

  if (req.method === "GET") {
    const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
    const abs = path.join(__dirname, rel);
    const ok = rel === "index.html" || rel.startsWith("assets/");
    const types = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };
    if (ok && abs.startsWith(__dirname) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.writeHead(200, { "Content-Type": types[path.extname(abs)] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      return fs.createReadStream(abs).pipe(res);
    }
  }

  json(res, 404, { error: "Not found" });
}).listen(PORT, () => console.log("Thameez Ahamed A portfolio on http://localhost:" + PORT));
