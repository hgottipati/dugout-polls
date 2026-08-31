const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function shortId(len = 7) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function sanitizeText(value, max) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function coachPinFrom(request, url, body = {}) {
  return (
    request.headers.get("x-coach-pin") ||
    body.pin ||
    url.searchParams.get("pin") ||
    ""
  );
}

function isCoach(request, url, env, body = {}) {
  return String(coachPinFrom(request, url, body)) === String(env.COACH_PIN || "dugout");
}

function isClosed(poll) {
  if (Number(poll.closed) === 1) return true;
  if (poll.closes_at && Date.parse(poll.closes_at) <= Date.now()) return true;
  return false;
}

function publicResults(row) {
  return Number(row.show_results ?? 1) === 1;
}

async function shapePoll(env, row, { includeVoters = false, voterId = "", includeCounts = true } = {}) {
  const options = JSON.parse(row.options_json);
  const { results: votes } = await env.DB.prepare(
    "SELECT voter_id, name, option_ids_json, created_at FROM votes WHERE poll_id = ? ORDER BY created_at"
  )
    .bind(row.id)
    .all();
  const counts = Object.fromEntries(options.map((opt) => [opt.id, 0]));
  for (const vote of votes) {
    for (const optionId of JSON.parse(vote.option_ids_json)) {
      if (optionId in counts) counts[optionId] += 1;
    }
  }
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
    youVoted: Boolean(voterId && votes.some((v) => v.voter_id === voterId)),
    voters: includeVoters
      ? votes.map((v) => ({
          name: v.name || "Anonymous",
          optionIds: JSON.parse(v.option_ids_json),
          at: v.created_at,
        }))
      : undefined,
  };
}

async function readBody(request) {
  const raw = await request.text();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const team = env.TEAM_NAME || "Team polls";
  const voterId = request.headers.get("x-voter-id") || url.searchParams.get("voter") || "";

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, team });
  }
  if (request.method === "GET" && url.pathname === "/api/meta") {
    return json({ team });
  }
  if (request.method === "POST" && url.pathname === "/api/session") {
    const body = await readBody(request);
    if (!isCoach(request, url, env, body)) return json({ error: "Coach PIN required." }, 401);
    return json({ ok: true, team });
  }

  if (request.method === "POST" && url.pathname === "/api/polls") {
    const body = await readBody(request);
    if (!isCoach(request, url, env, body)) return json({ error: "Coach PIN required." }, 401);
    const question = sanitizeText(body.question, 200);
    const description = sanitizeText(body.description, 400);
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const options = rawOptions
      .map((item, index) => ({
        id: String.fromCharCode(97 + index),
        text: sanitizeText(typeof item === "string" ? item : item?.text, 120),
      }))
      .filter((opt) => opt.text);
    if (!question) return json({ error: "Add a question." }, 400);
    if (options.length < 2) return json({ error: "Add at least two choices." }, 400);
    if (options.length > 8) return json({ error: "Eight choices max." }, 400);
    let id = shortId();
    while (await env.DB.prepare("SELECT id FROM polls WHERE id = ?").bind(id).first()) {
      id = shortId();
    }
    const closesAt = body.closesAt ? new Date(body.closesAt).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO polls (id, question, description, options_json, allow_multiple, require_name, closed, created_at, closes_at, show_results)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
      .bind(
        id,
        question,
        description,
        JSON.stringify(options),
        body.allowMultiple ? 1 : 0,
        body.requireName ? 1 : 0,
        new Date().toISOString(),
        closesAt,
        body.showResults === false ? 0 : 1
      )
      .run();
    const row = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(id).first();
    return json(await shapePoll(env, row, { includeVoters: true, includeCounts: true }), 201);
  }

  const pollMatch = url.pathname.match(/^\/api\/polls\/([a-z0-9]+)(?:\/(vote|close|results))?$/);
  if (pollMatch) {
    const pollId = pollMatch[1];
    const action = pollMatch[2];
    const row = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
    if (!row) return json({ error: "Poll not found." }, 404);
    const coach = isCoach(request, url, env);

    if (request.method === "GET" && !action) {
      const includeCounts = coach || publicResults(row);
      return json(
        await shapePoll(env, row, {
          includeVoters: coach,
          includeCounts,
          voterId,
        })
      );
    }

    if (request.method === "POST" && action === "vote") {
      const body = await readBody(request);
      if (isClosed(row)) return json({ error: "This poll is closed." }, 403);
      const id = sanitizeText(body.voterId || voterId, 64);
      if (!id) return json({ error: "Missing voter id." }, 400);
      const options = JSON.parse(row.options_json);
      const validIds = new Set(options.map((opt) => opt.id));
      let optionIds = Array.isArray(body.optionIds) ? body.optionIds.map(String) : [];
      optionIds = [...new Set(optionIds.filter((optId) => validIds.has(optId)))];
      if (!row.allow_multiple) optionIds = optionIds.slice(0, 1);
      if (!optionIds.length) return json({ error: "Pick a choice." }, 400);
      const name = sanitizeText(body.name, 60);
      if (row.require_name && !name) {
        return json({ error: "Add your name so coach knows who voted." }, 400);
      }
      try {
        await env.DB.prepare(
          "INSERT INTO votes (poll_id, voter_id, name, option_ids_json, created_at) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(pollId, id, name, JSON.stringify(optionIds), new Date().toISOString())
          .run();
      } catch (err) {
        if (/UNIQUE|constraint/i.test(String(err.message))) {
          return json({ error: "You already voted on this one." }, 409);
        }
        throw err;
      }
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      const includeCounts = isCoach(request, url, env, body) || publicResults(fresh);
      return json(await shapePoll(env, fresh, { voterId: id, includeCounts }));
    }

    if (request.method === "POST" && action === "close") {
      const body = await readBody(request);
      if (!isCoach(request, url, env, body)) return json({ error: "Coach PIN required." }, 401);
      await env.DB.prepare("UPDATE polls SET closed = ? WHERE id = ?")
        .bind(body.closed === false ? 0 : 1, pollId)
        .run();
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      return json(await shapePoll(env, fresh, { includeVoters: true, includeCounts: true }));
    }

    if (request.method === "POST" && action === "results") {
      const body = await readBody(request);
      if (!isCoach(request, url, env, body)) return json({ error: "Coach PIN required." }, 401);
      await env.DB.prepare("UPDATE polls SET show_results = ? WHERE id = ?")
        .bind(body.showResults === false ? 0 : 1, pollId)
        .run();
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      return json(await shapePoll(env, fresh, { includeVoters: true, includeCounts: true }));
    }

    if (request.method === "DELETE" && !action) {
      const body = await readBody(request).catch(() => ({}));
      if (!isCoach(request, url, env, body)) return json({ error: "Coach PIN required." }, 401);
      await env.DB.prepare("DELETE FROM votes WHERE poll_id = ?").bind(pollId).run();
      await env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(pollId).run();
      return json({ ok: true });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/coach/polls") {
    if (!isCoach(request, url, env)) return json({ error: "Coach PIN required." }, 401);
    const { results } = await env.DB.prepare("SELECT * FROM polls ORDER BY created_at DESC").all();
    const polls = [];
    for (const row of results) polls.push(await shapePoll(env, row, { includeVoters: true }));
    return json({ team, polls });
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message || "Server error" }, 500);
    }
  },
};
