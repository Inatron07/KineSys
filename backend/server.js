import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import { ChatSDK } from "@odin-ai-staging/sdk/dist/index.esm.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const chatSDK = new ChatSDK({
  baseUrl: process.env.EKB_BASE_URL,
  projectId: process.env.EKB_PROJECT_ID,
  apiKey: process.env.EKB_API_KEY,
  apiSecret: process.env.EKB_API_SECRET
});

// Mailer for lead handoff / visitor notifications / transcripts / quote
// requests. Uses Resend's HTTP API rather than raw SMTP — hosts like
// Render's free tier block outbound SMTP ports, so this is the reliable
// path. Set RESEND_API_KEY (plus LEAD_NOTIFY_EMAIL / QUOTE_NOTIFY_EMAIL)
// in .env. The "from" address must be on a domain verified in Resend.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MAIL_FROM = "KineSys <notifications@kinesys.net>";

function parseRecipients(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, chatId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    let activeChatId = chatId;

    if (!activeChatId) {
      const chat = await chatSDK.createChat("Custom HTML UI Chat");
      activeChatId = chat.chat_id || chat.id;
    }

    const response = await chatSDK.sendMessage(message, {
      chatId: activeChatId,
      agentType: "chat_agent",
      agentId: process.env.EKB_AGENT_ID,
      useKnowledgebase: true,
      skipStream: true
    });

console.log("Full EKB Response:", JSON.stringify(response, null, 2));

const reply =
  response?.message?.final_response ||
  response?.message?.response ||
  response?.message?.content ||
  response?.message?.text ||
  response?.content ||
  response?.data?.message?.final_response ||
  response?.data?.message?.response ||
  response?.data?.message?.content ||
  response?.data?.message?.text ||
  response?.data?.content ||
  response?.response?.content ||
  response?.response?.text ||
  response?.response ||
  response?.answer ||
  response?.text ||
  JSON.stringify(response, null, 2);
 
    res.json({
      chatId: activeChatId,
      reply
    });

  } catch (error) {
    console.error("EKB Chat Error:", error);

    res.status(500).json({
      error: "Unable to process chat request.",
      details: error?.message || "Unknown error"
    });
  }
});

app.post("/api/send-lead", async (req, res) => {
  try {
    const { name, contact, who, message } = req.body;

    if (!name || !contact) {
      return res.status(400).json({ error: "Name and contact are required." });
    }

    if (!resend) {
      return res.status(503).json({
        error: "Email is not configured on the server yet.",
        details: "Set RESEND_API_KEY in .env, then restart the server."
      });
    }

    const notifyTo = process.env.LEAD_NOTIFY_EMAIL;
    const prefersLabel = who || "either";

    await resend.emails.send({
      from: MAIL_FROM,
      to: parseRecipients(notifyTo),
      replyTo: contact.includes("@") ? contact : undefined,
      subject: `New lead from Ina — ${name}`,
      text:
        `Name: ${name}\n` +
        `Contact: ${contact}\n` +
        `Prefers to hear from: ${prefersLabel}\n\n` +
        `${message ? "Message: " + message : "No extra message left."}`
    });

    res.json({ sent: true });
  } catch (error) {
    console.error("Send Lead Error:", error);
    res.status(500).json({
      error: "Unable to send the lead email.",
      details: error?.message || "Unknown error"
    });
  }
});

// Fires the moment a visitor submits the name/contact gate — a quick
// heads-up that someone new is in a chat with Ina, before there's
// necessarily anything worth calling a "lead" yet.
app.post("/api/notify-visitor", async (req, res) => {
  try {
    const { name, contact, startedAt } = req.body;

    if (!name || !contact) {
      return res.status(400).json({ error: "Name and contact are required." });
    }

    if (!resend) {
      return res.status(503).json({
        error: "Email is not configured on the server yet.",
        details: "Set RESEND_API_KEY in .env, then restart the server."
      });
    }

    const notifyTo = process.env.LEAD_NOTIFY_EMAIL;
    const when = startedAt || new Date().toLocaleString();

    await resend.emails.send({
      from: MAIL_FROM,
      to: parseRecipients(notifyTo),
      replyTo: contact.includes("@") ? contact : undefined,
      subject: `New Ina chat started — ${name}`,
      text:
        `A new visitor just started a chat with Ina on the KineSys website.\n\n` +
        `Name: ${name}\n` +
        `Contact: ${contact}\n` +
        `Started: ${when}\n\n` +
        `— Sent automatically by Ina`
    });

    res.json({ sent: true });
  } catch (error) {
    console.error("Notify Visitor Error:", error);
    res.status(500).json({
      error: "Unable to send visitor notification.",
      details: error?.message || "Unknown error"
    });
  }
});

// Fires when the visitor closes/clears the chat (or the tab) — the
// full transcript of that session, so nothing is lost even if the
// visitor never explicitly asked to talk to a human.
app.post("/api/send-transcript", async (req, res) => {
  try {
    const { name, contact, transcript } = req.body;

    if (!name || !contact || !transcript) {
      return res.status(400).json({ error: "Name, contact, and transcript are required." });
    }

    if (!resend) {
      return res.status(503).json({
        error: "Email is not configured on the server yet.",
        details: "Set RESEND_API_KEY in .env, then restart the server."
      });
    }

    const notifyTo = process.env.LEAD_NOTIFY_EMAIL;

    await resend.emails.send({
      from: MAIL_FROM,
      to: parseRecipients(notifyTo),
      replyTo: contact.includes("@") ? contact : undefined,
      subject: `Ina chat transcript — ${name}`,
      text: transcript
    });

    res.json({ sent: true });
  } catch (error) {
    console.error("Send Transcript Error:", error);
    res.status(500).json({
      error: "Unable to send transcript.",
      details: error?.message || "Unknown error"
    });
  }
});

// Fires when a visitor submits the "Get a Quote" page. Includes the
// service line, the AI/RPA category + processes they picked (if any),
// and the free-text problem description.
app.post("/api/get-quote", async (req, res) => {
  try {
    const {
      name, email, phone, company, companySize, industry,
      needHelp, category, processes, problem, budget, timeline,
      hearAbout, submittedAt
    } = req.body;

    if (!name || !email || !company || !needHelp || !problem) {
      return res.status(400).json({ error: "Name, email, company, service, and problem description are required." });
    }

    if (!resend) {
      return res.status(503).json({
        error: "Email is not configured on the server yet.",
        details: "Set RESEND_API_KEY in .env, then restart the server."
      });
    }

    const notifyTo = process.env.QUOTE_NOTIFY_EMAIL || process.env.LEAD_NOTIFY_EMAIL;
    const when = submittedAt || new Date().toLocaleString();
    const processList = Array.isArray(processes) && processes.length ? processes.join(", ") : "-";

    const lines = [
      `New quote request from the KineSys website.`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || "-"}`,
      `Company: ${company}`,
      `Company size: ${companySize || "-"}`,
      `Industry: ${industry || "-"}`,
      ``,
      `Service needed: ${needHelp}`,
      `Category: ${category || "-"}`,
      `Process(es): ${processList}`,
      ``,
      `Problem to solve: ${problem}`,
      ``,
      `Estimated budget: ${budget || "-"}`,
      `Timeline: ${timeline || "-"}`,
      `Heard about us via: ${hearAbout || "-"}`,
      ``,
      `Submitted: ${when}`,
      ``,
      `— Sent automatically by the Get a Quote page`
    ];

    await resend.emails.send({
      from: MAIL_FROM,
      to: parseRecipients(notifyTo),
      replyTo: email,
      subject: `New quote request — ${name} (${company})`,
      text: lines.join("\n")
    });

    res.json({ sent: true });
  } catch (error) {
    console.error("Get Quote Error:", error);
    res.status(500).json({
      error: "Unable to send the quote request.",
      details: error?.message || "Unknown error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`EKB custom UI chatbot running at http://localhost:${PORT}`);
});