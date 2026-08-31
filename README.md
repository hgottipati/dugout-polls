# Dugout Polls

A simple poll site. You make a poll, copy a link, and people vote on their phones.

Live: **https://dugout-polls.hg-datahive.workers.dev**

Coach PIN is `dugout`.

## Use it

1. Open the site and enter the coach PIN.
2. Create a poll (or tap a template: snacks, practice time, rain makeup, picnic, volunteers).
3. Copy the link and drop it in the team chat.
4. Parents vote on their phones. Results show right after.

The coach board at `/coach` lists every poll, vote counts, and names if you asked for them.

When you create a poll, check **Show results to parents after they vote** if they should see the scoreboard. Uncheck it to keep the tally coach-only. You can flip that later on the coach board.

## Deploy (Cloudflare, free)

This is a Cloudflare Worker + D1 database. Free plan is plenty for a team chat.

```bash
npm install
npx wrangler d1 migrations apply dugout-polls --remote
npx wrangler deploy
```

Local:

```bash
npx wrangler d1 migrations apply dugout-polls --local
npm start
```

Change the PIN in `wrangler.jsonc` under `vars`, then deploy again.
