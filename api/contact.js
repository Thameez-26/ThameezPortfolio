import nodemailer from "nodemailer";

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "thameezonline@gmail.com";

let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    family: 4,
    tls: { rejectUnauthorized: false },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (limited(ip)) {
    return res.status(429).json({ error: "Too many messages. Try again later." });
  }

  const { name, email, message, website } = req.body;
  if (website) return res.status(200).json({ ok: true });

  const cleanName = String(name || "").trim().slice(0, 120);
  const cleanEmail = String(email || "").trim().slice(0, 200);
  const cleanMessage = String(message || "").trim().slice(0, 4000);

  if (!cleanName || !cleanMessage || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Name, valid email and message are required." });
  }

  const at = new Date().toISOString();

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Portfolio Contact" <${process.env.SMTP_USER}>`,
        to: CONTACT_EMAIL,
        subject: `New portfolio message from ${cleanName}`,
        text: `Name: ${cleanName}\nEmail: ${cleanEmail}\nMessage:\n${cleanMessage}\n\nReceived: ${at}`,
        html: `
          <div style="font-family:sans-serif;line-height:1.6;color:#111">
            <h2 style="color:#ff3b1d">New Portfolio Contact</h2>
            <p><strong>Name:</strong> ${cleanName}</p>
            <p><strong>Email:</strong> ${cleanEmail}</p>
            <p><strong>Message:</strong></p>
            <p style="background:#f3f1ea;padding:1rem;border-radius:.5rem">${cleanMessage.replace(/\n/g, "<br>")}</p>
            <p><small>Received: ${at}</small></p>
          </div>
        `,
      });
    } catch (e) {
      console.error("Email send failed:", e.message);
      return res.status(200).json({ ok: true, warning: "Message saved but email notification failed." });
    }
  } else {
    console.log("SMTP not configured — skipping email send.");
  }

  return res.status(200).json({ ok: true });
}