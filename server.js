// ═══════════════════════════════════════════════════════════════════
// SPARKLEAD — Combined Server (Railway / single-port deployment)
// Merges scraper + outreach into one Express app
// ═══════════════════════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// DAILY SEND TRACKING
// ═══════════════════════════════════════════════════════════════
function todayStr() { return new Date().toISOString().slice(0, 10); }

let dailyStats = { date: todayStr(), emails_sent: 0, calls_made: 0, log: [] };
const DAILY_EMAIL_LIMIT = parseInt(process.env.DAILY_EMAIL_LIMIT || "15");

function resetIfNewDay() {
  if (dailyStats.date !== todayStr()) {
    console.log("[Daily] Resetting counters for new day");
    dailyStats = { date: todayStr(), emails_sent: 0, calls_made: 0, log: [] };
  }
}

cron.schedule("0 0 * * *", () => {
  dailyStats = { date: todayStr(), emails_sent: 0, calls_made: 0, log: [] };
});

// ═══════════════════════════════════════════════════════════════
// SENDGRID
// ═══════════════════════════════════════════════════════════════
let sgMail;
try {
  sgMail = require("@sendgrid/mail");
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log("[SendGrid] ✓");
  }
} catch (e) {
  console.log("[SendGrid] Not installed — email in dry-run mode");
}

function renderTemplate(template, lead, senderName, senderTitle) {
  const r = {
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
  for (const [k, v] of Object.entries(r)) {
    result = result.replace(new RegExp(k.replace(/[{}]/g, "\\$&"), "g"), v);
  }
  return result;
}

async function sendEmail(lead, subject, body) {
  resetIfNewDay();
  if (dailyStats.emails_sent >= DAILY_EMAIL_LIMIT) {
    return { success: false, error: `Daily limit reached (${DAILY_EMAIL_LIMIT}/day)` };
  }
  if (!lead.email) {
    return { success: false, error: "No email address for this lead" };
  }

  const msg = {
    to: lead.email,
    from: { email: process.env.SENDER_EMAIL, name: process.env.SENDER_NAME || "SparkLead" },
    subject,
    text: body,
    html: body.replace(/\n/g, "<br>"),
    categories: ["sparklead", lead.state, lead.source?.toLowerCase().replace(/\s/g, "_")],
    customArgs: { lead_id: lead.id, company: lead.company },
  };

  try {
    if (sgMail && process.env.SENDGRID_API_KEY) {
      await sgMail.send(msg);
    } else {
      console.log("[Email DRY RUN]", { to: msg.to, subject: msg.subject });
    }
    dailyStats.emails_sent++;
    dailyStats.log.push({ type: "email", to: lead.email, company: lead.company, subject, time: new Date().toISOString() });
    console.log(`[Email] ✓ ${lead.email} (${dailyStats.emails_sent}/${DAILY_EMAIL_LIMIT})`);
    return { success: true, email: lead.email, daily_count: dailyStats.emails_sent, remaining: DAILY_EMAIL_LIMIT - dailyStats.emails_sent };
  } catch (err) {
    console.error(`[Email] ✗ ${lead.email}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// RETELL AI
// ═══════════════════════════════════════════════════════════════
const RETELL_BASE = "https://api.retellai.com";

async function retellFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${RETELL_BASE}${path}`, opts);
  if (!res.ok) throw new Error(`Retell ${res.status}: ${await res.text()}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// SCRAPER (Puppeteer)
// ═══════════════════════════════════════════════════════════════
let puppeteer, StealthPlugin;
try {
  puppeteer = require("puppeteer-extra");
  StealthPlugin = require("puppeteer-extra-plugin-stealth");
  puppeteer.use(StealthPlugin());
  console.log("[Puppeteer] ✓");
} catch (e) {
  console.log("[Puppeteer] Not installed — scraper will use demo data");
}

const SEARCH_QUERIES = [
  "electrician receptionist",
  "electrical company receptionist",
  "electrical contractor front desk",
  "electrical business admin support",
];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function dedupeByCompany(leads) {
  const seen = new Set();
  return leads.filter(l => {
    const k = l.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function scrapeIndeed(browser, state, maxPages = 2) {
  const leads = [];
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  for (const query of SEARCH_QUERIES.slice(0, 2)) {
    for (let p = 0; p < maxPages; p++) {
      const url = `https://au.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(state + ", Australia")}&start=${p * 10}`;
      try {
        console.log(`[Indeed] "${query}" ${state} p${p + 1}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForSelector('[class*="job_seen_beacon"], [class*="resultContent"]', { timeout: 8000 }).catch(() => {});
        const jobs = await page.evaluate(() => {
          const r = [];
          document.querySelectorAll('[class*="job_seen_beacon"], [data-jk], .result').forEach(card => {
            try {
              const titleEl = card.querySelector('[class*="jobTitle"] a, .jobTitle a, h2 a');
              const companyEl = card.querySelector('[data-testid="company-name"], [class*="companyName"]');
              const locationEl = card.querySelector('[data-testid="text-location"], [class*="companyLocation"]');
              const salaryEl = card.querySelector('[class*="salary"]');
              const dateEl = card.querySelector('[class*="date"]');
              const title = titleEl?.textContent?.trim() || "";
              const company = companyEl?.textContent?.trim() || "";
              if (company && title) r.push({ title, company, location: locationEl?.textContent?.trim() || "", salary: salaryEl?.textContent?.trim() || "", posted: dateEl?.textContent?.trim() || "", jobUrl: titleEl?.href || "" });
            } catch (e) {}
          });
          return r;
        });
        jobs.forEach(j => leads.push({ ...j, source: "Indeed AU", state }));
        await delay(2000 + Math.random() * 2000);
      } catch (err) {
        console.error(`[Indeed] Error p${p + 1}:`, err.message);
      }
    }
  }
  await page.close();
  return dedupeByCompany(leads);
}

async function scrapeSeek(browser, state, maxPages = 2) {
  const leads = [];
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  const locs = { NSW:"in-New-South-Wales", VIC:"in-Victoria", QLD:"in-Queensland", WA:"in-Western-Australia", SA:"in-South-Australia", TAS:"in-Tasmania", ACT:"in-Australian-Capital-Territory", NT:"in-Northern-Territory" };
  const loc = locs[state] || locs.NSW;

  for (const query of SEARCH_QUERIES.slice(0, 2)) {
    for (let p = 1; p <= maxPages; p++) {
      const url = `https://www.seek.com.au/${encodeURIComponent(query).replace(/%20/g, "-")}-jobs/${loc}?page=${p}`;
      try {
        console.log(`[Seek] "${query}" ${state} p${p}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForSelector('[data-testid="job-card"], article[data-card-type="JobCard"]', { timeout: 8000 }).catch(() => {});
        const jobs = await page.evaluate(() => {
          const r = [];
          document.querySelectorAll('[data-testid="job-card"], article[data-card-type="JobCard"]').forEach(card => {
            try {
              const titleEl = card.querySelector('[data-testid="job-title"] a, h3 a');
              const companyEl = card.querySelector('[data-testid="company-name"], a[data-testid*="company"]');
              const locationEl = card.querySelector('[data-testid="job-location"]');
              const salaryEl = card.querySelector('[data-testid="job-salary"]');
              const title = titleEl?.textContent?.trim() || "";
              const company = companyEl?.textContent?.trim() || "";
              if (company && title) r.push({ title, company, location: locationEl?.textContent?.trim() || "", salary: salaryEl?.textContent?.trim() || "", jobUrl: titleEl?.href || "" });
            } catch (e) {}
          });
          return r;
        });
        jobs.forEach(j => leads.push({ ...j, source: "Seek", state }));
        await delay(2000 + Math.random() * 2000);
      } catch (err) {
        console.error(`[Seek] Error p${p}:`, err.message);
      }
    }
  }
  await page.close();
  return dedupeByCompany(leads);
}

// Demo data fallback
function demoLeads(state, source) {
  const cos = ["Bright Spark Electrical","PowerPoint Electric","All Spark Services","Ohm Electrical","Current Solutions","LiveWire Group","Surge Electrical","Circuit Pro","FlashPoint Electrical","Redline Electric"];
  const fns = ["Matt","Josh","Steve","Dan","Chris","Sam","Luke","Tom","Dave","Mick"];
  const lns = ["Thompson","Williams","Brown","Smith","Taylor","Wilson","Anderson","Mitchell"];
  const titles = ["Receptionist / Admin","Front Desk Coordinator","Office Administrator","Customer Service & Bookings"];
  const count = 5 + Math.floor(Math.random() * 6);
  return Array.from({ length: count }, (_, i) => ({
    id: `sl_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    company: cos[i % cos.length],
    contact_name: `${fns[Math.floor(Math.random()*fns.length)]} ${lns[Math.floor(Math.random()*lns.length)]}`,
    email: "", phone: "",
    location: `${state}, Australia`,
    state, source,
    job_title: titles[Math.floor(Math.random()*titles.length)],
    salary_range: `$${50+Math.floor(Math.random()*20)}K–$${65+Math.floor(Math.random()*15)}K`,
    posted_ago: `${1+Math.floor(Math.random()*14)}d ago`,
    stage: "scraped", emails_sent: 0, last_action: null, notes: "",
    created: new Date().toISOString(), queued_template: null,
  }));
}

function formatLead(raw, i) {
  return {
    id: `sl_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    company: raw.company, contact_name: raw.contact_name || "", email: raw.email || "",
    phone: raw.phone || "", location: raw.location || "", state: raw.state, source: raw.source,
    job_title: raw.title || "", salary_range: raw.salary || "", posted_ago: raw.posted || "",
    job_url: raw.jobUrl || "", stage: "scraped", emails_sent: 0, last_action: null, notes: "",
    created: new Date().toISOString(), queued_template: null,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// ─── ROOT ─────────────────────────────────────────────────────
app.get("/", (req, res) => {
  resetIfNewDay();
  res.json({
    service: "⚡ SparkLead",
    status: "running",
    daily: {
      emails_sent: dailyStats.emails_sent,
      calls_made: dailyStats.calls_made,
      email_limit: DAILY_EMAIL_LIMIT,
      remaining: Math.max(0, DAILY_EMAIL_LIMIT - dailyStats.emails_sent),
    },
    endpoints: {
      "GET  /":              "This page",
      "GET  /health":        "Health check",
      "GET  /scrape":        "Scrape job boards (?state=NSW&source=both)",
      "POST /email/send":    "Send single email",
      "POST /email/queue":   "Queue batch (throttled)",
      "POST /voice/call":    "Retell outbound call",
      "GET  /voice/calls":   "List recent calls",
      "GET  /voice/agents":  "List Retell agents",
      "POST /voice/webhook": "Retell event webhook",
      "GET  /stats/daily":   "Today's send counts",
    },
  });
});

// ─── HEALTH ───────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "sparklead",
    retell: !!process.env.RETELL_API_KEY,
    sendgrid: !!process.env.SENDGRID_API_KEY,
    puppeteer: !!puppeteer,
    daily_limit: DAILY_EMAIL_LIMIT,
  });
});

// ─── SCRAPE ───────────────────────────────────────────────────
app.get("/scrape", async (req, res) => {
  const { state = "NSW", source = "both" } = req.query;
  console.log(`\n⚡ Scrape: state=${state} source=${source}`);

  if (!puppeteer) {
    // No Puppeteer installed — return demo data
    const sources = source === "both" ? ["Indeed AU", "Seek"] : [source === "indeed" ? "Indeed AU" : "Seek"];
    let all = [];
    sources.forEach(s => all.push(...demoLeads(state, s)));
    return res.json({ success: true, count: all.length, state, source, demo: true, leads: all });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    let all = [];
    if (source === "both" || source === "indeed") {
      all.push(...await scrapeIndeed(browser, state));
    }
    if (source === "both" || source === "seek") {
      all.push(...await scrapeSeek(browser, state));
    }
    all = dedupeByCompany(all);
    const formatted = all.map((l, i) => formatLead(l, i));
    res.json({ success: true, count: formatted.length, state, source, leads: formatted });
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// ─── EMAIL: SEND ──────────────────────────────────────────────
app.post("/email/send", async (req, res) => {
  const { lead, subject, body, sender_name, sender_title } = req.body;
  if (!lead || !subject || !body) return res.status(400).json({ error: "Missing lead, subject, or body" });
  const result = await sendEmail(lead, renderTemplate(subject, lead, sender_name, sender_title), renderTemplate(body, lead, sender_name, sender_title));
  res.json(result);
});

// ─── EMAIL: QUEUE ─────────────────────────────────────────────
app.post("/email/queue", async (req, res) => {
  const { leads, subject, body, sender_name, sender_title, interval_sec = 120 } = req.body;
  if (!leads?.length || !subject || !body) return res.status(400).json({ error: "Missing leads, subject, or body" });

  resetIfNewDay();
  const remaining = DAILY_EMAIL_LIMIT - dailyStats.emails_sent;
  const toSend = leads.slice(0, remaining);
  const skipped = leads.length - toSend.length;
  const queueId = `q_${Date.now()}`;

  // Process in background
  (async () => {
    for (let i = 0; i < toSend.length; i++) {
      const lead = toSend[i];
      await sendEmail(lead, renderTemplate(subject, lead, sender_name, sender_title), renderTemplate(body, lead, sender_name, sender_title));
      if (i < toSend.length - 1) {
        await delay(interval_sec * 1000);
      }
      resetIfNewDay();
      if (dailyStats.emails_sent >= DAILY_EMAIL_LIMIT) break;
    }
  })();

  res.json({ success: true, queue_id: queueId, queued: toSend.length, skipped, interval_sec });
});

// ─── VOICE: CALL ──────────────────────────────────────────────
app.post("/voice/call", async (req, res) => {
  const { lead, agent_id, from_number } = req.body;
  if (!lead?.phone) return res.status(400).json({ error: "Lead has no phone number" });

  const agentId = agent_id || process.env.RETELL_AGENT_ID;
  const fromNumber = from_number || process.env.RETELL_FROM_NUMBER;
  if (!agentId) return res.status(400).json({ error: "No Retell agent_id" });
  if (!fromNumber) return res.status(400).json({ error: "No from_number" });
  if (!process.env.RETELL_API_KEY) return res.status(400).json({ error: "No RETELL_API_KEY" });

  let phone = lead.phone.replace(/[\s()-]/g, "");
  if (phone.startsWith("04")) phone = "+61" + phone.slice(1);
  else if (!phone.startsWith("+")) phone = "+61" + phone;

  try {
    const callData = await retellFetch("/v2/create-phone-call", "POST", {
      agent_id: agentId,
      from_number: fromNumber,
      to_number: phone,
      retell_llm_dynamic_variables: {
        customer_name: lead.contact_name?.split(" ")[0] || "mate",
        company_name: lead.company,
        caller_name: process.env.SENDER_NAME || "SparkLead",
        state: lead.state || "AU",
      },
      metadata: { lead_id: lead.id, company: lead.company, source: "sparklead" },
    });

    dailyStats.calls_made++;
    dailyStats.log.push({ type: "call", to: phone, company: lead.company, call_id: callData.call_id, time: new Date().toISOString() });
    console.log(`[Retell] ✓ ${callData.call_id}`);
    res.json({ success: true, call_id: callData.call_id, phone, agent_id: agentId });
  } catch (err) {
    console.error("[Retell] ✗", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── VOICE: GET CALL ──────────────────────────────────────────
app.get("/voice/call/:callId", async (req, res) => {
  try { res.json(await retellFetch(`/v2/get-call/${req.params.callId}`)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VOICE: LIST CALLS ───────────────────────────────────────
app.get("/voice/calls", async (req, res) => {
  try {
    res.json(await retellFetch("/v2/list-calls", "POST", {
      filter_criteria: [{ member: "agent_id", operator: "eq", value: [process.env.RETELL_AGENT_ID] }],
      sort_order: "descending", limit: 20,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VOICE: LIST AGENTS ──────────────────────────────────────
app.get("/voice/agents", async (req, res) => {
  try { res.json(await retellFetch("/v2/list-agents")); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VOICE: WEBHOOK ──────────────────────────────────────────
app.post("/voice/webhook", (req, res) => {
  const { event, call } = req.body;
  console.log(`[Webhook] ${event}`, { call_id: call?.call_id, status: call?.call_status });
  res.status(200).json({ received: true });
});

// ─── STATS ────────────────────────────────────────────────────
app.get("/stats/daily", (req, res) => {
  resetIfNewDay();
  res.json({ ...dailyStats, email_limit: DAILY_EMAIL_LIMIT, emails_remaining: Math.max(0, DAILY_EMAIL_LIMIT - dailyStats.emails_sent) });
});

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n⚡ SparkLead running on port ${PORT}`);
  console.log(`  Retell:    ${process.env.RETELL_API_KEY ? "✓" : "✗"}`);
  console.log(`  SendGrid:  ${process.env.SENDGRID_API_KEY ? "✓" : "✗"}`);
  console.log(`  Puppeteer: ${puppeteer ? "✓" : "✗ (demo mode)"}`);
  console.log(`  Limit:     ${DAILY_EMAIL_LIMIT}/day\n`);
});

// Graceful shutdown — Railway sends SIGTERM on redeploy
process.on("SIGTERM", () => {
  console.log("[SparkLead] SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("[SparkLead] Server closed");
    process.exit(0);
  });
  // Force close after 10s if connections don't drain
  setTimeout(() => process.exit(1), 10000);
});
