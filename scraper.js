// ═══════════════════════════════════════════════════════════════════
// SPARKLEAD — Backend Scraper
// Scrapes Indeed AU + Seek for electricians hiring receptionists
// ═══════════════════════════════════════════════════════════════════
// 
// SETUP:
//   npm init -y
//   npm install puppeteer-extra puppeteer-extra-plugin-stealth dotenv
//   npm install express cors
//
// USAGE:
//   node scraper.js                    (starts API server on :3001)
//   curl localhost:3001/scrape?state=NSW&source=both
//
// ENV (.env):
//   PORT=3001
//   HUNTER_API_KEY=xxx               (optional — for email enrichment)
//   APOLLO_API_KEY=xxx               (optional — alternative enrichment)
// ═══════════════════════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ─── SEARCH QUERIES ────────────────────────────────────────────
// These target electricians specifically looking for front desk help
const SEARCH_QUERIES = [
  "electrician receptionist",
  "electrical company receptionist",
  "electrical contractor front desk",
  "electrical business admin support",
  "sparky office administrator",
  "electrical services customer service",
];

// ─── INDEED AU SCRAPER ─────────────────────────────────────────
async function scrapeIndeed(browser, state, maxPages = 3) {
  const leads = [];
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Rotate through search queries for broader coverage
  for (const query of SEARCH_QUERIES.slice(0, 2)) {
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const start = pageNum * 10;
      const url = `https://au.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(state + ", Australia")}&start=${start}`;

      try {
        console.log(`[Indeed] Scraping: "${query}" in ${state}, page ${pageNum + 1}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

        // Wait for job cards to load
        await page.waitForSelector('[class*="job_seen_beacon"], [class*="resultContent"], .jobsearch-ResultsList', { timeout: 10000 }).catch(() => {});

        // Extract job listings
        const jobs = await page.evaluate(() => {
          const results = [];
          // Indeed uses various selectors — try multiple
          const cards = document.querySelectorAll('[class*="job_seen_beacon"], [data-jk], .result');

          cards.forEach((card) => {
            try {
              const titleEl = card.querySelector('[class*="jobTitle"] a, .jobTitle a, h2 a');
              const companyEl = card.querySelector('[data-testid="company-name"], [class*="companyName"], .company');
              const locationEl = card.querySelector('[data-testid="text-location"], [class*="companyLocation"], .location');
              const salaryEl = card.querySelector('[class*="salary"], [class*="metadata"][class*="salary"]');
              const dateEl = card.querySelector('[class*="date"], .date');

              const title = titleEl?.textContent?.trim() || "";
              const company = companyEl?.textContent?.trim() || "";
              const location = locationEl?.textContent?.trim() || "";
              const salary = salaryEl?.textContent?.trim() || "";
              const posted = dateEl?.textContent?.trim() || "";
              const jobUrl = titleEl?.href || "";

              // Only include if the job title suggests receptionist/admin role
              const titleLower = title.toLowerCase();
              const isReceptionist =
                titleLower.includes("receptionist") ||
                titleLower.includes("front desk") ||
                titleLower.includes("admin") ||
                titleLower.includes("office") ||
                titleLower.includes("customer service") ||
                titleLower.includes("coordinator") ||
                titleLower.includes("phone") ||
                titleLower.includes("bookings");

              // And company suggests electrical trade
              const companyLower = company.toLowerCase();
              const isElectrical =
                companyLower.includes("electri") ||
                companyLower.includes("spark") ||
                companyLower.includes("power") ||
                companyLower.includes("volt") ||
                companyLower.includes("circuit") ||
                companyLower.includes("wire") ||
                companyLower.includes("current") ||
                companyLower.includes("surge") ||
                companyLower.includes("ohm");

              if (company && (isReceptionist || isElectrical)) {
                results.push({ title, company, location, salary, posted, jobUrl });
              }
            } catch (e) {
              // Skip malformed cards
            }
          });
          return results;
        });

        jobs.forEach((job) => {
          leads.push({
            ...job,
            source: "Indeed AU",
            state,
          });
        });

        // Respectful delay between pages
        await delay(2000 + Math.random() * 2000);
      } catch (err) {
        console.error(`[Indeed] Error on page ${pageNum + 1}:`, err.message);
      }
    }
  }

  await page.close();
  return dedupeByCompany(leads);
}

// ─── SEEK SCRAPER ──────────────────────────────────────────────
async function scrapeSeek(browser, state, maxPages = 3) {
  const leads = [];
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Seek state location codes
  const seekLocations = {
    NSW: "in-New-South-Wales",
    VIC: "in-Victoria",
    QLD: "in-Queensland",
    WA: "in-Western-Australia",
    SA: "in-South-Australia",
    TAS: "in-Tasmania",
    ACT: "in-Australian-Capital-Territory",
    NT: "in-Northern-Territory",
  };

  const loc = seekLocations[state] || seekLocations.NSW;

  for (const query of SEARCH_QUERIES.slice(0, 2)) {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `https://www.seek.com.au/${encodeURIComponent(query).replace(/%20/g, "-")}-jobs/${loc}?page=${pageNum}`;

      try {
        console.log(`[Seek] Scraping: "${query}" in ${state}, page ${pageNum}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

        await page.waitForSelector('[data-testid="job-card"], article[data-card-type="JobCard"], [class*="JobCard"]', { timeout: 10000 }).catch(() => {});

        const jobs = await page.evaluate(() => {
          const results = [];
          const cards = document.querySelectorAll(
            '[data-testid="job-card"], article[data-card-type="JobCard"], [class*="_1wkzzau0"]'
          );

          cards.forEach((card) => {
            try {
              const titleEl = card.querySelector('[data-testid="job-title"] a, h3 a, [class*="jobTitle"] a');
              const companyEl = card.querySelector('[data-testid="company-name"], [class*="company"], a[data-testid*="company"]');
              const locationEl = card.querySelector('[data-testid="job-location"], [class*="location"]');
              const salaryEl = card.querySelector('[data-testid="job-salary"], [class*="salary"]');
              const dateEl = card.querySelector('[class*="listed"], time, [data-testid*="time"]');

              const title = titleEl?.textContent?.trim() || "";
              const company = companyEl?.textContent?.trim() || "";
              const location = locationEl?.textContent?.trim() || "";
              const salary = salaryEl?.textContent?.trim() || "";
              const posted = dateEl?.textContent?.trim() || "";
              const jobUrl = titleEl?.href || "";

              if (company && title) {
                results.push({ title, company, location, salary, posted, jobUrl });
              }
            } catch (e) {}
          });
          return results;
        });

        jobs.forEach((job) => {
          leads.push({
            ...job,
            source: "Seek",
            state,
          });
        });

        await delay(2000 + Math.random() * 2000);
      } catch (err) {
        console.error(`[Seek] Error on page ${pageNum}:`, err.message);
      }
    }
  }

  await page.close();
  return dedupeByCompany(leads);
}

// ─── EMAIL ENRICHMENT ──────────────────────────────────────────
// Uses Hunter.io to find email addresses from company domain
async function enrichWithHunter(leads) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    console.log("[Enrich] No HUNTER_API_KEY set — skipping email enrichment");
    return leads;
  }

  const enriched = [];
  for (const lead of leads) {
    try {
      // Step 1: Find domain from company name
      const domainRes = await fetch(
        `https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(lead.company)}&api_key=${apiKey}`
      );
      const domainData = await domainRes.json();

      if (domainData.data?.domain) {
        const domain = domainData.data.domain;
        const emails = domainData.data.emails || [];

        // Prefer owner/founder/manager emails
        const priorityRoles = ["owner", "founder", "director", "manager", "ceo"];
        const bestEmail = emails.find((e) =>
          priorityRoles.some((r) => (e.position || "").toLowerCase().includes(r))
        ) || emails[0];

        enriched.push({
          ...lead,
          email: bestEmail?.value || "",
          contact_name: bestEmail
            ? `${bestEmail.first_name || ""} ${bestEmail.last_name || ""}`.trim()
            : "",
          domain,
          confidence: bestEmail?.confidence || 0,
        });
      } else {
        enriched.push({ ...lead, email: "", contact_name: "" });
      }

      // Hunter has rate limits — be respectful
      await delay(1000);
    } catch (err) {
      console.error(`[Hunter] Error enriching ${lead.company}:`, err.message);
      enriched.push({ ...lead, email: "", contact_name: "" });
    }
  }

  return enriched;
}

// Alternative: Apollo.io enrichment
async function enrichWithApollo(leads) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.log("[Enrich] No APOLLO_API_KEY set — skipping");
    return leads;
  }

  const enriched = [];
  for (const lead of leads) {
    try {
      const res = await fetch("https://api.apollo.io/v1/mixed_companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          q_organization_name: lead.company,
          organization_locations: ["Australia"],
          per_page: 1,
        }),
      });
      const data = await res.json();
      const org = data.organizations?.[0];

      if (org) {
        // Now find people at this org
        const peopleRes = await fetch("https://api.apollo.io/v1/mixed_people/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            q_organization_name: lead.company,
            person_titles: ["owner", "director", "manager", "founder"],
            per_page: 1,
          }),
        });
        const peopleData = await peopleRes.json();
        const person = peopleData.people?.[0];

        enriched.push({
          ...lead,
          email: person?.email || org.primary_email || "",
          contact_name: person ? `${person.first_name} ${person.last_name}` : "",
          phone: person?.phone_numbers?.[0]?.sanitized_number || org.phone || "",
          domain: org.primary_domain || "",
        });
      } else {
        enriched.push(lead);
      }

      await delay(500);
    } catch (err) {
      console.error(`[Apollo] Error:`, err.message);
      enriched.push(lead);
    }
  }

  return enriched;
}

// ─── ABN LOOKUP (Australian Business Number) ───────────────────
// Free API to verify business details
async function lookupABN(companyName, state) {
  try {
    // ABR (Australian Business Register) has a free API
    // Register at: https://abr.business.gov.au/Tools/AbnLookup
    const guid = process.env.ABR_GUID; // Free registration required
    if (!guid) return null;

    const url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(companyName)}&maxResults=1&guid=${guid}`;
    const res = await fetch(url);
    const text = await res.text();
    // ABR returns JSONP — strip callback
    const json = JSON.parse(text.replace(/^callback\(/, "").replace(/\)$/, ""));

    if (json.Names?.length > 0) {
      return {
        abn: json.Names[0].Abn,
        name: json.Names[0].Name,
        state: json.Names[0].State,
        postcode: json.Names[0].Postcode,
      };
    }
  } catch (err) {
    console.error(`[ABN] Lookup failed for ${companyName}:`, err.message);
  }
  return null;
}

// ─── GOOGLE MAPS ENRICHMENT ────────────────────────────────────
// Gets phone number + address from Google Places
async function enrichWithGooglePlaces(leads) {
  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) {
    console.log("[Google] No GOOGLE_PLACES_KEY — skipping phone enrichment");
    return leads;
  }

  const enriched = [];
  for (const lead of leads) {
    try {
      // Text search for the business
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(lead.company + " " + lead.state + " Australia")}&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      const place = searchData.results?.[0];

      if (place?.place_id) {
        // Get details including phone
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website,url&key=${apiKey}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        const details = detailData.result;

        enriched.push({
          ...lead,
          phone: details?.formatted_phone_number || lead.phone || "",
          website: details?.website || "",
          maps_url: details?.url || "",
          address: place.formatted_address || lead.location,
        });
      } else {
        enriched.push(lead);
      }

      await delay(200); // Places API is more generous with limits
    } catch (err) {
      enriched.push(lead);
    }
  }

  return enriched;
}

// ─── HELPERS ───────────────────────────────────────────────────
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dedupeByCompany(leads) {
  const seen = new Set();
  return leads.filter((l) => {
    const key = l.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatLead(raw, index) {
  return {
    id: `sl_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    company: raw.company,
    contact_name: raw.contact_name || "",
    email: raw.email || "",
    phone: raw.phone || "",
    location: raw.location || "",
    state: raw.state,
    source: raw.source,
    job_title: raw.title || "",
    salary_range: raw.salary || "",
    posted_ago: raw.posted || "",
    job_url: raw.jobUrl || "",
    website: raw.website || "",
    stage: "scraped",
    emails_sent: 0,
    last_action: null,
    notes: "",
    created: new Date().toISOString(),
    queued_template: null,
  };
}

// ─── API ROUTES ────────────────────────────────────────────────

// Main scrape endpoint
app.get("/scrape", async (req, res) => {
  const { state = "NSW", source = "both", enrich = "true" } = req.query;

  console.log(`\n⚡ SparkLead scrape: state=${state}, source=${source}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    let allLeads = [];

    if (source === "both" || source === "indeed") {
      const indeedLeads = await scrapeIndeed(browser, state);
      allLeads.push(...indeedLeads);
      console.log(`[Indeed] Found ${indeedLeads.length} leads`);
    }

    if (source === "both" || source === "seek") {
      const seekLeads = await scrapeSeek(browser, state);
      allLeads.push(...seekLeads);
      console.log(`[Seek] Found ${seekLeads.length} leads`);
    }

    // Global dedupe
    allLeads = dedupeByCompany(allLeads);
    console.log(`[Total] ${allLeads.length} unique leads after dedupe`);

    // Enrich with email/phone if APIs are configured
    if (enrich === "true") {
      allLeads = await enrichWithHunter(allLeads);
      allLeads = await enrichWithGooglePlaces(allLeads);
    }

    // Format for frontend
    const formatted = allLeads.map((l, i) => formatLead(l, i));

    res.json({
      success: true,
      count: formatted.length,
      state,
      source,
      leads: formatted,
    });
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Root
app.get("/", (req, res) => {
  res.json({
    service: "sparklead-scraper",
    status: "running",
    endpoints: {
      "GET /scrape?state=NSW&source=both": "Scrape job boards",
      "GET /health": "Health check",
    },
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "sparklead-scraper" });
});

// ─── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚡ SparkLead Scraper running on http://localhost:${PORT}`);
  console.log(`   GET /scrape?state=NSW&source=both`);
  console.log(`   GET /health\n`);
  console.log(`   ENV:`);
  console.log(`     HUNTER_API_KEY: ${process.env.HUNTER_API_KEY ? "✓ set" : "✗ not set"}`);
  console.log(`     APOLLO_API_KEY: ${process.env.APOLLO_API_KEY ? "✓ set" : "✗ not set"}`);
  console.log(`     GOOGLE_PLACES_KEY: ${process.env.GOOGLE_PLACES_KEY ? "✓ set" : "✗ not set"}`);
  console.log(`     ABR_GUID: ${process.env.ABR_GUID ? "✓ set" : "✗ not set"}\n`);
});
