# ⚡ SparkLead

**Automated outreach pipeline for selling AI receptionists to Australian electricians.**

Scrapes Indeed AU + Seek for electricians actively hiring receptionists → sends warm email sequence → triggers live Retell AI voice demo.

![License](https://img.shields.io/badge/license-MIT-yellow)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)

---

## How It Works

```
 ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 │  1. SCRAPE   │────▶│  2. EMAIL    │────▶│  3. FOLLOW   │────▶│  4. DEMO    │
 │              │     │              │     │    UP         │     │             │
 │ Indeed AU    │     │ Touch 1:     │     │ Touch 2:     │     │ Retell AI   │
 │ Seek         │     │ Warm intro   │     │ Demo offer   │     │ outbound    │
 │ + enrichment │     │ referencing  │     │ "reply GO    │     │ call to     │
 │              │     │ their job ad │     │  and I'll    │     │ their phone │
 │              │     │              │     │  ring you"   │     │             │
 └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                    │                    │                    │
       │         10-20/day throttle      120s between sends    Live AI receptionist
       │         daily limit auto-reset  respects daily cap    demo experience
```

**Why this works:** Electricians posting receptionist jobs on job boards have a *proven* pain point (missed calls) and *allocated budget* ($55K+ salary). You're offering a cheaper, 24/7 alternative at exactly the right moment.

---

## Project Structure

```
sparklead/
├── frontend/
│   └── sparklead.jsx          # React dashboard (runs in Claude artifacts or standalone)
├── backend/
│   ├── scraper.js             # Puppeteer scraper for Indeed AU + Seek
│   ├── outreach.js            # SendGrid email + Retell voice call service
│   ├── package.json
│   └── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/sparklead.git
cd sparklead/backend
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in your API keys:

| Key | Where to get it | Required |
|-----|-----------------|----------|
| `RETELL_API_KEY` | [Retell Dashboard](https://dashboard.retellai.com) | ✅ For voice demos |
| `RETELL_AGENT_ID` | Retell Dashboard → Agents | ✅ For voice demos |
| `RETELL_FROM_NUMBER` | Retell Dashboard → Phone Numbers | ✅ For voice demos |
| `SENDGRID_API_KEY` | [SendGrid](https://app.sendgrid.com/settings/api_keys) | ✅ For emails |
| `SENDER_EMAIL` | Your verified SendGrid sender | ✅ For emails |
| `HUNTER_API_KEY` | [Hunter.io](https://hunter.io/api-keys) | Optional |
| `GOOGLE_PLACES_KEY` | [Google Cloud Console](https://console.cloud.google.com) | Optional |

### 3. Run

```bash
# Both services
npm start

# Or individually
npm run scraper    # http://localhost:3001
npm run outreach   # http://localhost:3002
```

### 4. Use the Frontend

The `frontend/sparklead.jsx` file runs as a Claude artifact or can be integrated into any React app. It connects to the backend APIs at localhost:3001 and localhost:3002.

---

## API Reference

### Scraper — `localhost:3001`

```bash
# Scrape electricians hiring receptionists in Queensland
curl "localhost:3001/scrape?state=QLD&source=both"

# Indeed only, no enrichment
curl "localhost:3001/scrape?state=NSW&source=indeed&enrich=false"
```

**States:** NSW, VIC, QLD, WA, SA, TAS, ACT, NT
**Sources:** `indeed`, `seek`, `both`

### Outreach — `localhost:3002`

```bash
# Send single email
curl -X POST localhost:3002/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "lead": {
      "company": "Bright Spark Electrical",
      "contact_name": "Matt Thompson",
      "email": "matt@brightspark.com.au",
      "source": "Indeed AU",
      "state": "NSW"
    },
    "subject": "Saw you'\''re hiring a receptionist, {{company}}",
    "body": "Hi {{name}},\n\nI came across your ad on {{source}}..."
  }'

# Queue batch (throttled at interval_sec spacing)
curl -X POST localhost:3002/email/queue \
  -H "Content-Type: application/json" \
  -d '{
    "leads": [...],
    "subject": "...",
    "body": "...",
    "interval_sec": 120
  }'

# Trigger Retell voice demo
curl -X POST localhost:3002/voice/call \
  -H "Content-Type: application/json" \
  -d '{
    "lead": {
      "company": "Bright Spark Electrical",
      "contact_name": "Matt",
      "phone": "0412345678",
      "state": "NSW"
    }
  }'

# Check today's send stats
curl localhost:3002/stats/daily
```

---

## Retell Agent Setup

Create an agent in Retell with this prompt template:

```
You are an AI receptionist demo for {{company_name}}, an electrical contracting
business. You're calling {{customer_name}} to show them how the AI receptionist
would handle an incoming customer call.

Start by saying: "Hi {{customer_name}}, this is a quick demo of how your AI
receptionist would sound when customers call {{company_name}}. I'm going to
simulate an incoming call — just play along as if you're a customer calling
for an electrical job. Ready?"

Then switch to receptionist mode and handle the "call" professionally —
take their name, address, describe the electrical issue, suggest available
time slots, and confirm the booking.

After the roleplay, break character and ask: "So that's how it works for
your customers 24/7. What did you think?"
```

Dynamic variables are passed automatically: `customer_name`, `company_name`, `caller_name`, `state`.

---

## Email Domain Warmup

| Week | Daily Limit | Action |
|------|-------------|--------|
| 1 | 10/day | Set up SPF, DKIM, DMARC. Monitor bounces (<3%) |
| 2 | 15/day | Check spam folder placement |
| 3 | 20/day | Review open rates (target >40%) |
| 4+ | 20/day | Stable. Scale with additional sending domains |

Configure via `DAILY_EMAIL_LIMIT` in `.env` or the settings slider in the frontend.

---

## Enrichment Services

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| [Hunter.io](https://hunter.io) | Find email by company domain | 25 lookups/mo |
| [Apollo.io](https://apollo.io) | Email + phone + job title | 50 credits/mo |
| [Google Places](https://developers.google.com/maps) | Phone number + address | $200/mo credit |
| [ABR](https://abr.business.gov.au) | Verify AU business (ABN) | Unlimited (free) |

---

## License

MIT — see [LICENSE](LICENSE).
