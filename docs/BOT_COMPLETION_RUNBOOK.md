# Bot Completion Runbook

This runbook covers the live steps that remain after the code-complete bot pass. It does not require Suite to package Relay as a desktop app. Relay is a Cloudflare Worker service, and Console is the local operator UI.

## Current Boundary

- Console owns local operator controls, guarded live actions, Discord server setup, announcements, suggestions review, Twitch creator ops, and local secrets.
- Relay owns public webhooks, Twitch app-token chatbot identity, Twitch EventSub chat intake, Discord interaction verification, Discord slash command registration, and queue APIs.
- Suite tracks Relay as a service repo for clone/check purposes only.

## Live Deployment Checkpoint

As of 2026-05-10:

- Relay deploy path is the existing `relay/` Worker project, not a new app.
- Production Worker custom domain is `https://relay.vaexil.tv`.
- Production D1 database is `vaexcore-relay`.
- `wrangler.jsonc` is configured with `PUBLIC_BASE_URL=https://relay.vaexil.tv`, `TWITCH_REDIRECT_URI=https://relay.vaexil.tv/oauth/twitch/callback`, D1 binding `DB`, and `workers_dev=false`.
- The first production Worker deployment and D1 migrations have been applied.
- Console has been paired to Relay locally.
- Twitch/client relay base secrets are set in Cloudflare Worker secrets.
- Discord Worker secrets are still pending: `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, plus `DISCORD_GUILD_ID` for the live server.

Do not create a second Relay service. Continue live integration from this deployed Worker and D1 database.

## Relay Deployment

1. Clone or update services:

   ```bash
   ./scripts/clone-or-update-apps.sh --include-services
   ```

2. In `relay/`, install and validate:

   ```bash
   npm install
   npm run ci
   ```

3. Create the Cloudflare D1 database for Relay.
4. Replace the placeholder D1 `database_id` in `relay/wrangler.jsonc`.
5. Apply D1 migrations:

   ```bash
   npx wrangler d1 migrations apply vaexcore-relay --remote
   ```

6. Set required Worker secrets:

   ```bash
   npx wrangler secret put TWITCH_CLIENT_ID
   npx wrangler secret put TWITCH_CLIENT_SECRET
   npx wrangler secret put TWITCH_EVENTSUB_SECRET
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   npx wrangler secret put RELAY_ADMIN_TOKEN
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_APPLICATION_ID
   ```

7. Set Discord target vars or secrets for the live server:

   ```bash
   npx wrangler secret put DISCORD_GUILD_ID
   npx wrangler secret put DISCORD_OPERATOR_ROLE_ID
   ```

8. Deploy Relay:

   ```bash
   npm run deploy
   ```

## Console Pairing

1. Pair Console with Relay using the Relay admin token:

   ```bash
   curl -X POST "$RELAY_URL/api/console/pair" \
     -H "Authorization: Bearer $RELAY_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"VaexCore Console"}'
   ```

2. Copy the returned installation ID and console token into Console `Settings`.
3. Select `relay-chatbot` in `Twitch Chat Transport`.
4. Save settings.

## Twitch Chat Bot Validation

1. Open the returned `botOAuthUrl` while logged into the `vaexcorebot` Twitch account.
2. Approve `user:bot`, `user:read:chat`, and `user:write:chat`.
3. Open the returned `broadcasterOAuthUrl` while logged into the broadcaster account.
4. Approve `channel:bot`.
5. In Console, start Relay chatbot mode and register EventSub.
6. Send a test chat message through Console.
7. Confirm Twitch shows `vaexcorebot` as a Chat Bot in the channel user list.
8. In Console, click `Mark Chat Bot identity live-tested`.

## Discord Slash Commands

1. In Discord Developer Portal, configure the Interactions Endpoint URL:

   ```text
   https://<relay-worker-host>/webhooks/discord/interactions
   ```

2. In Console `Discord`, click `Check Relay`.
3. Click `Register slash commands`.
4. In Discord, verify these commands exist:

   ```text
   /suggest
   /live
   /late
   /cancelled
   /scheduled
   /setup-status
   ```

5. Run `/suggest text: <message>` as a normal viewer.
6. In Console, click `Load suggestions` and confirm the suggestion appears.
7. Mark the suggestion reviewed, accepted, rejected, or archived.
8. Run `/live`, `/late`, `/cancelled`, and `/scheduled` from an allowed operator role or a user with Manage Server permission.
9. Confirm those commands queue for Console review and do not directly post public announcements.

## Local Validation Commands

Run these before live credential validation:

```bash
(cd relay && npm run ci)
(cd console && npm run lint)
(cd console && npm run check:scopes)
(cd console && npm run typecheck)
(cd console && npm run build)
(cd console && npm run smoke:ci)
node scripts/validate-suite-config.mjs --require-local-repos
node scripts/check-suite-repos.mjs
node scripts/check-suite-services.mjs
node scripts/check-automation-boundary.mjs
node scripts/generate-suite-protocol.mjs --check
node scripts/smoke-suite-contracts.mjs
```

For the code-only pre-credential gate, run the suite aggregator:

```bash
node scripts/check-bot-readiness.mjs
```

It runs Console bot readiness, Relay CI, suite repo/service/config checks, writes `.local/bot-readiness-report.json`, and reports credential/live TODOs without requiring Twitch, Discord, Cloudflare, D1, or DNS mutations.

## Completion Criteria

- Relay deploys with current D1 migrations applied.
- Console pairs with Relay and reports Twitch and Discord readiness.
- Twitch lists `vaexcorebot` as a Chat Bot after live test send.
- Relay receives Twitch EventSub chat events.
- Relay sends Twitch chat through app-token authorization.
- Discord accepts the Relay interaction endpoint.
- Discord slash commands register in the target server.
- `/suggest` queues suggestions visible in Console.
- Announcement slash commands remain guarded and operator-reviewed.
- No secrets appear in Console responses, Relay diagnostics, smoke logs, or docs.
