# AI Outreach Agent

An autonomous outreach agent that reads prospect data from a CSV, uses Claude to generate personalized email copy, and runs a 3-step drip sequence through Pigeons.

## What you'll learn

- Read and parse contact data from CSV with the stdlib `csv` module
- Batch-import contacts into Pigeons with tags and custom properties
- Call Claude (via the Anthropic SDK) to generate personalized email subjects and bodies
- Create a multi-step drip sequence with email and delay steps
- Activate a sequence and enroll contacts programmatically
- Poll sequence stats to monitor enrollment and delivery progress

## Prerequisites

- Python 3.10+
- A running Pigeons instance (local or Docker)
- A Pigeons API key with `contacts:write` and `sequences:write` scopes
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your credentials:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
ANTHROPIC_API_KEY=sk-ant-...
FROM_EMAIL=outreach@yourcompany.com
```

Optionally edit `contacts.csv` to add your own prospect list. The CSV must have columns: `email`, `name`, `company`, `role`.

## Run

```bash
python main.py
```

Expected output:

```
Step 1: Loading contacts from CSV

  Loaded 6 prospects from contacts.csv
    Alice Chen — Engineering Manager at Acme Corp
    Bob Patel — Head of DevOps at Streamline
    ...

Step 2: Importing contacts into Pigeons

  Created: 6
  Skipped: 0 (already existed)
  Total contacts ready: 6

Step 3: Generating personalized email copy with Claude

  Generating email copy for step 1/3 (initial outreach)...
    Subject: Quick question about Acme Corp's dev workflow
  Generating email copy for step 2/3 (follow-up)...
    Subject: One idea for your team
  Generating email copy for step 3/3 (final check-in)...
    Subject: Closing the loop

  Sequence created: seq_abc123
  Status: draft
  Steps:  5

Step 4: Activating sequence and enrolling contacts

  Sequence activated: active
    Enrolled alice@acmecorp.com -> enr_def456
    ...

  Total enrollments: 6

Step 5: Monitoring sequence progress

  [1/12] enrolled=6  active=6  completed=0  exited=0
  [2/12] enrolled=6  active=5  completed=0  exited=1
  ...

Done! Sequence seq_abc123 is running.
```

## Code walkthrough

### 1. Load prospects from CSV

The `load_prospects()` function reads the CSV using Python's built-in `csv.DictReader`. Each row becomes a `Prospect` dataclass with `email`, `name`, `company`, and `role` fields.

### 2. Batch-import contacts

`import_contacts()` calls `pigeons.contacts.batch()` with a list of contact payloads. Each contact gets:
- First and last name (split from the CSV `name` column)
- Tags: `outreach-agent` plus a company slug for segmentation
- Custom properties: `company` and `role` for personalization

The batch endpoint is atomic — all contacts are created or none are. Already-existing emails are skipped and counted in the `skipped` field.

### 3. Generate personalized email copy

`generate_email_copy()` calls the Anthropic API to generate a subject and HTML body tailored to each prospect's role and company. The prompt varies by sequence step:
- **Initial outreach** — curiosity-driven, references their specific role
- **Follow-up** — shares a concrete insight, suggests a specific time
- **Final check-in** — short, no-pressure, leaves the door open

### 4. Create a drip sequence

`create_drip_sequence()` calls `pigeons.sequences.create()` with five interleaved steps:

| Position | Type | Description |
|---|---|---|
| 0 | `email` | Initial outreach (day 0) |
| 1 | `delay` | Wait 3 days |
| 2 | `email` | Follow-up (day 3) |
| 3 | `delay` | Wait 4 days |
| 4 | `email` | Final check-in (day 7) |

The sequence starts in `draft` status. Steps are created atomically with the sequence.

### 5. Activate and enroll

`activate_and_enroll()` transitions the sequence from `draft` to `active`, then enrolls each contact individually. On enrollment, Pigeons schedules the first step for immediate processing.

### 6. Monitor progress

`monitor_progress()` polls `pigeons.sequences.get()` to display real-time stats. The stats object tracks `enrolled`, `active`, `completed`, and `exited` counts. Per-step stats show `sent`, `delivered`, `opened`, and `bounced` for each email step.

## Customization

**Use your own prospects** — Replace `contacts.csv` with your actual prospect list. The only required columns are `email`, `name`, `company`, and `role`.

**Change the LLM prompt** — Edit the `step_prompts` dict in `generate_email_copy()` to adjust tone, length, or messaging for each drip step.

**Use a different model** — Change the `model` parameter in `generate_email_copy()`. Any Claude model works (e.g. `claude-haiku-4-20250514` for faster/cheaper generation).

**Add more steps** — Add more `email` and `delay` entries to the `steps` list in `create_drip_sequence()`. You can also add `condition` steps to branch based on engagement.

**Use templates** — Instead of inline HTML, create Pigeons templates with merge variables (`{{firstName}}`, `{{company}}`) and reference them by `templateId` in each step. This lets Pigeons personalize per-contact at send time.

## Next steps

- [drip-sequence](../drip-sequence/) — Sequence creation in TypeScript with more step types
- [campaign-send](../campaign-send/) — Broadcast campaigns with audience segmentation
- [delivery-monitor](../delivery-monitor/) — Track domain warmup and bounce rates
- [mcp-claude-agent](../mcp-claude-agent/) — Let Claude manage emails through MCP tools
