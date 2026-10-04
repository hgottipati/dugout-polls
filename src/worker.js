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

function manageKeyFrom(request, body = {}) {
  return String(request.headers.get("x-manage-key") || body.manageKey || body.editCode || "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .trim();
}

function canManage(request, url, env, row, body = {}) {
  const key = manageKeyFrom(request, body);
  if (!key || !row) return false;
  return key === row.manage_key || (Boolean(row.edit_code) && key === row.edit_code);
}

async function uniqueEditCode(env) {
  let code = shortId(8);
  while (await env.DB.prepare("SELECT id FROM polls WHERE edit_code = ?").bind(code).first()) {
    code = shortId(8);
  }
  return code;
}

async function ensureEditCode(env, row) {
  if (!row || row.edit_code) return row;
  const code = await uniqueEditCode(env);
  await env.DB.prepare("UPDATE polls SET edit_code = ? WHERE id = ?").bind(code, row.id).run();
  row.edit_code = code;
  return row;
}

function withOwner(poll, row, owner) {
  poll.youOwn = Boolean(owner);
  if (owner && row?.edit_code) poll.editCode = row.edit_code;
  return poll;
}

function isClosed(poll) {
  if (Number(poll.closed) === 1) return true;
  if (poll.closes_at && Date.parse(poll.closes_at) <= Date.now()) return true;
  return false;
}

function publicResults(row) {
  return Number(row.show_results ?? 1) === 1;
}

function isSignup(row) {
  return Number(row.signup) === 1;
}

function isQa(row) {
  return Number(row.qa) === 1;
}

function slotLimitOf(row) {
  return Math.max(1, Math.min(20, Number(row.slot_limit) || 1));
}

function nextOptionId(used) {
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i);
    if (!used.has(id)) return id;
  }
  return "";
}

function parseOptions(rawOptions, previous = []) {
  const prevIds = new Set(previous.map((opt) => String(opt.id)));
  const used = new Set();
  const options = [];
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  for (const item of list) {
    const text = sanitizeText(typeof item === "string" ? item : item?.text, 120);
    if (!text) continue;
    let id = typeof item === "object" && item?.id ? String(item.id) : "";
    if (!id || !prevIds.has(id) || used.has(id)) id = nextOptionId(used);
    if (!id) break;
    used.add(id);
    options.push({ id, text });
  }
  return options;
}

async function shapeIdeas(env, pollId, voterId = "") {
  const { results: ideas } = await env.DB.prepare(
    "SELECT id, text, name, author_id, created_at, answered FROM ideas WHERE poll_id = ? ORDER BY created_at"
  )
    .bind(pollId)
    .all();
  const { results: votes } = await env.DB.prepare(
    "SELECT idea_id, voter_id FROM idea_votes WHERE idea_id IN (SELECT id FROM ideas WHERE poll_id = ?)"
  )
    .bind(pollId)
    .all();
  const counts = {};
  const yours = new Set();
  for (const vote of votes) {
    counts[vote.idea_id] = (counts[vote.idea_id] || 0) + 1;
    if (voterId && vote.voter_id === voterId) yours.add(vote.idea_id);
  }
  return ideas
    .map((idea) => ({
      id: idea.id,
      text: idea.text,
      name: idea.name || "",
      youOwn: Boolean(voterId && idea.author_id === voterId),
      createdAt: idea.created_at,
      answered: Number(idea.answered) === 1,
      votes: counts[idea.id] || 0,
      youVoted: yours.has(idea.id),
    }))
    .sort((a, b) => {
      if (a.answered !== b.answered) return a.answered ? 1 : -1;
      if (b.votes !== a.votes) return b.votes - a.votes;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
}

async function shapePoll(env, row, { includeVoters = false, voterId = "", includeCounts = true } = {}) {
  const options = JSON.parse(row.options_json || "[]");
  const { results: votes } = await env.DB.prepare(
    "SELECT voter_id, name, option_ids_json, created_at FROM votes WHERE poll_id = ? ORDER BY created_at"
  )
    .bind(row.id)
    .all();
  const counts = Object.fromEntries(options.map((opt) => [opt.id, 0]));
  const namesByOption = Object.fromEntries(options.map((opt) => [opt.id, []]));
  const signup = isSignup(row);
  const slotLimit = slotLimitOf(row);
  const yours = votes.find((vote) => voterId && vote.voter_id === voterId);
  for (const vote of votes) {
    for (const optionId of JSON.parse(vote.option_ids_json)) {
      if (optionId in counts) counts[optionId] += 1;
      if (optionId in namesByOption) namesByOption[optionId].push(vote.name || "Someone");
    }
  }
  const showClaims = signup || includeVoters;
  const showCounts = includeCounts || signup;
  return {
    id: row.id,
    title: row.title || "",
    question: row.question,
    description: row.description || "",
    options: options.map((opt) => {
      const item = { id: opt.id, text: opt.text };
      if (showCounts) {
        item.votes = counts[opt.id] || 0;
        item.remaining = Math.max(0, slotLimit - item.votes);
      }
      if (showClaims) item.claimedBy = namesByOption[opt.id];
      return item;
    }),
    allowMultiple: Boolean(row.allow_multiple),
    requireName: Boolean(row.require_name) || signup,
    showResults: signup ? true : publicResults(row),
    signup,
    qa: isQa(row),
    slotLimit,
    ideas: isQa(row) ? await shapeIdeas(env, row.id, voterId) : undefined,
    closed: isClosed(row),
    createdAt: row.created_at,
    closesAt: row.closes_at,
    totalVotes: showCounts ? votes.length : undefined,
    youVoted: Boolean(yours),
    yourOptionIds: yours ? JSON.parse(yours.option_ids_json) : [],
    yourName: yours?.name || "",
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

  if (request.method === "POST" && url.pathname === "/api/polls") {
    const body = await readBody(request);
    const title = sanitizeText(body.title, 80);
    const question = sanitizeText(body.question, 200);
    const description = sanitizeText(body.description, 400);
    const qa = Boolean(body.qa);
    const signup = Boolean(body.signup) && !qa;
    const options = qa ? [] : parseOptions(body.options);
    const slotLimit = signup ? Math.min(20, Math.max(1, Number(body.slotLimit) || 1)) : 1;
    if (!question) return json({ error: qa ? "Add a prompt so people know what to ask." : "Add a question." }, 400);
    if (!qa && options.length < 2) return json({ error: "Add at least two choices." }, 400);
    if (options.length > 24) return json({ error: "Twenty-four slots max." }, 400);
    let id = shortId();
    while (await env.DB.prepare("SELECT id FROM polls WHERE id = ?").bind(id).first()) {
      id = shortId();
    }
    const manageKey = shortId(18);
    const editCode = await uniqueEditCode(env);
    const closesAt = body.closesAt ? new Date(body.closesAt).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO polls (id, title, question, description, options_json, allow_multiple, require_name, closed, created_at, closes_at, show_results, manage_key, signup, slot_limit, qa, edit_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        title,
        question,
        description,
        JSON.stringify(options),
        body.allowMultiple ? 1 : 0,
        signup || body.requireName ? 1 : 0,
        new Date().toISOString(),
        closesAt,
        qa || signup || body.showResults !== false ? 1 : 0,
        manageKey,
        signup ? 1 : 0,
        slotLimit,
        qa ? 1 : 0,
        editCode
      )
      .run();
    const row = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(id).first();
    const poll = await shapePoll(env, row, { includeVoters: true, includeCounts: true });
    poll.manageKey = manageKey;
    poll.editCode = editCode;
    poll.youOwn = true;
    return json(poll, 201);
  }

  const ideaMatch = url.pathname.match(
    /^\/api\/polls\/([a-z0-9]+)\/ideas(?:\/([a-z0-9]+)(?:\/(vote|answer))?)?$/
  );
  if (ideaMatch) {
    const pollId = ideaMatch[1];
    const ideaId = ideaMatch[2];
    const ideaAction = ideaMatch[3];
    const row = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
    if (!row) return json({ error: "Poll not found." }, 404);
    if (!isQa(row)) return json({ error: "This isn't a Q&A board." }, 400);
    const owner = canManage(request, url, env, row);

    if (request.method === "POST" && !ideaId) {
      if (isClosed(row)) return json({ error: "This Q&A is closed." }, 403);
      const body = await readBody(request);
      const authorId = sanitizeText(body.voterId || voterId, 64);
      if (!authorId) return json({ error: "Missing voter id." }, 400);
      const text = sanitizeText(body.text, 200);
      if (!text) return json({ error: "Write a question first." }, 400);
      const name = sanitizeText(body.name, 60);
      if (row.require_name && !name) return json({ error: "Add your name so they know who asked." }, 400);
      const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM ideas WHERE poll_id = ?")
        .bind(pollId)
        .first();
      if (Number(existing?.n || 0) >= 100) return json({ error: "This board is full." }, 400);
      const yours = await env.DB.prepare("SELECT COUNT(*) AS n FROM ideas WHERE poll_id = ? AND author_id = ?")
        .bind(pollId, authorId)
        .first();
      if (Number(yours?.n || 0) >= 8) return json({ error: "That's enough questions from this phone." }, 400);
      let id = shortId();
      while (await env.DB.prepare("SELECT id FROM ideas WHERE id = ?").bind(id).first()) id = shortId();
      await env.DB.prepare(
        "INSERT INTO ideas (id, poll_id, text, name, author_id, created_at, answered) VALUES (?, ?, ?, ?, ?, ?, 0)"
      )
        .bind(id, pollId, text, name, authorId, new Date().toISOString())
        .run();
      await env.DB.prepare("INSERT INTO idea_votes (idea_id, voter_id, created_at) VALUES (?, ?, ?)")
        .bind(id, authorId, new Date().toISOString())
        .run();
      const poll = await shapePoll(env, row, { includeVoters: owner, includeCounts: true, voterId: authorId });
      poll.youOwn = owner;
      return json(poll, 201);
    }

    if (!ideaId) return json({ error: "Not found." }, 404);
    const idea = await env.DB.prepare("SELECT * FROM ideas WHERE id = ? AND poll_id = ?")
      .bind(ideaId, pollId)
      .first();
    if (!idea) return json({ error: "Question not found." }, 404);

    if (request.method === "POST" && ideaAction === "vote") {
      if (isClosed(row)) return json({ error: "This Q&A is closed." }, 403);
      const body = await readBody(request);
      const id = sanitizeText(body.voterId || voterId, 64);
      if (!id) return json({ error: "Missing voter id." }, 400);
      const already = await env.DB.prepare("SELECT voter_id FROM idea_votes WHERE idea_id = ? AND voter_id = ?")
        .bind(ideaId, id)
        .first();
      if (already) {
        await env.DB.prepare("DELETE FROM idea_votes WHERE idea_id = ? AND voter_id = ?").bind(ideaId, id).run();
      } else {
        await env.DB.prepare("INSERT INTO idea_votes (idea_id, voter_id, created_at) VALUES (?, ?, ?)")
          .bind(ideaId, id, new Date().toISOString())
          .run();
      }
      const poll = await shapePoll(env, row, { includeVoters: owner, includeCounts: true, voterId: id });
      poll.youOwn = owner;
      return json(poll);
    }

    if (request.method === "POST" && ideaAction === "answer") {
      const body = await readBody(request);
      if (!canManage(request, url, env, row, body)) return json({ error: "You can only manage a poll you created." }, 401);
      await env.DB.prepare("UPDATE ideas SET answered = ? WHERE id = ? AND poll_id = ?")
        .bind(body.answered === false ? 0 : 1, ideaId, pollId)
        .run();
      const poll = await shapePoll(env, row, { includeVoters: true, includeCounts: true, voterId });
      poll.youOwn = true;
      return json(poll);
    }

    if (request.method === "DELETE" && !ideaAction) {
      const body = await readBody(request).catch(() => ({}));
      const id = sanitizeText(body.voterId || voterId, 64);
      if (!owner && idea.author_id !== id) return json({ error: "You can only remove your own question." }, 401);
      await env.DB.prepare("DELETE FROM idea_votes WHERE idea_id = ?").bind(ideaId).run();
      await env.DB.prepare("DELETE FROM ideas WHERE id = ? AND poll_id = ?").bind(ideaId, pollId).run();
      const poll = await shapePoll(env, row, { includeVoters: owner, includeCounts: true, voterId: id });
      poll.youOwn = owner;
      return json(poll);
    }

    return json({ error: "Not found." }, 404);
  }

  const pollMatch = url.pathname.match(/^\/api\/polls\/([a-z0-9]+)(?:\/(vote|close|results|unvote|edit))?$/);
  if (pollMatch) {
    const pollId = pollMatch[1];
    const action = pollMatch[2];
    const row = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
    if (!row) return json({ error: "Poll not found." }, 404);
    const owner = canManage(request, url, env, row);

    if (request.method === "GET" && !action) {
      const includeCounts = owner || publicResults(row) || isSignup(row);
      const owned = owner ? await ensureEditCode(env, row) : row;
      const poll = await shapePoll(env, owned, {
        includeVoters: owner || isSignup(row),
        includeCounts,
        voterId,
      });
      return json(withOwner(poll, owned, owner));
    }

    if (request.method === "POST" && action === "unvote") {
      const body = await readBody(request);
      if (isClosed(row)) return json({ error: "This sheet is closed." }, 403);
      if (!isSignup(row)) return json({ error: "You already voted on this one." }, 409);
      const id = sanitizeText(body.voterId || voterId, 64);
      if (!id) return json({ error: "Missing voter id." }, 400);
      await env.DB.prepare("DELETE FROM votes WHERE poll_id = ? AND voter_id = ?").bind(pollId, id).run();
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      const poll = await shapePoll(env, fresh, { voterId: id, includeCounts: true, includeVoters: true });
      poll.youOwn = canManage(request, url, env, fresh, body);
      return json(poll);
    }

    if (request.method === "POST" && action === "vote") {
      const body = await readBody(request);
      if (isQa(row)) return json({ error: "This is a Q&A board. Add or upvote a question instead." }, 400);
      if (isClosed(row)) return json({ error: isSignup(row) ? "This sheet is closed." : "This poll is closed." }, 403);
      const id = sanitizeText(body.voterId || voterId, 64);
      if (!id) return json({ error: "Missing voter id." }, 400);
      const options = JSON.parse(row.options_json);
      const validIds = new Set(options.map((opt) => opt.id));
      let optionIds = Array.isArray(body.optionIds) ? body.optionIds.map(String) : [];
      optionIds = [...new Set(optionIds.filter((optId) => validIds.has(optId)))];
      if (!row.allow_multiple) optionIds = optionIds.slice(0, 1);
      if (!optionIds.length) return json({ error: isSignup(row) ? "Pick an open spot." : "Pick a choice." }, 400);
      const name = sanitizeText(body.name, 60);
      if ((row.require_name || isSignup(row)) && !name) {
        return json({ error: "Add your name so they know who signed up." }, 400);
      }
      if (isSignup(row)) {
        const limit = slotLimitOf(row);
        const { results: existingVotes } = await env.DB.prepare(
          "SELECT voter_id, option_ids_json FROM votes WHERE poll_id = ?"
        )
          .bind(pollId)
          .all();
        const taken = Object.fromEntries(options.map((opt) => [opt.id, 0]));
        for (const vote of existingVotes) {
          if (vote.voter_id === id) continue;
          for (const optionId of JSON.parse(vote.option_ids_json)) {
            if (optionId in taken) taken[optionId] += 1;
          }
        }
        const blocked = optionIds.find((optionId) => taken[optionId] >= limit);
        if (blocked) return json({ error: "That spot was just taken. Pick another." }, 409);
        const already = existingVotes.some((vote) => vote.voter_id === id);
        if (already) {
          await env.DB.prepare(
            "UPDATE votes SET name = ?, option_ids_json = ?, created_at = ? WHERE poll_id = ? AND voter_id = ?"
          )
            .bind(name, JSON.stringify(optionIds), new Date().toISOString(), pollId, id)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT INTO votes (poll_id, voter_id, name, option_ids_json, created_at) VALUES (?, ?, ?, ?, ?)"
          )
            .bind(pollId, id, name, JSON.stringify(optionIds), new Date().toISOString())
            .run();
        }
      } else {
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
      }
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      const includeCounts = canManage(request, url, env, fresh, body) || publicResults(fresh) || isSignup(fresh);
      const poll = await shapePoll(env, fresh, {
        voterId: id,
        includeCounts,
        includeVoters: canManage(request, url, env, fresh, body) || isSignup(fresh),
      });
      poll.youOwn = canManage(request, url, env, fresh, body);
      return json(poll);
    }

    if (request.method === "POST" && action === "edit") {
      const body = await readBody(request);
      if (!canManage(request, url, env, row, body)) return json({ error: "You can only manage a poll you created." }, 401);
      const qa = Boolean(body.qa);
      const previous = JSON.parse(row.options_json || "[]");
      const options = qa ? previous : parseOptions(body.options, previous);
      const title = sanitizeText(body.title, 80);
      const question = sanitizeText(body.question, 200);
      const description = sanitizeText(body.description, 400);
      const signup = Boolean(body.signup) && !qa;
      const slotLimit = signup ? Math.min(20, Math.max(1, Number(body.slotLimit) || 1)) : 1;
      if (!question) return json({ error: qa ? "Add a prompt so people know what to ask." : "Add a question." }, 400);
      if (!qa && options.length < 2) return json({ error: "Add at least two choices." }, 400);
      if (options.length > 24) return json({ error: "Twenty-four slots max." }, 400);
      const allowMultiple = body.allowMultiple ? 1 : 0;
      const requireName = signup || body.requireName ? 1 : 0;
      const showResults = qa || signup || body.showResults !== false ? 1 : 0;
      const closesAt = body.closesAt ? new Date(body.closesAt).toISOString() : null;
      await env.DB.prepare(
        `UPDATE polls
         SET title = ?, question = ?, description = ?, options_json = ?, allow_multiple = ?, require_name = ?,
             closes_at = ?, show_results = ?, signup = ?, slot_limit = ?, qa = ?
         WHERE id = ?`
      )
        .bind(
          title,
          question,
          description,
          JSON.stringify(qa ? previous : options),
          allowMultiple,
          requireName,
          closesAt,
          showResults,
          signup ? 1 : 0,
          slotLimit,
          qa ? 1 : 0,
          pollId
        )
        .run();
      const keep = new Set(options.map((opt) => opt.id));
      const { results: votes } = await env.DB.prepare(
        "SELECT voter_id, option_ids_json FROM votes WHERE poll_id = ?"
      )
        .bind(pollId)
        .all();
      for (const vote of votes) {
        let ids = JSON.parse(vote.option_ids_json).filter((optionId) => keep.has(optionId));
        if (!allowMultiple) ids = ids.slice(0, 1);
        if (!ids.length) {
          await env.DB.prepare("DELETE FROM votes WHERE poll_id = ? AND voter_id = ?")
            .bind(pollId, vote.voter_id)
            .run();
        } else if (JSON.stringify(ids) !== vote.option_ids_json) {
          await env.DB.prepare("UPDATE votes SET option_ids_json = ? WHERE poll_id = ? AND voter_id = ?")
            .bind(JSON.stringify(ids), pollId, vote.voter_id)
            .run();
        }
      }
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      const poll = await shapePoll(env, fresh, { includeVoters: true, includeCounts: true });
      return json(withOwner(poll, fresh, true));
    }

    if (request.method === "POST" && action === "close") {
      const body = await readBody(request);
      if (!canManage(request, url, env, row, body)) return json({ error: "You can only manage a poll you created." }, 401);
      await env.DB.prepare("UPDATE polls SET closed = ? WHERE id = ?")
        .bind(body.closed === false ? 0 : 1, pollId)
        .run();
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      const poll = await shapePoll(env, fresh, { includeVoters: true, includeCounts: true });
      poll.youOwn = true;
      return json(poll);
    }

    if (request.method === "POST" && action === "results") {
      const body = await readBody(request);
      if (!canManage(request, url, env, row, body)) return json({ error: "You can only manage a poll you created." }, 401);
      await env.DB.prepare("UPDATE polls SET show_results = ? WHERE id = ?")
        .bind(body.showResults === false ? 0 : 1, pollId)
        .run();
      const fresh = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(pollId).first();
      const poll = await shapePoll(env, fresh, { includeVoters: true, includeCounts: true });
      poll.youOwn = true;
      return json(poll);
    }

    if (request.method === "DELETE" && !action) {
      const body = await readBody(request).catch(() => ({}));
      if (!canManage(request, url, env, row, body)) return json({ error: "You can only manage a poll you created." }, 401);
      await env.DB.prepare("DELETE FROM idea_votes WHERE idea_id IN (SELECT id FROM ideas WHERE poll_id = ?)")
        .bind(pollId)
        .run();
      await env.DB.prepare("DELETE FROM ideas WHERE poll_id = ?").bind(pollId).run();
      await env.DB.prepare("DELETE FROM votes WHERE poll_id = ?").bind(pollId).run();
      await env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(pollId).run();
      return json({ ok: true });
    }
  }

  return json({ error: "Not found." }, 404);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function previewTags({ canonical, title, description, image }) {
  const t = escapeHtml(clip(title, 110));
  const d = escapeHtml(clip(description, 160));
  const u = escapeHtml(canonical);
  const img = escapeHtml(image);
  return `
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Dugout Polls" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:secure_url" content="${img}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${t}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${img}" />
    <link rel="image_src" href="${img}" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  `;
}

async function pollSharePreview(env, origin, id) {
  const image = `${origin}/og.jpg`;
  const row = await env.DB.prepare(
    "SELECT title, question, description, options_json, signup, qa FROM polls WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!row) {
    return {
      canonical: `${origin}/p/${id}`,
      title: "Poll not found · Dugout Polls",
      description: "This poll is gone. Make a new one in a tap.",
      image,
    };
  }
  let options = [];
  try {
    options = JSON.parse(row.options_json || "[]");
  } catch {
    options = [];
  }
  const choices = options
    .map((opt) => opt.text)
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
  return {
    canonical: `${origin}/p/${id}`,
    title: row.question,
    description: [
      row.title,
      isQa(row) ? "Ask a question. The team upvotes, popular ones rise" : choices,
      isQa(row) ? "No login" : isSignup(row) ? "Sign up. Taken dates show who claimed them" : "Tap to vote. No login",
    ]
      .filter(Boolean)
      .join(" · "),
    image,
  };
}

const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
};

function templateFrom(html, id) {
  const match = html.match(new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`));
  return match ? match[1].trim() : "";
}

async function serveApp(env, url, preview, { status = 200, templateId = "" } = {}) {
  const res = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
  let html = await res.text();
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta name="description"[^>]*>/i, "")
    .replace(/<meta property="og:[^"]+"[^>]*>/gi, "")
    .replace(/<meta name="twitter:[^"]+"[^>]*>/gi, "")
    .replace(/<link rel="canonical"[^>]*>/i, "")
    .replace(/<link rel="image_src"[^>]*>/i, "")
    .replace("</head>", `${previewTags(preview)}\n</head>`);
  if (templateId) {
    const body = templateFrom(html, templateId);
    if (body) {
      html = html.replace(
        /<main id="app" class="card"><\/main>/,
        `<main id="app" class="card">${body}</main>`
      );
    }
  }
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
      ...SECURITY_HEADERS,
    },
  });
}

const CANONICAL_HOST = "dugoutpolls.com";
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}

function withCanonicalHost(url) {
  const next = new URL(url.href);
  next.protocol = "https:";
  next.hostname = CANONICAL_HOST;
  next.port = "";
  return next;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!isLocalHost(url.hostname) && (url.hostname !== CANONICAL_HOST || url.protocol === "http:")) {
        return Response.redirect(withCanonicalHost(url).href, 308);
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      if (request.method === "GET" || request.method === "HEAD") {
        const poll = url.pathname.match(/^\/p\/([a-z0-9]+)(?:\/edit)?\/?$/);
        const pages = {
          "/": { title: "Dugout Polls", description: "Snack sheets, rainouts, and picnic RSVPs for baseball and softball teams. Share a link. No login." },
          "/new": { title: "Create a poll · Dugout Polls", description: "Make a poll, sign-up sheet, or Q&A. Share a link. No login." },
          "/mine": { title: "Your polls · Dugout Polls", description: "Polls you created on this phone." },
          "/about": { title: "About · Dugout Polls", description: "A free sideline tool for baseball and softball teams. No login.", templateId: "page-about" },
          "/privacy": { title: "Privacy · Dugout Polls", description: "What Dugout Polls stores, and what it doesn’t.", templateId: "page-privacy" },
          "/terms": { title: "Terms · Dugout Polls", description: "Free to use. Not affiliated with Little League.", templateId: "page-terms" },
        };
        const page = pages[url.pathname];
        if (page || poll) {
          const image = `${CANONICAL_ORIGIN}/og.jpg`;
          if (poll) {
            const preview = await pollSharePreview(env, CANONICAL_ORIGIN, poll[1]);
            const missing = preview.title.startsWith("Poll not found");
            return serveApp(env, url, preview, {
              status: missing ? 404 : 200,
              templateId: missing ? "page-not-found" : "",
            });
          }
          return serveApp(
            env,
            url,
            {
              canonical: `${CANONICAL_ORIGIN}${url.pathname === "/" ? "/" : url.pathname}`,
              title: page.title,
              description: page.description,
              image,
            },
            { templateId: page.templateId || "" }
          );
        }
        if (/\.[a-z0-9]{2,8}$/i.test(url.pathname)) {
          return env.ASSETS.fetch(request);
        }
        return serveApp(
          env,
          url,
          {
            canonical: `${CANONICAL_ORIGIN}${url.pathname}`,
            title: "Page not found · Dugout Polls",
            description: "That page isn’t on Dugout Polls.",
            image: `${CANONICAL_ORIGIN}/og.jpg`,
          },
          { status: 404, templateId: "page-not-found" }
        );
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message || "Server error" }, 500);
    }
  },
};
