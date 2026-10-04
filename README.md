# Dugout Polls

A simple poll site. Anyone can make a poll, copy a link, and send it. No login.

Live: **https://dugoutpolls.com**

## Use it

1. Open the site, pick a play (snacks, rainout, volunteers, Q&A), or tap **New poll**.
2. Copy the link and drop it in Messages, WhatsApp, or GameChanger. The preview card shows a dugout photo plus the actual question.
3. People vote on their phones. After they vote, they can create their own poll too.

**Sign-up sheets** (snacks, volunteer jobs): each date is a slot. Parents see **Open** or **Taken · Alex** before they pick, so two families don't grab the same Saturday. They can change or drop their spots from the same phone. Set spots-per-date to 2 if two families can share a game.

**Q&A boards** (like Slido): anyone with the link can add a question. The team upvotes. Popular questions rise, answered ones drop to the bottom. Good for parent meetings.

After you create a poll you get an **edit code** (like `k7m2-p9qx`). Save it. That code lets you edit from any phone or laptop, even after a reboot or a new browser. The share link is for voters; the code is for you. Tap **I made this poll** and enter the code if this device doesn't remember you.

Polls you create on this phone show up under **Your polls**. There is no site-wide admin board. To take a poll down from another phone, use the backup edit code, or email hello@dugoutpolls.com.

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
