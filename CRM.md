# The CRM

An AI-native CRM built into this backend, replacing GoHighLevel. Humans set
strategy in the dashboard; agents (and the built-in AI composer) do the heavy
lifting through the API.

**Dashboard:** `/crm` (same login as the content dashboard)
**Data:** shared Supabase project — migration `supabase/migrations/002_crm_core.sql`.

---

## Architecture

```
Site forms (www.yourdomain.com)          GHL webhooks / Zapier / agents
        │ /api/newsletter, /api/lead              │
        ▼ (server-side proxy)                     ▼
        POST backend /api/crm/capture  (x-capture-key)
                          │
                 upsert lead → log activity → fire triggers
                          │
                workflow_enrollments (next_run_at)
                          │
        POST /api/crm/tick  ← Cloudflare cron every 5 min (HMAC-signed),
                          │    admin "Run engine now", or any agent
                          ▼
        step executor: send_email · wait · add_tag · remove_tag ·
        set_status · move_stage · update_field · webhook · create_task
                          │
                  Resend (or SAFE MODE: simulated sends)
                          │
        POST /api/crm/webhooks/resend  ← opens/clicks/bounces/complaints
```

- **Safe mode** (default ON, `crm_safe_mode` setting): workflows run fully but
  emails are recorded as `simulated` in `email_sends` instead of sending.
- **Suppression:** any lead whose `email_status` ≠ `subscribed` is never
  emailed. Bounces/complaints (via Resend webhook) and unsubscribes (site
  `/unsubscribe?t=<token>`, List-Unsubscribe one-click) flip it automatically.
- **Send window** (`crm_send_window` setting): optionally hold workflow emails
  to business hours in a timezone.
- **Auto-pipeline** (default ON, `crm_auto_pipeline` setting): every real inbound
  lead opens an opportunity in the first stage (**New**) on capture, and the
  moment it enters an email sequence the deal advances to **Nurturing**
  (forward-only — never drags a later-stage deal back).
  `ensureLeadOpportunity()` in `engine.ts` is the single shared path
  (capture front door + enrollment engine).

## Tables (migration 002)

`leads` (extended: phone, company, custom jsonb, email_status,
unsubscribe_token, last_activity_at) · `lead_activities` (timeline) ·
`crm_custom_fields` · `crm_tags` · `pipelines` / `pipeline_stages` /
`opportunities` · `workflows` / `workflow_enrollments` · `email_templates` ·
`email_sends` (extended) / `email_events` · `crm_tasks` · `appointments`.
Settings live in `backend_settings` under `crm_*` keys.

## API (for agents)

Auth: `x-api-key` + HMAC headers (`x-timestamp`, `x-signature` over
`METHOD:pathname:timestamp:body` with `API_SECRET_KEY`) — same scheme as the
content API. **Sign the pathname only — never include the query string**
(`GET /api/crm/leads?q=x` signs `GET:/api/crm/leads:<ts>:`). The capture endpoint alternatively accepts the simpler
`x-capture-key` header (value = `crm_capture_key` setting) for webhook senders.

### Capture lifecycle and critical events

Application/request tags must be distinct from tags that prove payment or
activation. A safe generic model is:

- application: `offer-example-applied`, `offer-example-vip-requested`
- paid: `offer-example-paid`, `offer-example-vip`

Trigger confirmation or fulfillment on the dedicated `-paid` tag, never on a
generic interest/application tag. `upsertLead()` unions tags and only fires
`tag_added` for new tags, so replaying the same provider event will not
re-enroll a non-reenrolling workflow.

Payments, memberships and entitlement webhooks must not use a direct database
fallback when this endpoint is unavailable or rejects authentication. Return a
non-2xx response so the provider retries. The frontend starter implements this
with `captureLeadServerSide(payload, {allowFallback:false})`; see its
`CRM_CAPTURE.md`. Keep the provider event/session/payment ID and provider time
in `custom` so a replay produces stable state.

| Endpoint | What it does |
|---|---|
| `POST /api/crm/capture` | Trusted lead intake: upsert by email, activities, triggers. Body: `{email, name?, phone?, company?, source?, page?, form?, message?, tags?, interested_offers?, custom?, workflow_id?}`. `interested_offers` accepts UUIDs only. Honeypot: include a `website` field to get silently dropped. Public website forms must pass through the frontend `/api/leads` allowlist rather than exposing this trusted payload surface. |
| `GET/POST /api/crm/leads`, `GET/PATCH/DELETE /api/crm/leads/:id` | CRUD + search (`?q=&status=&tag=&page=`). PATCH diffs fire tag/status triggers. DELETE is the GDPR hard-delete. |
| `POST /api/crm/leads/:id/notes` · `POST /api/crm/leads/:id/enroll` | Timeline note · enroll into a workflow. |
| `POST /api/crm/leads/import` | Bulk upsert (≤500 rows/call). `fire_triggers` defaults FALSE so imports don't get welcome emails. |
| `GET/POST/PATCH/DELETE /api/crm/tags` · `/api/crm/fields` | Tag registry + custom field definitions. |
| `GET/POST/PATCH /api/crm/pipelines` · `POST/PATCH/DELETE /api/crm/pipelines/stages` | Pipelines + stages. |
| `GET/POST /api/crm/opportunities` · `PATCH/DELETE /api/crm/opportunities/:id` | Board data; PATCH moves stage (fires trigger) or sets won/lost (won → lead converted). |
| `GET/POST /api/crm/workflows` · `GET/PATCH/DELETE /api/crm/workflows/:id` | Workflow CRUD; PATCH `{status:"active"}` validates steps; DELETE archives + exits enrollees. |
| `POST /api/crm/workflows/:id/enroll` | Bulk enroll `{lead_ids:[…]}` or `{filter:{tag,status}}`. |
| `GET/POST /api/crm/templates` · `GET/PATCH/DELETE /api/crm/templates/:id` · `POST …/:id/test` | Email templates (markdown + merge tags); GET returns rendered preview; test send. |
| `POST /api/crm/ai/draft-sequence` | **The composer.** `{brief, num_emails?, offer_slug?, trigger_type?}` → Claude drafts the full sequence grounded in `brand_context` + `offers`, creates templates + a DRAFT workflow. `create:false` returns JSON only. |
| `POST /api/crm/ai/rewrite-email` | `{template_id?, subject?, body_md?, instruction}` → brand-voice revision (applies to template unless `apply:false`). |
| `GET/POST /api/crm/tasks` · `PATCH/DELETE /api/crm/tasks/:id` | Tasks for humans/agents. |
| `POST /api/crm/tick` | Run the engine over due enrollments. Idempotent. |
| `GET /api/crm/dashboard` | Overview counts + recent activity. |
| `POST /api/crm/webhooks/resend` | Resend event webhook (svix-verified via `RESEND_WEBHOOK_SECRET`). |
| `POST /api/crm/funnel/ingest` | Funnel analytics intake (batched events → `funnel_events`). Auth: `x-funnel-secret` header = `crm_funnel_secret` setting. Body: `{funnel?, events:[{session_id, event_type, event_data?, page_url?, referrer?}]}`. |
| `GET /api/crm/funnel` | Drop-off stats (`?funnel=my-funnel&days=30`, `days=0` = all time): distinct sessions per step, opt-ins, CTA clicks, daily volume. |

### Workflow steps (JSON on `workflows.steps`)

```json
[
  {"id":"w1","type":"wait","config":{"days":2,"hours":0,"minutes":0}},
  {"id":"e1","type":"send_email","config":{"template_id":"<uuid>"}},
  {"id":"e2","type":"send_email","config":{"subject":"…","body_md":"…"}},
  {"id":"t1","type":"add_tag","config":{"tag":"nurtured"}},
  {"id":"s1","type":"set_status","config":{"status":"engaged"}},
  {"id":"m1","type":"move_stage","config":{"stage_id":"<uuid>"}},
  {"id":"f1","type":"update_field","config":{"key":"custom.warmth","value":"hot"}},
  {"id":"h1","type":"webhook","config":{"url":"https://…"}},
  {"id":"k1","type":"create_task","config":{"title":"Call {{first_name}}","due_in_days":1}}
]
```

Triggers (`trigger_type` + `trigger_config`): `manual`,
`lead_created {source?}`, `form_submitted {form?}`, `tag_added {tag?}`,
`status_changed {status?}`, `stage_changed {stage_id?}` — blank config matches any.

Merge tags in subjects/bodies: `{{first_name|there}}`, `{{last_name}}`,
`{{full_name}}`, `{{email}}`, `{{phone}}`, `{{company}}`, `{{custom.<key>}}`,
`{{unsubscribe_url}}`. A markdown paragraph containing only a link renders as a
button. Unsubscribe footer is appended automatically — don't write your own.

## Funnel analytics (any funnel → /crm/funnel)

Any funnel site can stream anonymous funnel events into the CRM: the funnel
client beacons to its own `/api/track`, which forwards server-to-server to
`POST /api/crm/funnel/ingest` with `x-funnel-secret`. Events (`start`, `view`
per screen, `complete` = opt-in, `cta_click`) are deduped client-side per
session, so distinct sessions per `screen_index` = the drop-off table shown at
**`/crm/funnel`**. Leads captured at the funnel's email gate can carry
`custom.funnel_session_id`, tying each CRM lead to its `funnel_events` session.

### Wiring a funnel

1. **Seed the ingest secret** (any random hex; keeps existing if already set):
   ```sql
   insert into backend_settings (key, value)
   values ('crm_funnel_secret', to_jsonb('<openssl rand -hex 24>'::text))
   on conflict (key) do nothing;
   ```
2. **Deploy this worker:** `npm run deploy`.
3. **Funnel worker secrets:** give your funnel the same secret
   (`FUNNEL_ANALYTICS_SECRET` = the `crm_funnel_secret` value) and a capture
   key (`CRM_CAPTURE_KEY` = the `crm_capture_key` setting).
4. **Smoke:** open the funnel in a fresh tab → a `start` row lands in
   `funnel_events` and `/crm/funnel` shows the session; submit the email gate
   with a test address → the lead appears in `/crm/leads` with the funnel's
   form tag and answers under custom fields.

## Go-live checklist

1. **Migration:** run `supabase/migrations/002_crm_core.sql` against the
   Supabase project.
2. **Deploy both workers** (`npm run deploy` here; OpenNext build+deploy in the
   frontend repo).
3. **Site worker secret:** `wrangler secret put CRM_CAPTURE_KEY --name <your-frontend-worker>`
   (value = `crm_capture_key` in backend_settings / site `.env.local`).
4. **Scheduler:** the Cloudflare cron in `wrangler.jsonc` runs the tick every
   5 minutes once this worker is deployed (needs the `API_SECRET_KEY` secret).
5. **Real sending (when ready):**
   - Create a Resend account, verify your sending domain (SPF + DKIM records),
     then `wrangler secret put RESEND_API_KEY --name digital-home-backend`.
   - Add the Resend webhook → `https://<backend>/api/crm/webhooks/resend`,
     then `wrangler secret put RESEND_WEBHOOK_SECRET --name digital-home-backend`.
   - Flip off safe mode in `/crm/settings` once a test send looks right.
6. **GHL migration:** export contacts → CSV import at `/crm/leads`
   (leave "fire triggers" OFF). During transition, point a GHL workflow
   webhook at `POST /api/crm/capture` with header `x-capture-key` so new GHL
   leads mirror into the CRM. Appointments booked in the GHL calendar can be
   posted to the capture endpoint too (they land on the lead timeline).

## Conventions for this repo

- Engine code: `src/lib/crm/*` (pure logic is import-safe outside Next).
- New tables must be added to `src/types/database.ts` **in both repos** (keep
  byte-identical) or Cloudflare builds fail.
- AI calls follow the house pattern (`claude-sonnet-4-6`, `ANTHROPIC_API_KEY`),
  log to `agent_logs` as `email_agent`.
