# Dugout Polls

A simple poll site for a Little League team. You make a poll, copy a link, and parents vote on their phones.

Made for Mill Creek Little League parent chats: snacks, practice times, rain makeups, picnic RSVPs.

## Run it

Needs Node 22+.

```bash
cd dugout-polls
node server.js
```

Open [http://localhost:3456](http://localhost:3456).

Coach PIN is `dugout` unless you change it.

## Text a live link to parents

Keep this computer awake, then:

```bash
npm run share
```

That prints a public `https://….trycloudflare.com` URL. Paste that in the team chat. When you stop the app, the public link stops working.

## Settings

Copy `.env.example` to `.env` if you want, or export:

```bash
PORT=3456
COACH_PIN=dugout
TEAM_NAME="Mill Creek Little League"
```

`TEAM_NAME` is the label under the Dugout logo. `COACH_PIN` is required to create polls and open the coach board. Parents never see it — they only open the share link.

## What it does

- Create a poll (or tap a template)
- Copy / share a unique link like `/p/abc12xy`
- Parents pick a choice, optionally leave a name
- Results show right after they vote
- Coach board lists every poll, who voted (if names were asked), and lets you close or delete

Votes are stored in `data/dugout.db` on this machine. One vote per browser.

## Deploy for a permanent team URL

GitHub Pages cannot store votes, so this needs a tiny always-on server.

Easiest path: create a [Render](https://render.com) Web Service from this repo.

- Build command: leave empty
- Start command: `node server.js`
- Add env vars `COACH_PIN` and `TEAM_NAME`
- Add a persistent disk mounted at `/opt/render/project/src/data` so polls survive restarts

Then your share links look like `https://your-app.onrender.com/p/….`
