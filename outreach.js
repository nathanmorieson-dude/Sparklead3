// ═══════════════════════════════════════════════════════════════════
// SPARKLEAD — Retell AI Voice + Email Sender Service
// Handles outbound demo calls via Retell + email sends via SendGrid
// ═══════════════════════════════════════════════════════════════════
//
// SETUP:
//   npm install express cors dotenv @sendgrid/mail node-cron
//
// ENV (.env):
//   PORT=3002
//   RETELL_API_KEY=key_xxx
//   RETELL_AGENT_ID=agent_xxx
//   RETELL_FROM_NUMBER=+61xxxxxxxxx
//   SENDGRID_API_KEY=SG.xxx
//   SENDER_EMAIL=josh@yourdomain.com.au
//   SENDER_NAME=Josh Taylor
//
// USAGE:
//   node outreach.js
//   POST /email/send        — send single email
//   POST /email/queue       — queue batch for throttled sending
//   POST /voice/call        — trigger Retell demo call
//   GET  /voice/calls       — list recent calls
//   GET  /stats/daily       — today's send count
// ═══════════════════════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3002;

// ─── DAILY SEND TRACKING ──────────────────────────────────────
let dailyStats = {
  date: todayStr(),
  emails_sent: 0,
  calls_made: 0,
  log: [],
};
const DAILY_EMAIL_LIMIT = parseInt(process.env.DAILY_EMAIL_LIMIT || "15");

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNewDay() {
  if (dailyStats.date !== todayStr()) {
    console.log("[Daily] Resetting counters for new day");
    dailyStats = { date: todayStr(), emails_sent: 0, calls_made: 0, log: [] };
  }
}

// Reset at midnight
cron.schedule("0 0 * * *", () => {
  console.log("[Cron] Midnight reset");
  dailyStats = { date: todayStr(), emails_sent: 0, calls_made: 0, log: [] };
});

// ═══════════════════════════════════════════════════════════════
// EMAIL SERVICE — SendGrid
// ═══════════════════════════════════════════════════════════════

// Initialize SendGrid
let sgMail;
try {
  sgMail = require("@sendgrid/mail");
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log("[SendGrid] Initialized ✓");
  }
} catch (e) {
  console.log("[SendGrid] @sendgrid/mail not installed — email disabled");
}

// Template rendering
function renderTemplate(template, lead, senderName, senderTitle) {
  const replacements = {
    "{{company}}": lead.company || "",
    "{{name}}": (lead.contact_name || "").split(" ")[0] || "there",
    "{{source}}": lead.source || "your job listing",
    "{{state}}": lead.state || "AU",
    "{{sender_name}}": senderName || process.env.SENDER_NAME || "",
    "{{sender_title}}": senderTitle || process.env.SENDER_TITLE || "",
    "{{email}}": lead.email || "",
    "{{phone}}": lead.phone || "",
  };

  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
  }
  return result;
}

// Send a single email
async function sendEmail(lead, subject, body) {
  resetIfNewDay();

  if (dailyStats.emails_sent >= DAILY_EMAIL_LIMIT) {
    return {
      success: false,
      error: `Daily limit reached (${DAILY_EMAIL_LIMIT}/day). Try tomorrow.`,
    };
  }

  if (!lead.email) {
    return { success: false, error: "No email address for this lead" };
  }

  const msg = {
    to: lead.email,
    from: {
      email: process.env.SENDER_EMAIL,
      name: process.env.SENDER_NAME || "SparkLead",
    },
    subject,
    text: body,
    // Optional: HTML version with tracking pixel
    html: body
      .replace(/\n/g, "<br>")
      .replace(
        /→/g,
        "→"
      ),
    // SendGrid categories for analytics
    categories: ["sparklead", lead.state, lead.source?.toLowerCase().replace(/\s/g, "_")],
    // Custom args for webhook tracking
    customArgs: {
      lead_id: lead.id,
      company: lead.company,
    },
  };

  try {
    if (sgMail && process.env.SENDGRID_API_KEY) {
      await sgMail.send(msg);
    } else {
      // Dry run — log what would be sent
      console.log("[Email DRY RUN]", {
        to: msg.to,
        subject: msg.subject,
        bodyPreview: body.substring(0, 100) + "...",
      });
    }

    dailyStats.emails_sent++;
    dailyStats.log.push({
      type: "email",
      to: lead.email,
      company: lead.company,
      subject,
      time: new Date().toISOString(),
    });

    console.log(
      `[Email] ✓ Sent to ${lead.email} (${dailyStats.emails_sent}/${DAILY_EMAIL_LIMIT} today)`
    );

    return {
      success: true,
      email: lead.email,
      daily_count: dailyStats.emails_sent,
      remaining: DAILY_EMAIL_LIMIT - dailyStats.emails_sent,
    };
  } catch (err) {
    console.error(`[Email] ✗ Failed for ${lead.email}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── EMAIL ENDPOINTS ──────────────────────────────────────────

// Send single email
app.post("/email/send", async (req, res) => {
  const { lead, subject, body, sender_name, sender_title } = req.body;

  if (!lead || !subject || !body) {
    return res.status(400).json({ error: "Missing lead, subject, or body" });
  }

  const renderedSubject = renderTemplate(subject, lead, sender_name, sender_title);
  const renderedBody = renderTemplate(body, lead, sender_name, sender_title);

  const result = await sendEmail(lead, renderedSubject, renderedBody);
  res.json(result);
});

// Queue batch emails — sends with interval spacing
app.post("/email/queue", async (req, res) => {
  const { leads, subject, body, sender_name, sender_title, interval_sec = 120 } = req.body;

  if (!leads?.length || !subject || !body) {
    return res.status(400).json({ error: "Missing leads array, subject, or body" });
  }

  resetIfNewDay();
  const remaining = DAILY_EMAIL_LIMIT - dailyStats.emails_sent;
  const toSend = leads.slice(0, remaining);
  const skipped = leads.length - toSend.length;

  console.log(
    `[Queue] Processing ${toSend.length} emails (${skipped} skipped — daily limit)`
  );

  // Start async queue processing
  const queueId = `q_${Date.now()}`;
  const results = [];

  // Process in background with spacing
  (async () => {
    for (let i = 0; i < toSend.length; i++) {
      const lead = toSend[i];
      const renderedSubject = renderTemplate(subject, lead, sender_name, sender_title);
      const renderedBody = renderTemplate(body, lead, sender_name, sender_title);

      const result = await sendEmail(lead, renderedSubject, renderedBody);
      results.push({ lead_id: lead.id, ...result });

      // Wait between sends (except after last)
      if (i < toSend.length - 1) {
        console.log(`[Queue] Waiting ${interval_sec}s before next send...`);
        await new Promise((r) => setTimeout(r, interval_sec * 1000));
      }

      // Re-check daily limit (in case manual sends happened)
      resetIfNewDay();
      if (dailyStats.emails_sent >= DAILY_EMAIL_LIMIT) {
        console.log("[Queue] Daily limit hit mid-queue, stopping");
        break;
      }
    }
    console.log(`[Queue] Complete: ${results.filter((r) => r.success).length} sent`);
  })();

  // Return immediately with queue info
  res.json({
    success: true,
    queue_id: queueId,
    queued: toSend.length,
    skipped,
    interval_sec,
    message: `Processing ${toSend.length} emails at ${interval_sec}s intervals`,
  });
});

// ═══════════════════════════════════════════════════════════════
// RETELL AI VOICE SERVICE
// ═══════════════════════════════════════════════════════════════

const RETELL_BASE = "https://api.retellai.com";

async function retellFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${RETELL_BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Retell API ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── Create outbound phone call ────────────────────────────────
// This is the core function — rings the lead's phone with your
// AI receptionist agent so they experience it firsthand.
app.post("/voice/call", async (req, res) => {
  const { lead, agent_id, from_number } = req.body;

  if (!lead?.phone) {
    return res.status(400).json({ error: "Lead has no phone number" });
  }

  const agentId = agent_id || process.env.RETELL_AGENT_ID;
  const fromNumber = from_number || process.env.RETELL_FROM_NUMBER;

  if (!agentId) {
    return res.status(400).json({ error: "No Retell agent_id configured" });
  }
  if (!fromNumber) {
    return res.status(400).json({ error: "No from_number configured" });
  }
  if (!process.env.RETELL_API_KEY) {
    return res.status(400).json({ error: "No RETELL_API_KEY configured" });
  }

  // Format Australian phone number
  let phone = lead.phone.replace(/[\s()-]/g, "");
  // Convert 04xx to +614xx
  if (phone.startsWith("04")) {
    phone = "+61" + phone.slice(1);
  } else if (!phone.startsWith("+")) {
    phone = "+61" + phone;
  }

  try {
    console.log(`[Retell] Initiating call to ${phone} for ${lead.company}`);

    const callData = await retellFetch("/v2/create-phone-call", "POST", {
      agent_id: agentId,
      from_number: fromNumber,
      to_number: phone,
      // Dynamic variables your Retell agent can use in its script
      retell_llm_dynamic_variables: {
        customer_name: lead.contact_name?.split(" ")[0] || "mate",
        company_name: lead.company,
        caller_name: process.env.SENDER_NAME || "the SparkLead team",
        state: lead.state || "your area",
      },
      // Optional: set metadata for tracking
      metadata: {
        lead_id: lead.id,
        company: lead.company,
        source: "sparklead",
      },
    });

    dailyStats.calls_made++;
    dailyStats.log.push({
      type: "call",
      to: phone,
      company: lead.company,
      call_id: callData.call_id,
      time: new Date().toISOString(),
    });

    console.log(`[Retell] ✓ Call initiated: ${callData.call_id}`);

    res.json({
      success: true,
      call_id: callData.call_id,
      phone,
      agent_id: agentId,
      status: callData.call_status || "initiated",
    });
  } catch (err) {
    console.error(`[Retell] ✗ Call failed:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Get call details ──────────────────────────────────────────
app.get("/voice/call/:callId", async (req, res) => {
  try {
    const data = await retellFetch(`/v2/get-call/${req.params.callId}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List recent calls ─────────────────────────────────────────
app.get("/voice/calls", async (req, res) => {
  try {
    const data = await retellFetch("/v2/list-calls", "POST", {
      filter_criteria: [
        {
          member: "agent_id",
          operator: "eq",
          value: [process.env.RETELL_AGENT_ID],
        },
      ],
      sort_order: "descending",
      limit: 20,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List Retell agents (for settings dropdown) ────────────────
app.get("/voice/agents", async (req, res) => {
  try {
    const data = await retellFetch("/v2/list-agents");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Retell webhook — receives call events ─────────────────────
// Configure this URL in Retell dashboard: POST /voice/webhook
app.post("/voice/webhook", (req, res) => {
  const { event, call } = req.body;

  console.log(`[Retell Webhook] ${event}`, {
    call_id: call?.call_id,
    status: call?.call_status,
    duration: call?.duration_ms,
  });

  // Handle different events
  switch (event) {
    case "call_started":
      console.log(`[Webhook] Call started: ${call.call_id}`);
      break;

    case "call_ended":
      console.log(
        `[Webhook] Call ended: ${call.call_id}, duration: ${call.duration_ms}ms`
      );
      // You could update the lead stage here:
      // e.g., POST to your frontend's API to mark lead as "demo_completed"
      break;

    case "call_analyzed":
      console.log(`[Webhook] Call analyzed:`, {
        sentiment: call.call_analysis?.user_sentiment,
        summary: call.call_analysis?.call_summary,
        success: call.call_analysis?.call_successful,
      });
      break;
  }

  res.status(200).json({ received: true });
});

// ═══════════════════════════════════════════════════════════════
// STATS + MONITORING
// ═══════════════════════════════════════════════════════════════

app.get("/stats/daily", (req, res) => {
  resetIfNewDay();
  res.json({
    ...dailyStats,
    email_limit: DAILY_EMAIL_LIMIT,
    emails_remaining: Math.max(0, DAILY_EMAIL_LIMIT - dailyStats.emails_sent),
  });
});

// Root
app.get("/", (req, res) => {
  resetIfNewDay();
  res.json({
    service: "sparklead-outreach",
    status: "running",
    daily: {
      emails_sent: dailyStats.emails_sent,
      limit: DAILY_EMAIL_LIMIT,
      remaining: Math.max(0, DAILY_EMAIL_LIMIT - dailyStats.emails_sent),
    },
    endpoints: {
      "POST /email/send": "Send single email",
      "POST /email/queue": "Queue batch (throttled)",
      "POST /voice/call": "Retell outbound call",
      "GET  /voice/calls": "List recent calls",
      "GET  /voice/agents": "List Retell agents",
      "POST /voice/webhook": "Retell event webhook",
      "GET  /stats/daily": "Today's send counts",
      "GET  /health": "Health check",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "sparklead-outreach",
    retell_configured: !!process.env.RETELL_API_KEY,
    sendgrid_configured: !!process.env.SENDGRID_API_KEY,
    daily_limit: DAILY_EMAIL_LIMIT,
  });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n⚡ SparkLead Outreach Service on http://localhost:${PORT}`);
  console.log(`\n   ENDPOINTS:`);
  console.log(`   POST /email/send       — single email`);
  console.log(`   POST /email/queue      — batch with throttling`);
  console.log(`   POST /voice/call       — Retell outbound call`);
  console.log(`   GET  /voice/calls      — list recent calls`);
  console.log(`   GET  /voice/agents     — list Retell agents`);
  console.log(`   POST /voice/webhook    — Retell call events`);
  console.log(`   GET  /stats/daily      — today's counts`);
  console.log(`\n   CONFIG:`);
  console.log(
    `     RETELL_API_KEY:    ${process.env.RETELL_API_KEY ? "✓" : "✗ not set"}`
  );
  console.log(
    `     RETELL_AGENT_ID:   ${process.env.RETELL_AGENT_ID ? "✓" : "✗ not set"}`
  );
  console.log(
    `     RETELL_FROM_NUMBER:${process.env.RETELL_FROM_NUMBER ? "✓" : "✗ not set"}`
  );
  console.log(
    `     SENDGRID_API_KEY:  ${process.env.SENDGRID_API_KEY ? "✓" : "✗ not set"}`
  );
  console.log(
    `     SENDER_EMAIL:      ${process.env.SENDER_EMAIL || "not set"}`
  );
  console.log(`     DAILY_EMAIL_LIMIT: ${DAILY_EMAIL_LIMIT}/day\n`);
});
