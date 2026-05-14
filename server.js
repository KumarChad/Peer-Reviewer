import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_BODY_SIZE = 6 * 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

const PROMPT_TEMPLATE = `You are a senior researcher reviewing a paper for a colleague who needs
to decide in 3 minutes whether this work is credible and worth citing.

Do not summarize. Do not be polite. Be useful.

Return a JSON object with exactly these five string fields:
- claim
- keyNumber
- assumption
- gap
- citeCheck

Write each field using these rules:
- claim: the single falsifiable claim this paper makes, one sentence, no hedging
- keyNumber: the one statistic or result the entire argument depends on; explain why it is load-bearing
- assumption: the hidden premise the authors treated as given but never tested or justified; be specific
- gap: the missing experiment, analysis, or robustness check that would most meaningfully confirm or break the conclusion; if one issue dominates, give one compact paragraph, but if there are multiple distinct load-bearing gaps, use a short list with up to 3 items separated by line breaks inside the same string
- citeCheck: start with exactly one of "SAFE TO CITE -", "CITE WITH CAUTION -", or "DO NOT CITE -" and then give the concrete reason

Every field must be non-empty. Do not include markdown fences. Do not include any keys other than the five above.

Paper text:
`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    claim: {
      type: "string",
      description: "The single falsifiable claim the paper makes.",
    },
    keyNumber: {
      type: "string",
      description: "The one load-bearing statistic or result and why it matters.",
    },
    assumption: {
      type: "string",
      description: "The hidden premise the authors never tested or justified.",
    },
    gap: {
      type: "string",
      description: "The main missing experiment, analysis, or a short list of up to 3 load-bearing gaps separated by line breaks when more than one is truly necessary.",
    },
    citeCheck: {
      type: "string",
      description: "A verdict starting with SAFE TO CITE -, CITE WITH CAUTION -, or DO NOT CITE - followed by the reason.",
    },
  },
  required: ["claim", "keyNumber", "assumption", "gap", "citeCheck"],
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatReview(reviewObject) {
  const claim = normalizeField(reviewObject.claim);
  const keyNumber = normalizeField(reviewObject.keyNumber);
  const assumption = normalizeField(reviewObject.assumption);
  const gap = normalizeField(reviewObject.gap);
  const citeCheck = normalizeField(reviewObject.citeCheck);

  if (!claim || !keyNumber || !assumption || !gap || !citeCheck) {
    return "";
  }

  return [
    `CLAIM: ${claim}`,
    `KEY NUMBER: ${keyNumber}`,
    `ASSUMPTION: ${assumption}`,
    `GAP: ${gap}`,
    `CITE CHECK: ${citeCheck}`,
  ].join("\n\n");
}

function getAllowedOrigins() {
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function applyCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  const allowedOrigins = getAllowedOrigins();
  const isLocalOrigin = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);

  if (!allowedOrigins.has(origin) && !isLocalOrigin) {
    return;
  }

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "Content-Type");
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

async function handleIndex(response) {
  const html = await readFile(path.join(__dirname, "index.html"), "utf8");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

async function handleReview(request, response) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(response, 500, {
      error: "Server is missing GEMINI_API_KEY.",
    });
    return;
  }

  const body = await readJsonBody(request);
  const paperText = typeof body.paperText === "string" ? body.paperText.trim() : "";

  if (!paperText) {
    sendJson(response, 400, {
      error: "Paper text is required.",
    });
    return;
  }

  const upstreamResponse = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `${PROMPT_TEMPLATE}${paperText}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1400,
        thinkingConfig: {
          thinkingBudget: 0,
        },
        responseMimeType: "application/json",
        responseJsonSchema: REVIEW_SCHEMA,
      },
    }),
  });

  const payload = await upstreamResponse.json().catch(() => ({}));

  if (!upstreamResponse.ok) {
    const message =
      payload?.error?.message ||
      `Gemini request failed with status ${upstreamResponse.status}.`;

    sendJson(response, upstreamResponse.status, { error: message });
    return;
  }

  const reviewText = Array.isArray(payload.candidates)
    ? payload.candidates
        .flatMap((candidate) => candidate.content?.parts || [])
        .map((part) => part.text || "")
        .join("\n")
        .trim()
    : "";

  if (!reviewText) {
    sendJson(response, 502, {
      error: "Gemini returned an empty review.",
    });
    return;
  }

  let reviewObject;

  try {
    reviewObject = JSON.parse(reviewText);
  } catch {
    sendJson(response, 502, {
      error: "Gemini returned malformed structured output.",
    });
    return;
  }

  const review = formatReview(reviewObject);

  if (!review) {
    sendJson(response, 502, {
      error: "Gemini returned an incomplete review.",
    });
    return;
  }

  sendJson(response, 200, { review });
}

const server = createServer(async (request, response) => {
  try {
    const method = request.method || "GET";
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    applyCorsHeaders(request, response);

    if (method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      await handleIndex(response);
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/review") {
      await handleReview(request, response);
      return;
    }

    sendText(response, 404, "Not found");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Peer Reviewer listening on http://localhost:${PORT}`);
});
