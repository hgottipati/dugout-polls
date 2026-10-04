const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const VOTER_KEY = "dugout-voter-id";
const LAST_TITLE_KEY = "dugout-last-title";
const TITLES_KEY = "dugout-titles";
const MY_POLLS_KEY = "dugout-my-polls";
const NAME_KEY = "dugout-parent-name";
const MAX_OPTIONS = 24;
let liveTimer = 0;

function stopLive() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = 0;
}

const TEMPLATES = [
  {
    key: "snack",
    label: "Snack sign-up",
    signup: true,
    allowMultiple: true,
    requireName: true,
    question: "Who's bringing snacks?",
    description: "Pick an open game. Taken dates show the family who already claimed them.",
    options: [
      "Sat, March 14",
      "Sat, March 21",
      "Sat, March 28",
      "Sat, April 4",
      "Sat, April 11",
      "Sat, April 18",
      "Sat, April 25",
      "Sat, May 2",
    ],
  },
  {
    key: "volunteer",
    label: "Volunteer slots",
    signup: true,
    allowMultiple: true,
    requireName: true,
    question: "Can you help this Saturday?",
    description: "One family per job. Grab an open spot.",
    options: ["Scorekeeping", "Field setup", "Snack shack", "Base coach", "Cleanup"],
  },
  {
    key: "practice",
    label: "Practice time",
    question: "Which practice time works best this week?",
    options: ["Tuesday 5:30 PM", "Wednesday 5:30 PM", "Thursday 5:30 PM", "Saturday morning"],
    allowMultiple: true,
  },
  {
    key: "rain",
    label: "Rain makeup",
    question: "If Saturday gets rained out, which makeup day works?",
    options: ["Sunday afternoon", "Monday evening", "Next Saturday", "Skip and move on"],
  },
  {
    key: "picnic",
    label: "Yes / No",
    question: "Are you coming to the end-of-season picnic?",
    options: ["Yes, we'll be there", "No, we can't make it", "Not sure yet"],
    requireName: true,
  },
  {
    key: "jobs",
    label: "Game volunteer",
    question: "Can you help at Saturday's game?",
    options: ["Scorekeeping", "Field setup", "Snack shack", "Wherever you need me", "Can't this week"],
    requireName: true,
    allowMultiple: true,
  },
  {
    key: "party",
    label: "Party date",
    question: "When should we do the end-of-season party?",
    options: ["Saturday after the last game", "Sunday afternoon", "Weeknight pizza", "Skip a party this season"],
  },
  {
    key: "qa",
    label: "Team Q&A",
    qa: true,
    requireName: true,
    question: "What should we talk about?",
    description: "Add a question. Upvote the ones you want answered. Popular ones rise.",
    options: [],
  },
];

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function writeCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function voterId() {
  let id = localStorage.getItem(VOTER_KEY) || readCookie(VOTER_KEY);
  if (!id) id = crypto.randomUUID();
  localStorage.setItem(VOTER_KEY, id);
  writeCookie(VOTER_KEY, id);
  return id;
}

function rememberedTitles() {
  try {
    return JSON.parse(localStorage.getItem(TITLES_KEY) || "[]").filter(Boolean);
  } catch {
    return [];
  }
}

function rememberTitle(title) {
  if (!title) return;
  localStorage.setItem(LAST_TITLE_KEY, title);
  const next = [title, ...rememberedTitles().filter((item) => item !== title)].slice(0, 10);
  localStorage.setItem(TITLES_KEY, JSON.stringify(next));
}

function myPolls() {
  try {
    return JSON.parse(localStorage.getItem(MY_POLLS_KEY) || "[]").filter((item) => item?.id);
  } catch {
    return [];
  }
}

function rememberMyPoll(poll) {
  if (!poll?.id) return;
  const next = [
    {
      id: poll.id,
      manageKey: poll.manageKey || poll.editCode || manageKeyFor(poll.id),
      editCode: poll.editCode || "",
      question: poll.question,
      title: poll.title || "",
    },
    ...myPolls().filter((item) => item.id !== poll.id),
  ].slice(0, 20);
  localStorage.setItem(MY_POLLS_KEY, JSON.stringify(next));
}

function forgetMyPoll(id) {
  localStorage.setItem(MY_POLLS_KEY, JSON.stringify(myPolls().filter((item) => item.id !== id)));
}

function manageKeyFor(id) {
  const mine = myPolls().find((item) => item.id === id);
  return mine?.manageKey || mine?.editCode || "";
}

function displayEditCode(code) {
  const raw = String(code || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return raw;
}

function rememberedName() {
  return localStorage.getItem(NAME_KEY) || "";
}

function rememberName(name) {
  if (name) localStorage.setItem(NAME_KEY, name.trim());
}

function pollHeading(poll) {
  return `
    ${poll.title ? `<p class="kicker">${escapeHtml(poll.title)}</p>` : ""}
    <h2>${escapeHtml(poll.question)}</h2>
    ${poll.description ? `<p class="lede">${escapeHtml(poll.description)}</p>` : ""}
  `;
}

function setHeaderLabel(text) {
  document.getElementById("team-name").textContent = text || "Share a link";
}

function setLayout(land) {
  app.classList.toggle("card", !land);
  app.classList.toggle("land", land);
  document.body.classList.toggle("on-land", land);
  document.querySelector(".wrap")?.classList.toggle("wide", land);
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
  const edit = path.match(/^\/p\/([a-z0-9]+)\/edit$/);
  if (edit) return { name: "edit", id: edit[1] };
  const poll = path.match(/^\/p\/([a-z0-9]+)$/);
  if (poll) return { name: "poll", id: poll[1] };
  if (path === "/new") return { name: "create" };
  if (path === "/mine") return { name: "mine" };
  if (path === "/about") return { name: "about" };
  if (path === "/privacy") return { name: "privacy" };
  if (path === "/terms") return { name: "terms" };
  if (path === "/") return { name: "home" };
  return { name: "notfound" };
}

async function api(path, { method = "GET", body, manageKey } = {}) {
  const headers = { "Content-Type": "application/json", "X-Voter-Id": voterId() };
  if (manageKey) headers["X-Manage-Key"] = manageKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function unlockWithCode(id, next) {
  app.innerHTML = `
    <h2>Switching phones?</h2>
    <p class="lede">This device doesn’t remember the poll. Enter the backup edit code from when you created it.</p>
    <form id="code-form">
      <label for="edit-code">Backup edit code</label>
      <input id="edit-code" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx" required />
      <div class="actions">
        <button class="btn primary" type="submit">Unlock</button>
        <a class="btn quiet" href="/p/${id}">Cancel</a>
      </div>
      <p id="err" class="error hidden"></p>
    </form>
  `;
  app.querySelector("#code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = app.querySelector("#edit-code").value.trim();
    const err = app.querySelector("#err");
    try {
      const poll = await api(`/api/polls/${id}`, { manageKey: code });
      if (!poll.youOwn) throw new Error("That code doesn't match this poll.");
      rememberMyPoll({ ...poll, manageKey: code, editCode: poll.editCode || code });
      toast("Unlocked. You can edit this poll from this phone now.");
      next();
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });
}

async function fillTitleChoices() {
  let titles = [
    ...rememberedTitles(),
    ...myPolls().map((poll) => poll.title).filter(Boolean),
  ];
  titles = [...new Set(titles)];
  const list = app.querySelector("#title-list");
  const chips = app.querySelector("#title-chips");
  if (!list || !chips) return;
  list.innerHTML = titles.map((title) => `<option value="${escapeHtml(title)}"></option>`).join("");
  chips.innerHTML = "";
  titles.forEach((title) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = title;
    chip.addEventListener("click", () => {
      app.querySelector("#title").value = title;
    });
    chips.appendChild(chip);
  });
}

function optionInputs(values = ["", ""], ids = []) {
  return values
    .map(
      (value, index) => `
      <div class="choice-row">
        <input type="text" class="option-input" maxlength="120" placeholder="Choice ${index + 1}" value="${escapeHtml(value)}" data-id="${escapeHtml(ids[index] || "")}" />
        <button type="button" class="remove-option" aria-label="Remove choice">×</button>
      </div>`
    )
    .join("");
}

function toLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readOptions() {
  return [...app.querySelectorAll(".option-input")]
    .map((input) => ({ id: input.dataset.id || "", text: input.value.trim() }))
    .filter((opt) => opt.text);
}

function readPollForm() {
  const closes = app.querySelector("#closes").value;
  return {
    title: app.querySelector("#title").value,
    question: app.querySelector("#question").value,
    description: app.querySelector("#description").value,
    options: readOptions(),
    allowMultiple: app.querySelector("#multi").checked,
    requireName: app.querySelector("#need-name").checked,
    showResults: app.querySelector("#show-results").checked,
    signup: app.querySelector("#signup").checked,
    qa: Boolean(app.querySelector("#qa")?.checked),
    slotLimit: Number(app.querySelector("#slot-limit").value) || 1,
    closesAt: closes ? new Date(closes).toISOString() : null,
  };
}

function confirmRemovedSlots(poll, nextOptions) {
  if (!poll?.options) return true;
  const keep = new Set(nextOptions.map((opt) => opt.id).filter(Boolean));
  const lost = poll.options.filter((opt) => opt.id && !keep.has(opt.id) && (opt.votes || 0) > 0);
  if (!lost.length) return true;
  const labels = lost.map((opt) => opt.text).join(", ");
  return confirm(`Remove ${labels}? Votes or sign-ups on those will be dropped.`);
}

function wireSignupAndChoices({ editing = false } = {}) {
  const signupBox = app.querySelector("#signup");
  const qaBox = app.querySelector("#qa");
  function syncSignupUi() {
    const qa = Boolean(qaBox?.checked);
    const signup = Boolean(signupBox?.checked) && !qa;
    app.querySelector("#choices-block")?.classList.toggle("hidden", qa);
    app.querySelector("#choices-label").textContent = signup ? "Dates / slots" : "Choices";
    const addBtn = app.querySelector("#add-choice");
    if (addBtn) addBtn.textContent = signup ? "Add a date" : "Add a choice";
    const btn = app.querySelector("#create-btn");
    if (editing) btn.textContent = "Save changes";
    else if (qa) btn.textContent = "Create Q&A board & get link";
    else btn.innerHTML = signup ? "Create sign-up sheet &amp; get link" : "Create poll &amp; get link";
    app.querySelector("#multi-label").textContent = signup
      ? "A family can claim more than one date"
      : "Allow more than one answer";
    app.querySelector("#question-label").textContent = qa ? "Prompt" : "Question";
    app.querySelector("#slot-limit-row").classList.toggle("hidden", !signup);
    app.querySelector("#need-name-row").classList.toggle("hidden", signup);
    app.querySelector("#show-results-row").classList.toggle("hidden", signup || qa);
    app.querySelector("#multi-row")?.classList.toggle("hidden", qa);
    if (signup) {
      app.querySelector("#need-name").checked = true;
      app.querySelector("#show-results").checked = true;
    }
    if (qa) app.querySelector("#show-results").checked = true;
  }
  signupBox.addEventListener("change", () => {
    if (signupBox.checked && qaBox) qaBox.checked = false;
    syncSignupUi();
  });
  qaBox?.addEventListener("change", () => {
    if (qaBox.checked && signupBox) signupBox.checked = false;
    syncSignupUi();
  });
  syncSignupUi();
  app.querySelector("#add-choice")?.addEventListener("click", () => {
    const box = app.querySelector("#choices");
    if (box.children.length >= MAX_OPTIONS) return toast("That's enough dates.");
    box.insertAdjacentHTML("beforeend", optionInputs([""]));
  });
  app.querySelector("#choices")?.addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-option")) return;
    const rows = app.querySelectorAll(".choice-row");
    if (rows.length <= 2) return toast("Keep at least two slots.");
    event.target.closest(".choice-row").remove();
  });
  return syncSignupUi;
}

function mineMarkup() {
  const mine = myPolls();
  if (!mine.length) return "";
  return `
    <section class="mine">
      <h3 class="group-head">Your polls</h3>
      <p class="meta">On this phone, under <a href="/mine">Your polls</a>. You don’t need the link from create.</p>
      <div class="list">
        ${mine
          .slice(0, 5)
          .map(
            (poll) => `
          <a class="poll-row mine-row" href="/p/${escapeHtml(poll.id)}">
            ${poll.title ? `<p class="kicker">${escapeHtml(poll.title)}</p>` : ""}
            <h3>${escapeHtml(poll.question || "Untitled poll")}</h3>
          </a>`
          )
          .join("")}
      </div>
      ${mine.length > 5 ? `<p class="meta"><a href="/mine">See all ${mine.length} →</a></p>` : ""}
    </section>
  `;
}

function renderMine() {
  setLayout(false);
  setHeaderLabel("Your polls");
  const mine = myPolls();
  if (!mine.length) {
    app.innerHTML = `
      <h2>Your polls</h2>
      <p class="lede">Polls you create on this phone land here. Copy the share link again anytime. If you switch phones, use the backup edit code from create.</p>
      <div class="actions"><a class="btn primary" href="/new">Create a poll</a></div>
    `;
    return;
  }
  app.innerHTML = `
    <h2>Your polls</h2>
    <p class="lede">Saved on this phone. Copy the share link again anytime. The edit code is only a backup for a new phone.</p>
    <div class="list">
      ${mine
        .map(
          (poll) => `
        <article class="poll-row" data-id="${escapeHtml(poll.id)}">
          ${poll.title ? `<p class="kicker">${escapeHtml(poll.title)}</p>` : ""}
          <h3>${escapeHtml(poll.question || "Untitled poll")}</h3>
          ${poll.editCode ? `<p class="meta">Backup code ${escapeHtml(displayEditCode(poll.editCode))}</p>` : ""}
          <div class="row-actions">
            <button class="btn quiet copy" type="button">Copy link</button>
            <a class="btn quiet" href="/p/${escapeHtml(poll.id)}">Open</a>
            <a class="btn quiet" href="/p/${escapeHtml(poll.id)}/edit">Edit</a>
          </div>
        </article>`
        )
        .join("")}
    </div>
    <div class="actions"><a class="btn primary" href="/new">New poll</a></div>
  `;
  app.querySelectorAll(".poll-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".copy")?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(pollUrl(id));
      toast("Link copied.");
    });
  });
}

function createYoursCta(copy = "Want to ask your own group something?") {
  return `
    <div class="cta-banner">
      <p>${escapeHtml(copy)}</p>
      <a class="btn primary" href="/new">Create your poll</a>
    </div>
  `;
}

function ownerBar(poll) {
  if (!poll.youOwn) return "";
  return `
    <div class="owner-bar">
      <p class="meta">This phone can manage the poll. Switching devices? Use the backup edit code.</p>
      ${poll.editCode ? `<p class="edit-code-line">Backup code <strong>${escapeHtml(displayEditCode(poll.editCode))}</strong> <button class="text-btn" id="copy-code" type="button">Copy</button></p>` : ""}
      <div class="owner-actions">
        <a class="btn quiet" href="/p/${poll.id}/edit">Edit</a>
        <button class="btn quiet" id="owner-copy" type="button">Copy link</button>
        ${poll.signup || poll.qa ? "" : `<button class="btn quiet" id="owner-visibility" type="button">${poll.showResults ? "Hide results" : "Show results"}</button>`}
        <button class="btn quiet" id="owner-toggle" type="button">${poll.closed ? "Reopen" : "Close"}</button>
        <button class="btn quiet owner-delete" id="owner-delete" type="button">Delete</button>
      </div>
    </div>
  `;
}

function madeThisButton(poll) {
  if (poll.youOwn) return "";
  return `<p class="meta create-link"><button class="btn quiet" id="i-made-this" type="button">I made this poll</button></p>`;
}

function bindMadeThis(poll) {
  app.querySelector("#i-made-this")?.addEventListener("click", () => {
    unlockWithCode(poll.id, () => renderPoll(poll.id));
  });
}

function bindOwnerActions(poll) {
  if (!poll.youOwn) return;
  const key = manageKeyFor(poll.id);
  const reload = () => renderPoll(poll.id);
  app.querySelector("#copy-code")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(displayEditCode(poll.editCode));
    toast("Edit code copied.");
  });
  app.querySelector("#owner-copy")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(pollUrl(poll.id));
    toast("Link copied.");
  });
  app.querySelector("#owner-visibility")?.addEventListener("click", async () => {
    const showResults = app.querySelector("#owner-visibility").textContent === "Show results";
    await api(`/api/polls/${poll.id}/results`, { method: "POST", body: { showResults }, manageKey: key });
    toast(showResults ? "Voters can see the scoreboard." : "Results are hidden from voters.");
    reload();
  });
  app.querySelector("#owner-toggle")?.addEventListener("click", async () => {
    const closed = app.querySelector("#owner-toggle").textContent === "Close";
    await api(`/api/polls/${poll.id}/close`, { method: "POST", body: { closed }, manageKey: key });
    reload();
  });
  app.querySelector("#owner-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete this poll?")) return;
    await api(`/api/polls/${poll.id}`, { method: "DELETE", manageKey: key });
    forgetMyPoll(poll.id);
    history.pushState({}, "", "/");
    renderLanding();
    toast("Poll deleted.");
  });
}

const PLAYS = [
  {
    key: "snack",
    title: "Snack sign-up",
    blurb: "One family per game. Taken dates show who already claimed them.",
  },
  {
    key: "rain",
    title: "Rain makeup",
    blurb: "Saturday got washed out. Let parents pick the new day.",
  },
  {
    key: "volunteer",
    title: "Game-day jobs",
    blurb: "Scorebook, field setup, snack shack. Fill the lineup.",
  },
  {
    key: "practice",
    title: "Practice time",
    blurb: "See which night actually works before you book the diamond.",
  },
  {
    key: "picnic",
    title: "Picnic RSVP",
    blurb: "Who's coming to the end-of-season hang. Yes, no, or not sure.",
  },
  {
    key: "party",
    title: "Party date",
    blurb: "Pizza, trophies, last huddle of the year. Pick a day.",
  },
  {
    key: "qa",
    title: "Team Q&A",
    blurb: "Parents add questions. The team upvotes. The hot ones rise to the top.",
  },
];

function renderLanding() {
  setLayout(true);
  setHeaderLabel("Share a link");
  app.innerHTML = `
    <section class="hero">
      <p class="hero-kicker">Baseball &amp; softball sidelines</p>
      <h2>Run the season from the dugout.</h2>
      <p class="hero-lede">Snack sheets, rain makeup, picnic RSVPs, volunteer jobs, or a live Q&amp;A. Make it, text the link, parents tap. No login. No app.</p>
      <div class="hero-actions">
        <a class="btn primary" href="/new">Create a poll</a>
        <a class="btn navy" href="/new?tpl=snack">Make a sign-up sheet</a>
        <a class="btn hero-quiet" href="/new?tpl=qa">Open a Q&amp;A</a>
      </div>
    </section>
    <section class="demo-sheet" aria-label="Sample snack sign-up">
      <p class="demo-badge">Sample</p>
      <h3>Who's bringing snacks?</h3>
      <p class="meta">How a sign-up looks after a couple of families grab dates. Not a live poll.</p>
      <div class="options compact-sheet" aria-hidden="true">
        <div class="option sheet-slot taken"><span class="choice-name">Sat, March 14</span><span class="slot-meta">Taken</span></div>
        <div class="option sheet-slot open"><span class="choice-name">Sat, March 21</span><span class="slot-meta">Open</span></div>
        <div class="option sheet-slot taken"><span class="choice-name">Sat, March 28</span><span class="slot-meta">Taken</span></div>
        <div class="option sheet-slot open"><span class="choice-name">Sat, April 4</span><span class="slot-meta">Open</span></div>
      </div>
      <a class="btn navy wide" href="/new?tpl=snack">Make a snack sheet</a>
    </section>
    ${mineMarkup()}
    <section class="play-board">
      <p class="kicker">What teams use it for</p>
      <div class="play-grid">
        ${PLAYS.map(
          (play) => `
          <a class="play-card" href="/new?tpl=${encodeURIComponent(play.key)}">
            <h3>${escapeHtml(play.title)}</h3>
            <p>${escapeHtml(play.blurb)}</p>
            <span class="play-go">Use this</span>
          </a>`
        ).join("")}
      </div>
    </section>
    <section class="how">
      <article>
        <span class="how-num">1</span>
        <h3>Make it</h3>
        <p>A poll or a sign-up sheet. Two minutes, still in the parking lot.</p>
      </article>
      <article>
        <span class="how-num">2</span>
        <h3>Share the link</h3>
        <p>Drop it in Messages, WhatsApp, or GameChanger. Preview card included.</p>
      </article>
      <article>
        <span class="how-num">3</span>
        <h3>Watch it fill</h3>
        <p>Parents see what's taken. You get names, not a 40-message thread.</p>
      </article>
    </section>
  `;
}

function renderCreate() {
  setLayout(false);
  setHeaderLabel("Share a link");
  const lastTitle = localStorage.getItem(LAST_TITLE_KEY) || "";
  app.innerHTML = `
    <h2>Create a poll</h2>
    <p class="lede">No login. Make a poll, a sign-up sheet, or a Q&amp;A where questions rise by votes.</p>
    <form id="create">
      <label for="title">Title <span class="optional">optional</span></label>
      <input id="title" type="text" maxlength="80" list="title-list" placeholder="12U Softball · Spring 2026" value="${escapeHtml(lastTitle)}" />
      <datalist id="title-list"></datalist>
      <div class="templates" id="title-chips"></div>
      <p class="meta">Question templates</p>
      <div class="templates" id="templates"></div>
      <label id="question-label" for="question">Question</label>
      <input id="question" type="text" maxlength="200" placeholder="Who's bringing snacks?" required />
      <label for="description">Optional note</label>
      <textarea id="description" maxlength="400" placeholder="Game at 10am. Grab an open date."></textarea>
      <div id="choices-block">
      <label id="choices-label">Choices</label>
      <div class="choices" id="choices">${optionInputs()}</div>
      <div class="actions">
        <button class="btn quiet" id="add-choice" type="button">Add a choice</button>
      </div>
      </div>
      <div class="toggles">
        <label class="check"><input id="qa" type="checkbox" /> <span>Q&amp;A board. People add questions, the team upvotes, popular ones rise</span></label>
        <label class="check"><input id="signup" type="checkbox" /> <span>Sign-up sheet. One family per date/slot, and everyone can see what's taken</span></label>
        <label class="check" id="multi-row"><input id="multi" type="checkbox" /> <span id="multi-label">Allow more than one answer</span></label>
        <label class="check" id="need-name-row"><input id="need-name" type="checkbox" /> <span>Ask for a name</span></label>
        <label class="check" id="show-results-row"><input id="show-results" type="checkbox" checked /> <span>Show results after they vote</span></label>
      </div>
      <div id="slot-limit-row" class="hidden">
        <label for="slot-limit">Spots per date</label>
        <input id="slot-limit" type="number" min="1" max="20" value="1" />
        <p class="meta">1 = first family to tap it gets it. 2 = two families can share that date.</p>
      </div>
      <label for="closes">Optional close time</label>
      <input id="closes" type="datetime-local" />
      <div class="actions">
        <button class="btn primary wide" id="create-btn" type="submit">Create poll &amp; get link</button>
      </div>
      <p id="err" class="error hidden"></p>
    </form>
    ${mineMarkup()}
  `;

  fillTitleChoices();

  const templates = app.querySelector("#templates");
  const signupBox = app.querySelector("#signup");
  const syncSignupUi = wireSignupAndChoices();

  function applyTemplate(tpl, chip) {
    templates.querySelectorAll(".chip").forEach((el) => el.classList.remove("active"));
    if (chip) chip.classList.add("active");
    app.querySelector("#question").value = tpl.question;
    app.querySelector("#description").value = tpl.description || "";
    app.querySelector("#choices").innerHTML = optionInputs(tpl.options);
    app.querySelector("#multi").checked = Boolean(tpl.allowMultiple);
    app.querySelector("#need-name").checked = Boolean(tpl.requireName);
    signupBox.checked = Boolean(tpl.signup);
    const qaBox = app.querySelector("#qa");
    if (qaBox) qaBox.checked = Boolean(tpl.qa);
    if (tpl.qa) signupBox.checked = false;
    if (tpl.qa) app.querySelector("#choices").innerHTML = optionInputs(["", ""]);
    syncSignupUi();
  }

  TEMPLATES.forEach((tpl) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.key = tpl.key || "";
    chip.textContent = tpl.label;
    chip.addEventListener("click", () => applyTemplate(tpl, chip));
    templates.appendChild(chip);
  });

  const presetKey = new URLSearchParams(location.search).get("tpl");
  const preset = TEMPLATES.find((tpl) => tpl.key === presetKey);
  if (preset) {
    const chip = templates.querySelector(`[data-key="${preset.key}"]`);
    applyTemplate(preset, chip);
  }

  app.querySelector("#create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = app.querySelector("#err");
    try {
      const poll = await api("/api/polls", {
        method: "POST",
        body: readPollForm(),
      });
      rememberTitle(poll.title);
      rememberMyPoll(poll);
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
  setHeaderLabel(poll.title);
  const url = pollUrl(poll.id);
  app.innerHTML = `
    ${poll.title ? `<p class="kicker">${escapeHtml(poll.title)}</p>` : ""}
    <h2>Link is ready</h2>
    <p class="lede">${poll.qa ? "Send this to the team. Parents add questions, upvote the ones they care about, and the popular ones rise." : poll.signup ? "Send this to the team. Parents will see which dates are already taken before they pick." : "Send this to whoever should vote. They tap, vote, done, and they can make their own poll too."} It’s also saved under <strong>Your polls</strong> on this phone.</p>
    <div class="share-box" id="link">${escapeHtml(url)}</div>
    <div class="actions">
      <button class="btn primary" id="copy" type="button">Copy link</button>
      <button class="btn navy" id="share" type="button">Share</button>
    </div>
    ${
      poll.editCode
        ? `<p class="kicker code-kicker">Backup edit code</p>
    <div class="share-box code-box" id="edit-code-box">${escapeHtml(displayEditCode(poll.editCode))}</div>
    <p class="meta">You don’t need this on this phone. It’s under Your polls. Save the code only if you might edit from a different phone.</p>
    <div class="actions">
      <button class="btn quiet" id="copy-edit-code" type="button">Copy backup code</button>
    </div>`
        : ""
    }
    <div class="actions">
      <a class="btn quiet" href="/p/${poll.id}">Open the poll</a>
      <a class="btn quiet" href="/p/${poll.id}/edit">Edit</a>
      <a class="btn quiet" href="/new">Make another</a>
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
  app.querySelector("#copy-edit-code")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(displayEditCode(poll.editCode));
    toast("Edit code copied. Save it somewhere.");
  });
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

function canSeeResults(poll) {
  return Boolean(poll.signup) || Boolean(poll.showResults) || typeof poll.options?.[0]?.votes === "number";
}

function slotTaken(opt) {
  return (opt.remaining ?? 0) <= 0;
}

function slotMeta(poll, opt) {
  const names = (opt.claimedBy || []).filter(Boolean);
  const limit = poll.slotLimit || 1;
  if (slotTaken(opt)) {
    return names.length ? `Taken · ${names.join(", ")}` : "Taken";
  }
  if (names.length) {
    return `${names.join(", ")} · ${opt.remaining} of ${limit} open`;
  }
  return limit === 1 ? "Open" : `${opt.remaining} of ${limit} open`;
}

function pendingHint(poll, opt, selected, kind) {
  if (kind === "release") return "Give this date back? It will open for someone else.";
  if (kind === "switch") {
    const from = poll.options.find((item) => selected.has(item.id));
    return `Switch from ${from?.text || "your date"} to this one? Your old date will open up.`;
  }
  if (poll.allowMultiple && selected.size) return "Add this date too?";
  return "Take this date? Nothing is saved until you confirm.";
}

function sheetMarkup(poll, { selected = new Set(), interactive = false, pending = null } = {}) {
  const yours = new Set(poll.yourOptionIds || []);
  return poll.options
    .map((opt) => {
      const taken = slotTaken(opt);
      const mine = interactive ? selected.has(opt.id) : yours.has(opt.id);
      const disabled = interactive && taken && !mine;
      const isPending = interactive && pending?.id === opt.id;
      if (isPending) {
        return `
          <div class="slot-wrap">
            <div class="option sheet-slot pending ${mine ? "mine" : "open"}" data-id="${opt.id}">
              <span class="choice-name">${escapeHtml(opt.text)}</span>
              <span class="slot-meta">${escapeHtml(pendingHint(poll, opt, selected, pending.kind))}</span>
            </div>
            <div class="slot-actions">
              <button type="button" class="btn primary" data-confirm="${opt.id}" data-kind="${pending.kind}">Confirm</button>
              <button type="button" class="btn quiet" data-cancel="1">Cancel</button>
            </div>
          </div>`;
      }
      if (interactive && mine) {
        return `
          <div class="slot-wrap">
            <button type="button" class="option sheet-slot mine" data-id="${opt.id}">
              <span class="choice-name">${escapeHtml(opt.text)}</span>
              <span class="slot-meta">Yours · saved</span>
            </button>
          </div>`;
      }
      const tag = interactive ? "button" : "div";
      const extra = interactive ? `type="button" data-id="${opt.id}" ${disabled ? "disabled" : ""}` : "";
      return `
        <${tag} class="option sheet-slot ${taken ? "taken" : "open"} ${mine ? "mine" : ""}" ${extra}>
          <span class="choice-name">${escapeHtml(opt.text)}</span>
          <span class="slot-meta">${escapeHtml(slotMeta(poll, opt))}</span>
        </${tag}>`;
    })
    .join("");
}

function renderThanks(poll) {
  setHeaderLabel(poll.title);
  app.innerHTML = `
    ${pollHeading(poll)}
    <p class="ok">${poll.closed ? "This poll is closed." : "You're in. Thanks for voting."}</p>
    <p class="lede">Results are hidden for now.</p>
    ${ownerBar(poll)}
    ${madeThisButton(poll)}
    ${createYoursCta()}
  `;
  bindOwnerActions(poll);
  bindMadeThis(poll);
}

function finishVoteView(poll, heading) {
  if (poll.signup) return renderSignup(poll);
  if (canSeeResults(poll)) renderResults(poll, heading);
  else renderThanks(poll);
}

function signupStats(poll) {
  const open = poll.options.filter((opt) => !slotTaken(opt)).length;
  const taken = poll.options.length - open;
  return { open, taken };
}

function renderResults(poll, heading = "Here's the count") {
  if (poll.signup) return renderSignup(poll);
  setHeaderLabel(poll.title);
  const votes = poll.totalVotes || 0;
  app.innerHTML = `
    ${pollHeading(poll)}
    <div class="stat-row">
      <div class="stat"><strong>${votes}</strong><span>${votes === 1 ? "vote" : "votes"}</span></div>
      <div class="stat"><strong>${poll.closed ? "Closed" : "Open"}</strong><span>status</span></div>
    </div>
    <div class="results">${resultsMarkup(poll)}</div>
    <p class="ok">${escapeHtml(heading)}</p>
    ${ownerBar(poll)}
    ${madeThisButton(poll)}
    ${createYoursCta()}
  `;
  animateBars();
  bindOwnerActions(poll);
  bindMadeThis(poll);
}

function renderSignup(poll, { justSaved = false } = {}) {
  setHeaderLabel(poll.title);
  const { open, taken } = signupStats(poll);
  const closed = poll.closed;
  const canEdit = !closed;
  const selected = new Set(poll.yourOptionIds || []);
  const nameValue = poll.yourName || rememberedName();
  app.innerHTML = `
    ${pollHeading(poll)}
    <div class="stat-row">
      <div class="stat"><strong>${open}</strong><span>${open === 1 ? "spot open" : "spots open"}</span></div>
      <div class="stat"><strong>${taken}</strong><span>claimed</span></div>
    </div>
    <p class="meta">${closed ? "This sheet is closed." : poll.allowMultiple ? "Tap a date, then Confirm. You can grab more than one. Cancel leaves it alone." : "Tap a date, then Confirm. Cancel leaves it alone. Wrong date? Tap a different open one to switch."}</p>
    ${canEdit ? `<label for="name">Your name</label><input id="name" type="text" maxlength="60" placeholder="Alex" value="${escapeHtml(nameValue)}" />` : ""}
    <div class="options" id="options">${sheetMarkup(poll, { selected, interactive: canEdit })}</div>
    ${
      canEdit
        ? `<div class="actions">
            ${poll.youVoted ? `<button class="btn quiet wide" id="unvote" type="button">Drop all my spots</button>` : ""}
          </div>
          <p id="err" class="error hidden"></p>`
        : ""
    }
    ${poll.youVoted && !closed ? `<p class="ok">${justSaved ? poll.allowMultiple ? "Saved. Want another date too? Tap it and Confirm. It will add, not replace." : "Saved. Want a different date? Tap it and Confirm. Your old one opens back up." : "You're on the sheet. Come back on this phone anytime to change."}</p>` : ""}
    ${ownerBar(poll)}
    ${madeThisButton(poll)}
    ${createYoursCta("Need a sheet for another team?")}
  `;
  bindOwnerActions(poll);
  bindMadeThis(poll);
  if (!canEdit) return;

  async function saveSlots(nextSelected, message) {
    const err = app.querySelector("#err");
    const name = app.querySelector("#name")?.value.trim() || "";
    if (!name) {
      saving = false;
      toast("Add your name so the team knows who signed up.");
      app.querySelector("#name")?.focus();
      return;
    }
    rememberName(name);
    try {
      let result;
      if (!nextSelected.size) {
        result = await api(`/api/polls/${poll.id}/unvote`, {
          method: "POST",
          body: { voterId: voterId() },
          manageKey: manageKeyFor(poll.id),
        });
      } else {
        result = await api(`/api/polls/${poll.id}/vote`, {
          method: "POST",
          body: { voterId: voterId(), optionIds: [...nextSelected], name },
          manageKey: manageKeyFor(poll.id),
        });
      }
      toast(message || "Saved.");
      renderSignup(result, { justSaved: nextSelected.size > 0 });
    } catch (error) {
      saving = false;
      err.textContent = error.message;
      err.classList.remove("hidden");
      toast(error.message);
      try {
        const fresh = await api(`/api/polls/${poll.id}`, { manageKey: manageKeyFor(poll.id) });
        renderSignup(fresh);
      } catch {
        /* keep the error on this screen */
      }
    }
  }

  let saving = false;
  let pending = null;

  function paintSlots() {
    app.querySelector("#options").innerHTML = sheetMarkup(poll, { selected, interactive: true, pending });
  }

  app.querySelector("#options").addEventListener("click", async (event) => {
    if (saving) return;
    if (event.target.closest("[data-cancel]")) {
      pending = null;
      paintSlots();
      return;
    }
    const confirmBtn = event.target.closest("[data-confirm]");
    if (confirmBtn) {
      const idSel = confirmBtn.dataset.confirm;
      const kind = confirmBtn.dataset.kind;
      const label = poll.options.find((opt) => opt.id === idSel)?.text || "that date";
      if (kind !== "release" && !app.querySelector("#name")?.value.trim()) {
        toast("Add your name so the team knows who signed up.");
        app.querySelector("#name")?.focus();
        return;
      }
      const next = new Set(selected);
      if (kind === "release") next.delete(idSel);
      else if (kind === "switch" || !poll.allowMultiple) {
        next.clear();
        next.add(idSel);
      } else next.add(idSel);
      saving = true;
      confirmBtn.disabled = true;
      await saveSlots(
        next,
        kind === "release" ? `${label} is open again.` : kind === "switch" ? `Switched. ${label} is yours now.` : `Saved. ${label} is yours.`
      );
      return;
    }
    const btn = event.target.closest(".option");
    if (!btn || btn.disabled) return;
    const idSel = btn.dataset.id;
    if (!idSel) return;
    let kind = "claim";
    if (btn.classList.contains("mine")) kind = "release";
    else if (selected.size && !selected.has(idSel) && !poll.allowMultiple) kind = "switch";
    pending = { id: idSel, kind };
    paintSlots();
  });

  app.querySelector("#unvote")?.addEventListener("click", async () => {
    if (!confirm("Drop all of your spots so someone else can take them?")) return;
    await saveSlots(new Set(), "Your spots are open again.");
  });
}

function ideaMarkup(poll, { staticView = false } = {}) {
  const ideas = poll.ideas || [];
  if (!ideas.length) {
    return `<p class="meta">No questions yet. Be first. Add one below.</p>`;
  }
  return ideas
    .map((idea) => {
      const canRemove = !staticView && (poll.youOwn || idea.youOwn);
      return `
        <article class="idea ${idea.answered ? "answered" : ""} ${idea.youVoted ? "upvoted" : ""}" data-id="${idea.id}">
          <button class="idea-vote" type="button" ${poll.closed || staticView ? "disabled" : ""} aria-pressed="${idea.youVoted ? "true" : "false"}">
            <span class="idea-arrow">▲</span>
            <strong>${idea.votes}</strong>
          </button>
          <div class="idea-body">
            <p class="idea-text">${escapeHtml(idea.text)}</p>
            <p class="idea-meta">${idea.name ? escapeHtml(idea.name) : "Anonymous"}${idea.answered ? " · answered" : ""}</p>
            ${
              canRemove
                ? `<div class="idea-actions">
                    ${poll.youOwn ? `<button class="btn quiet idea-answer" type="button">${idea.answered ? "Not answered" : "Mark answered"}</button>` : ""}
                    <button class="btn quiet idea-delete" type="button">Remove</button>
                  </div>`
                : ""
            }
          </div>
        </article>`;
    })
    .join("");
}

function renderQa(poll) {
  setHeaderLabel(poll.title);
  const closed = poll.closed;
  const openCount = (poll.ideas || []).filter((idea) => !idea.answered).length;
  app.innerHTML = `
    ${pollHeading(poll)}
    <div class="stat-row">
      <div class="stat"><strong>${openCount}</strong><span>${openCount === 1 ? "open question" : "open questions"}</span></div>
      <div class="stat"><strong>${poll.closed ? "Closed" : "Live"}</strong><span>status</span></div>
    </div>
    <p class="meta">${closed ? "This Q&A is closed." : "Add a question. Tap the arrow to upvote. Popular ones climb."}</p>
    <div id="idea-list" class="idea-list">${ideaMarkup(poll)}</div>
    ${
      closed
        ? ""
        : `<form id="idea-form">
            ${poll.requireName ? `<label for="name">Your name</label><input id="name" type="text" maxlength="60" placeholder="Alex" value="${escapeHtml(rememberedName())}" />` : ""}
            <label for="idea-text">Your question</label>
            <textarea id="idea-text" maxlength="200" placeholder="Can we move Saturday's game?" required></textarea>
            <div class="actions">
              <button class="btn primary wide" type="submit">Add question</button>
            </div>
            <p id="err" class="error hidden"></p>
          </form>`
    }
    ${ownerBar(poll)}
    ${madeThisButton(poll)}
    ${createYoursCta("Need a Q&A for another meeting?")}
  `;
  bindOwnerActions(poll);
  bindMadeThis(poll);

  app.querySelectorAll(".idea").forEach((row) => {
    const ideaId = row.dataset.id;
    row.querySelector(".idea-vote")?.addEventListener("click", async () => {
      if (closed) return;
      try {
        const result = await api(`/api/polls/${poll.id}/ideas/${ideaId}/vote`, {
          method: "POST",
          body: { voterId: voterId() },
          manageKey: manageKeyFor(poll.id),
        });
        renderQa(result);
      } catch (error) {
        toast(error.message);
      }
    });
    row.querySelector(".idea-answer")?.addEventListener("click", async () => {
      const idea = (poll.ideas || []).find((item) => item.id === ideaId);
      const result = await api(`/api/polls/${poll.id}/ideas/${ideaId}/answer`, {
        method: "POST",
        body: { answered: !idea?.answered },
        manageKey: manageKeyFor(poll.id),
      });
      renderQa(result);
    });
    row.querySelector(".idea-delete")?.addEventListener("click", async () => {
      if (!confirm("Remove this question?")) return;
      const result = await api(`/api/polls/${poll.id}/ideas/${ideaId}`, {
        method: "DELETE",
        body: { voterId: voterId() },
        manageKey: manageKeyFor(poll.id),
      });
      toast("Removed.");
      renderQa(result);
    });
  });

  app.querySelector("#idea-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = app.querySelector("#err");
    const name = app.querySelector("#name")?.value || "";
    rememberName(name);
    try {
      const result = await api(`/api/polls/${poll.id}/ideas`, {
        method: "POST",
        body: {
          voterId: voterId(),
          name,
          text: app.querySelector("#idea-text").value,
        },
        manageKey: manageKeyFor(poll.id),
      });
      toast("Question added. It's at the top of your list until others vote.");
      renderQa(result);
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });

  stopLive();
  if (!closed) {
    liveTimer = setInterval(async () => {
      const active = document.activeElement;
      if (active && (active.id === "idea-text" || active.id === "name")) return;
      if (route().name !== "poll" || route().id !== poll.id) {
        stopLive();
        return;
      }
      try {
        const fresh = await api(`/api/polls/${poll.id}`, { manageKey: manageKeyFor(poll.id) });
        if (!fresh.qa) return;
        const same = JSON.stringify((fresh.ideas || []).map((idea) => [idea.id, idea.votes, idea.answered]))
          === JSON.stringify((poll.ideas || []).map((idea) => [idea.id, idea.votes, idea.answered]));
        if (!same) renderQa(fresh);
      } catch {
        /* keep the current board up */
      }
    }, 5000);
  }
}

async function renderPoll(id) {
  let poll;
  try {
    poll = await api(`/api/polls/${id}`, { manageKey: manageKeyFor(id) });
  } catch (error) {
    app.innerHTML = `<h2>Poll not found</h2><p class="lede">${escapeHtml(error.message)}</p>${createYoursCta("Or just make a new one.")}`;
    return;
  }

  if (poll.youOwn) rememberMyPoll({ ...poll, manageKey: manageKeyFor(id) });

  if (poll.qa) {
    renderQa(poll);
    return;
  }

  if (poll.signup) {
    renderSignup(poll);
    return;
  }

  if (poll.youVoted || poll.closed) {
    finishVoteView(poll, poll.closed ? "This one is closed." : "You already voted. Thanks.");
    return;
  }

  setHeaderLabel(poll.title);
  app.innerHTML = `
    ${pollHeading(poll)}
    <p class="meta">${poll.allowMultiple ? "Pick any that apply." : "Pick one."}${poll.requireName ? " Add your name so they know who voted." : ""}</p>
    ${poll.requireName ? `<label for="name">Your name</label><input id="name" type="text" maxlength="60" placeholder="Alex" />` : ""}
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
    ${ownerBar(poll)}
    ${madeThisButton(poll)}
    <p class="meta create-link">Need a different question? <a href="/new">Create your own poll</a></p>
  `;
  bindOwnerActions(poll);
  bindMadeThis(poll);

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
        manageKey: manageKeyFor(id),
      });
      finishVoteView(result, "You're in. Here's how the team is leaning.");
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });
}

async function renderEdit(id) {
  let poll;
  try {
    poll = await api(`/api/polls/${id}`, { manageKey: manageKeyFor(id) });
  } catch (error) {
    app.innerHTML = `<h2>Poll not found</h2><p class="lede">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!poll.youOwn) return unlockWithCode(id, () => renderEdit(id));

  setHeaderLabel(poll.title);
  const optionTexts = poll.options.map((opt) => opt.text);
  const optionIds = poll.options.map((opt) => opt.id);
  app.innerHTML = `
    <h2>Edit ${poll.qa ? "Q&A board" : poll.signup ? "sign-up sheet" : "poll"}</h2>
    <p class="lede">${poll.qa ? "Change the prompt anytime. Existing questions and votes stay." : "Rename dates to keep the people who already claimed them. Delete a date only if you want those sign-ups dropped."}</p>
    <form id="create" data-editing="1">
      <label for="title">Title <span class="optional">optional</span></label>
      <input id="title" type="text" maxlength="80" list="title-list" placeholder="12U Softball · Spring 2026" value="${escapeHtml(poll.title || "")}" />
      <datalist id="title-list"></datalist>
      <div class="templates" id="title-chips"></div>
      <label id="question-label" for="question">Question</label>
      <input id="question" type="text" maxlength="200" required value="${escapeHtml(poll.question)}" />
      <label for="description">Optional note</label>
      <textarea id="description" maxlength="400">${escapeHtml(poll.description || "")}</textarea>
      <div id="choices-block" class="${poll.qa ? "hidden" : ""}">
      <label id="choices-label">Choices</label>
      <div class="choices" id="choices">${optionInputs(optionTexts.length ? optionTexts : ["", ""], optionIds)}</div>
      <div class="actions">
        <button class="btn quiet" id="add-choice" type="button">Add a choice</button>
      </div>
      </div>
      <div class="toggles">
        <label class="check"><input id="qa" type="checkbox" ${poll.qa ? "checked" : ""} /> <span>Q&amp;A board. People add questions, the team upvotes, popular ones rise</span></label>
        <label class="check"><input id="signup" type="checkbox" ${poll.signup ? "checked" : ""} /> <span>Sign-up sheet. One family per date/slot, and everyone can see what's taken</span></label>
        <label class="check" id="multi-row"><input id="multi" type="checkbox" ${poll.allowMultiple ? "checked" : ""} /> <span id="multi-label">Allow more than one answer</span></label>
        <label class="check" id="need-name-row"><input id="need-name" type="checkbox" ${poll.requireName ? "checked" : ""} /> <span>Ask for a name</span></label>
        <label class="check" id="show-results-row"><input id="show-results" type="checkbox" ${poll.showResults ? "checked" : ""} /> <span>Show results after they vote</span></label>
      </div>
      <div id="slot-limit-row" class="${poll.signup ? "" : "hidden"}">
        <label for="slot-limit">Spots per date</label>
        <input id="slot-limit" type="number" min="1" max="20" value="${escapeHtml(String(poll.slotLimit || 1))}" />
        <p class="meta">1 = first family to tap it gets it. 2 = two families can share that date.</p>
      </div>
      <label for="closes">Optional close time</label>
      <input id="closes" type="datetime-local" value="${escapeHtml(toLocalInput(poll.closesAt))}" />
      <div class="actions">
        <button class="btn primary wide" id="create-btn" type="submit">Save changes</button>
        <a class="btn quiet" href="/p/${poll.id}">Cancel</a>
      </div>
      <p id="err" class="error hidden"></p>
    </form>
  `;

  fillTitleChoices();
  wireSignupAndChoices({ editing: true });

  app.querySelector("#create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = app.querySelector("#err");
    const body = readPollForm();
    if (!body.qa && !confirmRemovedSlots(poll, body.options)) return;
    try {
      const saved = await api(`/api/polls/${id}/edit`, {
        method: "POST",
        body,
        manageKey: manageKeyFor(id),
      });
      rememberTitle(saved.title);
      rememberMyPoll(saved);
      toast("Saved.");
      history.pushState({}, "", `/p/${saved.id}`);
      renderPoll(saved.id);
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove("hidden");
    }
  });
}

function renderFromTemplate(id, label) {
  setLayout(false);
  setHeaderLabel(label);
  const tpl = document.getElementById(id);
  app.innerHTML = tpl ? tpl.innerHTML : "<h2>Page not found</h2>";
}

async function boot() {
  stopLive();
  voterId();
  try {
    const meta = await api("/api/meta");
    if (meta.team) document.getElementById("team-name").textContent = meta.team;
  } catch {
    document.getElementById("team-name").textContent = "Share a link";
  }
  const r = route();
  if (r.name === "poll") {
    setLayout(false);
    return renderPoll(r.id);
  }
  if (r.name === "edit") {
    setLayout(false);
    return renderEdit(r.id);
  }
  if (r.name === "create") return renderCreate();
  if (r.name === "mine") return renderMine();
  if (r.name === "about") return renderFromTemplate("page-about", "About");
  if (r.name === "privacy") return renderFromTemplate("page-privacy", "Privacy");
  if (r.name === "terms") return renderFromTemplate("page-terms", "Terms");
  if (r.name === "notfound") return renderFromTemplate("page-not-found", "Not found");
  renderLanding();
}

window.addEventListener("popstate", boot);
document.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link || link.target || link.href.startsWith("mailto:")) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  history.pushState({}, "", `${url.pathname}${url.search}`);
  boot();
});

boot();
