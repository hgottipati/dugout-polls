import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const PORT = Number(process.env.PORT) || 3456;
const COACH_PIN = process.env.COACH_PIN || "dugout";
const TEAM_NAME = process.env.TEAM_NAME || "Team polls";

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "dugout.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    description TEXT DEFAULT '',
    options_json TEXT NOT NULL,
    allow_multiple INTEGER DEFAULT 0,
    require_name INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    show_results INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    closes_at TEXT
  );
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    option_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(poll_id, voter_id)
  );
`);

try {
  db.exec("ALTER TABLE polls ADD COLUMN show_results INTEGER DEFAULT 1");
} catch {
  // column already exists
}

const insertPoll = db.prepare(`
  INSERT INTO polls (id, question, description, options_json, allow_multiple, require_name, closed, created_at, closes_at, show_results)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
`);
const getPoll = db.prepare(`SELECT * FROM polls WHERE id = ?`);
const listPolls = db.prepare(`SELECT * FROM polls ORDER BY created_at DESC`);
const listVotes = db.prepare(`SELECT voter_id, name, option_ids_json, created_at FROM votes WHERE poll_id = ? ORDER BY created_at`);
const insertVote = db.prepare(`
  INSERT INTO votes (poll_id, voter_id, name, option_ids_json, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const setClosed = db.prepare(`UPDATE polls SET closed = ? WHERE id = ?`);
const setShowResults = db.prepare(`UPDATE polls SET show_results = ? WHERE id = ?`);
const deleteVotes = db.prepare(`DELETE FROM votes WHERE poll_id = ?`);
const deletePoll = db.prepare(`DELETE FROM polls WHERE id = ?`);

function shortId(len = 7) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const isJson = typeof body !== "string";
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 200_000) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function coachPinFrom(req, body = {}) {
  return (
    req.headers["x-coach-pin"] ||
    body.pin ||
    new URL(req.url, "http://localhost").searchParams.get("pin") ||
    ""
  );
}

function requireCoach(req, res, body = {}) {
  const pin = String(coachPinFrom(req, body));
  if (pin !== COACH_PIN) {
    send(res, 401, { error: "Coach PIN required." });
    return false;
  }
  return true;
}

function isClosed(poll) {
  if (Number(poll.closed) === 1) return true;
  if (poll.closes_at && Date.parse(poll.closes_at) <= Date.now()) return true;
  return false;
}

function publicResults(row) {
  return Number(row.show_results ?? 1) === 1;
}

function shapePoll(row, { includeVoters = false, voterId = "", includeCounts = true } = {}) {
  const options = JSON.parse(row.options_json);
  const votes = listVotes.all(row.id);
  const counts = Object.fromEntries(options.map((opt) => [opt.id, 0]));
  for (const vote of votes) {
    for (const optionId of JSON.parse(vote.option_ids_json)) {
      if (optionId in counts) counts[optionId] += 1;
    }
  }
  const youVoted = Boolean(voterId && votes.some((v) => v.voter_id === voterId));
  return {
    id: row.id,
    question: row.question,
    description: row.description || "",
    options: options.map((opt) => {
      const item = { id: opt.id, text: opt.text };
      if (includeCounts) item.votes = counts[opt.id] || 0;
      return item;
    }),
    allowMultiple: Boolean(row.allow_multiple),
    requireName: Boolean(row.require_name),
    showResults: publicResults(row),
    closed: isClosed(row),
    createdAt: row.created_at,
    closesAt: row.closes_at,
    totalVotes: includeCounts ? votes.length : undefined,
    youVoted,
    voters: includeVoters
      ? votes.map((v) => ({
          name: v.name || "Anonymous",
          optionIds: JSON.parse(v.option_ids_json),
          at: v.created_at,
        }))
      : undefined,
  };
}

function sanitizeText(value, max) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function handleApi(req, res, url) {
  const voterId = String(req.headers["x-voter-id"] || url.searchParams.get("voter") || "");

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, team: TEAM_NAME });
  }

  if (req.method === "GET" && url.pathname === "/api/meta") {
    return send(res, 200, { team: TEAM_NAME });
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readBody(req);
    if (!requireCoach(req, res, body)) return;
    return send(res, 200, { ok: true, team: TEAM_NAME });
  }

  if (req.method === "POST" && url.pathname === "/api/polls") {
    const body = await readBody(req);
    if (!requireCoach(req, res, body)) return;
    const question = sanitizeText(body.question, 200);
    const description = sanitizeText(body.description, 400);
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const options = rawOptions
      .map((item, index) => ({
        id: String.fromCharCode(97 + index),
        text: sanitizeText(typeof item === "string" ? item : item?.text, 120),
      }))
      .filter((opt) => opt.text);
    if (!question) return send(res, 400, { error: "Add a question." });
    if (options.length < 2) return send(res, 400, { error: "Add at least two choices." });
    if (options.length > 8) return send(res, 400, { error: "Eight choices max." });
    let id = shortId();
    while (getPoll.get(id)) id = shortId();
    const closesAt = body.closesAt ? new Date(body.closesAt).toISOString() : null;
    insertPoll.run(
      id,
      question,
      description,
      JSON.stringify(options),
      body.allowMultiple ? 1 : 0,
      body.requireName ? 1 : 0,
      new Date().toISOString(),
      closesAt,
      body.showResults === false ? 0 : 1
    );
    return send(res, 201, shapePoll(getPoll.get(id), { includeVoters: true, includeCounts: true }));
  }

  const pollMatch = url.pathname.match(/^\/api\/polls\/([a-z0-9]+)(?:\/(vote|close|results))?$/);
  if (pollMatch) {
    const pollId = pollMatch[1];
    const action = pollMatch[2];
    const row = getPoll.get(pollId);
    if (!row) return send(res, 404, { error: "Poll not found." });

    if (req.method === "GET" && !action) {
      const coach = coachPinFrom(req) === COACH_PIN;
      return send(res, 200, shapePoll(row, { includeVoters: coach, includeCounts: coach || publicResults(row), voterId }));
    }

    if (req.method === "POST" && action === "vote") {
      const body = await readBody(req);
      if (isClosed(row)) return send(res, 403, { error: "This poll is closed." });
      const id = sanitizeText(body.voterId || voterId, 64);
      if (!id) return send(res, 400, { error: "Missing voter id." });
      const options = JSON.parse(row.options_json);
      const validIds = new Set(options.map((opt) => opt.id));
      let optionIds = Array.isArray(body.optionIds) ? body.optionIds.map(String) : [];
      optionIds = [...new Set(optionIds.filter((optId) => validIds.has(optId)))];
      if (!row.allow_multiple) optionIds = optionIds.slice(0, 1);
      if (!optionIds.length) return send(res, 400, { error: "Pick a choice." });
      const name = sanitizeText(body.name, 60);
      if (row.require_name && !name) return send(res, 400, { error: "Add your name so coach knows who voted." });
      try {
        insertVote.run(pollId, id, name, JSON.stringify(optionIds), new Date().toISOString());
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
          return send(res, 409, { error: "You already voted on this one." });
        }
        throw err;
      }
      const fresh = getPoll.get(pollId);
      const coach = coachPinFrom(req, body) === COACH_PIN;
      return send(res, 200, shapePoll(fresh, { voterId: id, includeCounts: coach || publicResults(fresh) }));
    }

    if (req.method === "POST" && action === "close") {
      const body = await readBody(req);
      if (!requireCoach(req, res, body)) return;
      setClosed.run(body.closed === false ? 0 : 1, pollId);
      return send(res, 200, shapePoll(getPoll.get(pollId), { includeVoters: true, includeCounts: true }));
    }

    if (req.method === "POST" && action === "results") {
      const body = await readBody(req);
      if (!requireCoach(req, res, body)) return;
      setShowResults.run(body.showResults === false ? 0 : 1, pollId);
      return send(res, 200, shapePoll(getPoll.get(pollId), { includeVoters: true, includeCounts: true }));
    }

    if (req.method === "DELETE" && !action) {
      const body = await readBody(req).catch(() => ({}));
      if (!requireCoach(req, res, body)) return;
      deleteVotes.run(pollId);
      deletePoll.run(pollId);
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/coach/polls") {
    if (!requireCoach(req, res)) return;
    const polls = listPolls.all().map((row) => shapePoll(row, { includeVoters: true }));
    return send(res, 200, { team: TEAM_NAME, polls });
  }

  send(res, 404, { error: "Not found." });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(req, res, url) {
  const clean = decodeURIComponent(url.pathname.split("?")[0]);
  const isAppRoute = clean === "/" || clean.startsWith("/p/") || clean === "/coach" || clean === "/new";
  const relative = isAppRoute ? "/index.html" : clean;
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackErr, html) => {
        if (fallbackErr) return send(res, 404, "Not found");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) send(res, 500, { error: err.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Dugout polls is up for ${TEAM_NAME}`);
  console.log(`  Coach PIN: ${COACH_PIN}`);
  console.log(`  Local:     http://localhost:${PORT}\n`);
  if (process.env.SHARE === "1") startTunnel();
});

function startTunnel() {
  console.log("  Opening a public link so you can text it to parents...\n");
  const child = spawn("npx", ["--yes", "cloudflared", "tunnel", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log(`\n  Share this with parents:\n  ${match[0]}\n`);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    if (code) console.log("  Public tunnel closed. Local site is still running.");
  });
}
