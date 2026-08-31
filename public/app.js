const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const PIN_KEY = "dugout-coach-pin";
const VOTER_KEY = "dugout-voter-id";

const TEMPLATES = [
  {
    label: "Snack sign-up",
    question: "Who can bring snacks this Saturday?",
    options: ["I've got it this week", "I can do next week", "I can bring drinks", "Can't this time"],
    requireName: true,
  },
  {
    label: "Practice time",
    question: "Which practice time works best this week?",
    options: ["Tuesday 5:30 PM", "Wednesday 5:30 PM", "Thursday 5:30 PM", "Saturday morning"],
    allowMultiple: true,
  },
  {
    label: "Rain makeup",
    question: "If Saturday gets rained out, which makeup day works?",
    options: ["Sunday afternoon", "Monday evening", "Next Saturday", "Skip and move on"],
  },
  {
    label: "Yes / No",
    question: "Are you coming to the end-of-season picnic?",
    options: ["Yes, we'll be there", "No, we can't make it", "Not sure yet"],
    requireName: true,
  },
  {
    label: "Game volunteer",
    question: "Can you help at Saturday's game?",
    options: ["Scorekeeping", "Field setup", "Snack shack", "Wherever you need me", "Can't this week"],
    requireName: true,
    allowMultiple: true,
  },
  {
    label: "Party date",
    question: "When should we do the end-of-season party?",
    options: ["Saturday after the last game", "Sunday afternoon", "Weeknight pizza", "Skip a party this season"],
  },
];

function voterId() {
  let id = localStorage.getItem(VOTER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY, id);
  }
  return id;
}

function coachPin() {
  return sessionStorage.getItem(PIN_KEY) || "";
}

function setCoachPin(pin) {
  sessionStorage.setItem(PIN_KEY, pin);
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function route() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const poll = path.match(/^\/p\/([a-z0-9]+)$/);
  if (poll) return { name: "poll", id: poll[1] };
  if (path === "/coach") return { name: "coach" };
  return { name: "home" };
}

async function api(path, { method = "GET", body, pin } = {}) {
  const headers = { "Content-Type": "application/json", "X-Voter-Id": voterId() };
  const usePin = pin ?? coachPin();
  if (usePin) headers["X-Coach-Pin"] = usePin;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function pinGate(next) {
  app.innerHTML = `
    <h2>Coach only</h2>
    <p class="lede">Enter the team PIN to make polls or see the board. Parents don't need this — they just use the link you send them.</p>
    <form id="pin-form">
      <label for="pin">Coach PIN</label>
      <input id="pin" type="password" inputmode="text" autocomplete="current-password" required />
      <div class="actions">
        <button class="btn primary" type="submit">Continue</button>
      </div>
      <p class="meta">Default PIN is <strong>dugout</strong> unless you changed it.</p>
      <p id="err" class="error hidden"></p>
    </form>
  `;
  app.querySelector("#pin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = app.querySelector("#pin").value.trim();
    const err = app.querySelector("#err");
    try {
      await api("/api/session", { method: "POST", pin });
      setCoachPin(pin);
      next();
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });
}

function optionInputs(values = ["", ""]) {
  return values
    .map(
      (value, index) => `
      <div class="choice-row">
        <input type="text" class="option-input" maxlength="120" placeholder="Choice ${index + 1}" value="${escapeHtml(value)}" />
        <button type="button" class="remove-option" aria-label="Remove choice">×</button>
      </div>`
    )
    .join("");
}

function renderHome() {
  if (!coachPin()) return pinGate(renderHome);
  app.innerHTML = `
    <h2>Ask the parents</h2>
    <p class="lede">Write a quick poll, copy the link, drop it in the team chat.</p>
    <div class="templates" id="templates"></div>
    <form id="create">
      <label for="question">Question</label>
      <input id="question" type="text" maxlength="200" placeholder="Who can bring snacks Saturday?" required />
      <label for="description">Optional note</label>
      <textarea id="description" maxlength="400" placeholder="Game at 10am. Let me know by Friday."></textarea>
      <label>Choices</label>
      <div class="choices" id="choices">${optionInputs()}</div>
      <div class="actions">
        <button class="btn quiet" id="add-choice" type="button">Add a choice</button>
      </div>
      <div class="toggles">
        <label class="check"><input id="multi" type="checkbox" /> Allow more than one answer</label>
        <label class="check"><input id="need-name" type="checkbox" /> Ask for a parent name</label>
      </div>
      <label for="closes">Optional close time</label>
      <input id="closes" type="datetime-local" />
      <div class="actions">
        <button class="btn primary wide" type="submit">Create poll &amp; get link</button>
      </div>
      <p id="err" class="error hidden"></p>
    </form>
  `;

  const templates = app.querySelector("#templates");
  TEMPLATES.forEach((tpl) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = tpl.label;
    chip.addEventListener("click", () => {
      templates.querySelectorAll(".chip").forEach((el) => el.classList.remove("active"));
      chip.classList.add("active");
      app.querySelector("#question").value = tpl.question;
      app.querySelector("#choices").innerHTML = optionInputs(tpl.options);
      app.querySelector("#multi").checked = Boolean(tpl.allowMultiple);
      app.querySelector("#need-name").checked = Boolean(tpl.requireName);
    });
    templates.appendChild(chip);
  });

  app.querySelector("#add-choice").addEventListener("click", () => {
    const box = app.querySelector("#choices");
    if (box.children.length >= 8) return toast("Eight choices is plenty.");
    box.insertAdjacentHTML("beforeend", optionInputs([""]));
  });
  app.querySelector("#choices").addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-option")) return;
    const rows = app.querySelectorAll(".choice-row");
    if (rows.length <= 2) return toast("Keep at least two choices.");
    event.target.closest(".choice-row").remove();
  });

  app.querySelector("#create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = app.querySelector("#err");
    const options = [...app.querySelectorAll(".option-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);
    const closes = app.querySelector("#closes").value;
    try {
      const poll = await api("/api/polls", {
        method: "POST",
        body: {
          question: app.querySelector("#question").value,
          description: app.querySelector("#description").value,
          options,
          allowMultiple: app.querySelector("#multi").checked,
          requireName: app.querySelector("#need-name").checked,
          closesAt: closes ? new Date(closes).toISOString() : null,
        },
      });
      history.pushState({}, "", `/p/${poll.id}`);
      renderCreated(poll);
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });
}

function pollUrl(id) {
  return `${location.origin}/p/${id}`;
}

function renderCreated(poll) {
  const url = pollUrl(poll.id);
  app.innerHTML = `
    <h2>Link is ready</h2>
    <p class="lede">Text this to the team. Parents tap, vote, done.</p>
    <div class="share-box" id="link">${escapeHtml(url)}</div>
    <div class="actions">
      <button class="btn primary" id="copy" type="button">Copy link</button>
      <button class="btn navy" id="share" type="button">Share</button>
      <a class="btn quiet" href="/p/${poll.id}">Open the poll</a>
      <a class="btn quiet" href="/">Make another</a>
    </div>
  `;
  app.querySelector("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(url);
    toast("Copied. Paste it in the group chat.");
  });
  app.querySelector("#share").addEventListener("click", async () => {
    if (navigator.share) {
      await navigator.share({ title: poll.question, url, text: poll.question });
    } else {
      await navigator.clipboard.writeText(url);
      toast("Copied the link.");
    }
  });
  navigator.clipboard.writeText(url).then(
    () => toast("Link copied."),
    () => {}
  );
}

function rankedResults(poll) {
  const high = Math.max(0, ...poll.options.map((opt) => opt.votes));
  const total = poll.totalVotes || 0;
  const sorted = poll.options
    .map((opt, index) => ({ ...opt, index }))
    .sort((a, b) => b.votes - a.votes || a.index - b.index);
  let place = 0;
  let prev = null;
  return sorted.map((opt, i) => {
    if (opt.votes !== prev) place = i + 1;
    prev = opt.votes;
    return {
      ...opt,
      place,
      leading: high > 0 && opt.votes === high,
      pct: total ? Math.round((opt.votes / total) * 100) : 0,
      width: total ? (opt.votes / total) * 100 : 0,
    };
  });
}

function resultsMarkup(poll) {
  return rankedResults(poll)
    .map((opt) => {
      const extras = [
        opt.leading ? "leading" : "",
        !opt.leading && opt.place === 2 ? "place-2" : "",
        !opt.leading && opt.place === 3 ? "place-3" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <article class="result-card ${extras}">
          <div class="result-head">
            <span class="place">${opt.place}</span>
            <div class="result-label">
              <span class="choice-name">${escapeHtml(opt.text)}</span>
              ${opt.leading ? `<span class="tag-lead">Leading</span>` : ""}
            </div>
            <div class="result-count">
              <strong>${opt.votes}</strong>
              <em>${opt.pct}%</em>
            </div>
          </div>
          <div class="bar-track"><div class="bar-fill" data-width="${opt.width}%"></div></div>
        </article>`;
    })
    .join("");
}

function animateBars() {
  requestAnimationFrame(() => {
    app.querySelectorAll(".bar-fill[data-width]").forEach((el) => {
      el.style.width = el.dataset.width;
    });
  });
}

function renderResults(poll, heading = "Here's the count") {
  const votes = poll.totalVotes || 0;
  app.innerHTML = `
    <h2>${escapeHtml(poll.question)}</h2>
    ${poll.description ? `<p class="lede">${escapeHtml(poll.description)}</p>` : ""}
    <div class="stat-row">
      <div class="stat"><strong>${votes}</strong><span>${votes === 1 ? "vote" : "votes"}</span></div>
      <div class="stat"><strong>${poll.closed ? "Closed" : "Open"}</strong><span>status</span></div>
    </div>
    <div class="results">${resultsMarkup(poll)}</div>
    <p class="ok">${escapeHtml(heading)}</p>
    <div class="actions">
      <a class="btn quiet" href="/">Make another poll</a>
    </div>
  `;
  animateBars();
}

async function renderPoll(id) {
  let poll;
  try {
    poll = await api(`/api/polls/${id}`);
  } catch (error) {
    app.innerHTML = `<h2>Poll not found</h2><p class="lede">${escapeHtml(error.message)}</p>`;
    return;
  }

  if (poll.youVoted || poll.closed) {
    renderResults(poll, poll.closed ? "This one is closed." : "You already voted. Thanks.");
    return;
  }

  app.innerHTML = `
    <h2>${escapeHtml(poll.question)}</h2>
    ${poll.description ? `<p class="lede">${escapeHtml(poll.description)}</p>` : ""}
    <p class="meta">${poll.allowMultiple ? "Pick any that apply." : "Pick one."}${poll.requireName ? " Add your name so coach can follow up." : ""}</p>
    ${poll.requireName ? `<label for="name">Your name</label><input id="name" type="text" maxlength="60" placeholder="Alex's parent" />` : ""}
    <div class="options" id="options">
      ${poll.options
        .map(
          (opt) =>
            `<button class="option" type="button" data-id="${opt.id}">${escapeHtml(opt.text)}</button>`
        )
        .join("")}
    </div>
    <div class="actions">
      <button class="btn primary wide" id="vote" type="button">Submit vote</button>
    </div>
    <p id="err" class="error hidden"></p>
  `;

  const selected = new Set();
  app.querySelector("#options").addEventListener("click", (event) => {
    const btn = event.target.closest(".option");
    if (!btn) return;
    const idSel = btn.dataset.id;
    if (poll.allowMultiple) {
      if (selected.has(idSel)) selected.delete(idSel);
      else selected.add(idSel);
    } else {
      selected.clear();
      selected.add(idSel);
    }
    app.querySelectorAll(".option").forEach((el) => {
      el.classList.toggle("selected", selected.has(el.dataset.id));
    });
  });

  app.querySelector("#vote").addEventListener("click", async () => {
    const err = app.querySelector("#err");
    try {
      const result = await api(`/api/polls/${id}/vote`, {
        method: "POST",
        body: {
          voterId: voterId(),
          optionIds: [...selected],
          name: app.querySelector("#name")?.value || "",
        },
      });
      renderResults(result, "You're in. Here's how the team is leaning.");
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });
}

async function renderCoach() {
  if (!coachPin()) return pinGate(renderCoach);
  let data;
  try {
    data = await api("/api/coach/polls");
  } catch (error) {
    sessionStorage.removeItem(PIN_KEY);
    app.innerHTML = `<h2>Could not load</h2><p class="lede">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.polls.length) {
    app.innerHTML = `
      <h2>Coach board</h2>
      <p class="lede">No polls yet.</p>
      <a class="btn primary" href="/">Create one</a>
    `;
    return;
  }
  app.innerHTML = `
    <h2>Coach board</h2>
    <p class="lede">Every poll you've sent out. Copy a link again anytime.</p>
    <div class="list">
      ${data.polls
        .map((poll) => {
          const names = (poll.voters || [])
            .map((v) => v.name)
            .filter((name) => name && name !== "Anonymous");
          return `
            <article class="poll-row" data-id="${poll.id}">
              <h3>${escapeHtml(poll.question)}</h3>
              <p class="meta">${poll.totalVotes} vote${poll.totalVotes === 1 ? "" : "s"}${poll.closed ? " · closed" : ""}</p>
              <div class="results compact">${resultsMarkup(poll)}</div>
              ${names.length ? `<p class="voters">Voted: ${escapeHtml(names.join(", "))}</p>` : ""}
              <div class="row-actions">
                <button class="btn quiet copy" type="button">Copy link</button>
                <button class="btn quiet toggle" type="button">${poll.closed ? "Reopen" : "Close"}</button>
                <button class="btn quiet delete" type="button">Delete</button>
              </div>
            </article>`;
        })
        .join("")}
    </div>
    <div class="actions"><a class="btn primary" href="/">New poll</a></div>
  `;
  app.querySelectorAll(".poll-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(pollUrl(id));
      toast("Link copied.");
    });
    row.querySelector(".toggle").addEventListener("click", async () => {
      const closed = row.querySelector(".toggle").textContent === "Close";
      await api(`/api/polls/${id}/close`, { method: "POST", body: { closed } });
      renderCoach();
    });
    row.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm("Delete this poll?")) return;
      await api(`/api/polls/${id}`, { method: "DELETE" });
      renderCoach();
    });
  });
  animateBars();
}

async function boot() {
  try {
    const meta = await api("/api/meta");
    if (meta.team) document.getElementById("team-name").textContent = meta.team;
  } catch {
    document.getElementById("team-name").textContent = "Team polls";
  }
  const r = route();
  if (r.name === "poll") return renderPoll(r.id);
  if (r.name === "coach") return renderCoach();
  renderHome();
}

window.addEventListener("popstate", boot);
document.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link || link.target || link.href.startsWith("mailto:")) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  history.pushState({}, "", url.pathname);
  boot();
});

boot();
