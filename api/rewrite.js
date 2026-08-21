/* ==========================================================================
   /api/rewrite — small serverless proxy for the "Rekomendasi Teks" feature.

   Keeps the Gemini API key server-side (never shipped to the browser). This
   is the one part of the app that needs a live deployment + network access;
   everything else in the tool stays fully local/offline.
   ========================================================================== */

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_TEXT_LENGTH = 2000;
const REQUEST_TIMEOUT_MS = 15000;

// Best-effort, in-memory rate limit. Resets on cold start and isn't shared
// across concurrent instances — not a real security control, just a cheap
// deterrent appropriate for a low-traffic personal tool (no external store).
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const requestLog = new Map();

const FIELD_CONTEXT = {
  description: "a short project description / creative brief summary in a client-facing quotation or invoice",
  scope: "a single bullet point in a project's Scope & Deliverables list",
  serviceItem: "a single billable line item in a quotation/invoice — a short service name and an optional detail line",
  terms: "a paragraph of business terms (revision policy, exclusions, payment terms, or notes) in a quotation or invoice",
};

function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function buildPrompt(text, fieldType) {
  const context = FIELD_CONTEXT[fieldType] || FIELD_CONTEXT.terms;
  let instruction = `You are a professional copywriter for a freelance motion design / 3D / creative production studio. Rewrite the text below for a client-facing business document. Requirements:
- Output natural, professional, concise English, in the style used in real creative-industry quotations and invoices.
- If the input is in Indonesian (or mixed Indonesian/English), translate it faithfully into English — do not leave any Indonesian words in the result.
- Preserve the original meaning and level of detail. Do not invent new facts, numbers, or claims that aren't implied by the input.
- Context: this text is used as ${context}.
- Reply with ONLY the rewritten text — no preamble, no surrounding quotes, no explanation, no markdown formatting.`;

  if (fieldType === "serviceItem") {
    instruction += `
- The input has two lines, "Name:" and "Detail:". Reply in the exact same two-line format ("Name: ...\\nDetail: ..."), rewriting each line. If the Detail line is empty, keep it as "Detail:" with nothing after it.`;
  }

  return `${instruction}\n\nText to rewrite:\n"""\n${text}\n"""`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "AI service is not configured on this deployment (missing GEMINI_API_KEY)." });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests — please wait a bit before trying again." });
    return;
  }

  const { text, fieldType } = req.body || {};
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "Missing text to rewrite." });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: `Text is too long (max ${MAX_TEXT_LENGTH} characters).` });
    return;
  }

  const prompt = buildPrompt(text.trim(), typeof fieldType === "string" ? fieldType : "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        }),
        signal: controller.signal,
      }
    );

    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => "");
      console.error("Gemini API error", apiRes.status, errBody);
      const status = apiRes.status === 429 ? 429 : 502;
      res.status(status).json({ error: "AI service failed to respond. Please try again." });
      return;
    }

    const data = await apiRes.json();
    const suggestion = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof suggestion !== "string" || !suggestion.trim()) {
      res.status(502).json({ error: "AI service returned an empty response." });
      return;
    }

    res.status(200).json({ suggestion: suggestion.trim() });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    console.error("rewrite handler error", err);
    res.status(504).json({ error: timedOut ? "AI service took too long to respond." : "Unexpected error contacting the AI service." });
  } finally {
    clearTimeout(timeout);
  }
};
