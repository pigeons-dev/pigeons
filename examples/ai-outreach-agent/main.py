"""
AI Outreach Agent  - Pigeons Example

An autonomous outreach agent that:
  1. Reads prospect contacts from a CSV file
  2. Batch-imports them into Pigeons as tagged contacts
  3. Uses Claude to generate personalized email copy for each contact
  4. Creates a 3-step drip sequence (initial → follow-up → final check-in)
  5. Activates the sequence and enrolls every contact
  6. Polls sequence stats to show enrollment progress

Run: python main.py
"""

from __future__ import annotations

import csv
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from pigeons import Pigeons, PigeonsError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Load environment variables from .env file (if present).
# This reads PIGEONS_URL, PIGEONS_API_KEY, ANTHROPIC_API_KEY, and FROM_EMAIL.
load_dotenv()

FROM_EMAIL: str = os.environ.get("FROM_EMAIL", "outreach@yourcompany.com")
CSV_PATH: Path = Path(__file__).parent / "contacts.csv"

# How many seconds to wait between stats polls
POLL_INTERVAL: int = 5
# How many times to poll before giving up
MAX_POLLS: int = 12


# ---------------------------------------------------------------------------
# Data model for a prospect loaded from CSV
# ---------------------------------------------------------------------------


@dataclass
class Prospect:
    """A single prospect row from the CSV file."""

    email: str
    name: str
    company: str
    role: str

    @property
    def first_name(self) -> str:
        """Extract the first name for greetings."""
        return self.name.split()[0] if self.name else ""

    @property
    def last_name(self) -> str:
        """Extract the last name for the contact record."""
        parts = self.name.split(maxsplit=1)
        return parts[1] if len(parts) > 1 else ""


# ---------------------------------------------------------------------------
# Step 1: Read contacts from CSV
# ---------------------------------------------------------------------------


def load_prospects(path: Path) -> list[Prospect]:
    """
    Parse the CSV file and return a list of Prospect objects.

    The CSV must have columns: email, name, company, role.
    Uses the stdlib csv module  - no pandas dependency needed.
    """
    prospects: list[Prospect] = []

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            prospects.append(
                Prospect(
                    email=row["email"].strip(),
                    name=row["name"].strip(),
                    company=row["company"].strip(),
                    role=row["role"].strip(),
                )
            )

    return prospects


# ---------------------------------------------------------------------------
# Step 2: Batch-create contacts in Pigeons
# ---------------------------------------------------------------------------


def import_contacts(
    pigeons: Pigeons, prospects: list[Prospect]
) -> dict[str, str]:
    """
    Batch-import all prospects as Pigeons contacts.

    Each contact is tagged "outreach-agent" so you can segment them later.
    Custom properties store the company and role for template personalization.

    Returns a mapping of email → contact ID for enrollment later.
    """
    # Build the batch payload. The Pigeons batch endpoint accepts a list of
    # CreateContactParams dicts and returns { created, skipped, contacts }.
    contact_payloads: list[dict] = [
        {
            "email": p.email,
            "firstName": p.first_name,
            "lastName": p.last_name,
            "tags": ["outreach-agent", p.company.lower().replace(" ", "-")],
            "properties": {
                "company": p.company,
                "role": p.role,
            },
        }
        for p in prospects
    ]

    result = pigeons.contacts.batch(contact_payloads)

    print(f"  Created: {result['created']}")
    print(f"  Skipped: {result['skipped']} (already existed)")

    # Build the email → ID lookup from the batch response
    return {c["email"]: c["id"] for c in result["contacts"]}


# ---------------------------------------------------------------------------
# Step 3: Generate personalized email copy with Claude
# ---------------------------------------------------------------------------


def generate_email_copy(
    client: anthropic.Anthropic, prospect: Prospect, step: str
) -> dict[str, str]:
    """
    Call Claude to generate a personalized subject line and HTML body.

    Args:
        client: Anthropic SDK client.
        prospect: The prospect to personalize for.
        step: One of "initial", "follow-up", or "final"  - controls the tone.

    Returns:
        A dict with "subject" and "html" keys.
    """
    # Define the tone and goal for each step in the drip sequence.
    step_prompts: dict[str, str] = {
        "initial": (
            "Write the initial outreach email. Be genuinely curious about their "
            "work. Mention something specific about their role and company. "
            "Keep it under 150 words. End with a soft ask  - would they be open "
            "to a 15-minute chat?"
        ),
        "follow-up": (
            "Write a follow-up to someone who hasn't replied to the initial "
            "outreach. Reference the previous email briefly. Share one concrete "
            "insight or value proposition relevant to their role. Keep it under "
            "100 words. End with a specific time suggestion."
        ),
        "final": (
            "Write a final check-in email. Keep it very short  - under 60 words. "
            "Acknowledge that they're busy. Leave the door open without pressure. "
            "Sign off warmly."
        ),
    }

    prompt = f"""You are writing a professional outreach email.

Recipient details:
- Name: {prospect.name}
- Role: {prospect.role}
- Company: {prospect.company}

{step_prompts[step]}

Your product is a developer tool that helps engineering teams ship faster.

Respond with EXACTLY this format (no markdown fences, no extra text):
SUBJECT: <the subject line>
BODY:
<the HTML email body  - use <p> tags for paragraphs>"""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    # Parse the structured response into subject and body.
    text: str = message.content[0].text
    lines = text.strip().split("\n")

    subject = ""
    body_lines: list[str] = []
    in_body = False

    for line in lines:
        if line.startswith("SUBJECT:"):
            subject = line.replace("SUBJECT:", "").strip()
        elif line.startswith("BODY:"):
            in_body = True
        elif in_body:
            body_lines.append(line)

    html_body = "\n".join(body_lines).strip()

    return {"subject": subject, "html": html_body}


# ---------------------------------------------------------------------------
# Step 4: Create a 3-step drip sequence
# ---------------------------------------------------------------------------


def create_drip_sequence(
    pigeons: Pigeons,
    client: anthropic.Anthropic,
    prospects: list[Prospect],
) -> str:
    """
    Build a 3-step drip sequence with LLM-personalized email content.

    Sequence structure:
      Step 0 (email)   - Initial outreach, sent immediately on enrollment
      Step 1 (delay)   - Wait 3 days
      Step 2 (email)   - Follow-up with a value proposition
      Step 3 (delay)   - Wait 4 more days (day 7 total)
      Step 4 (email)   - Final check-in

    We generate the email copy using the first prospect as a representative
    sample. In production you'd use Pigeons templates with merge variables
    so each enrolled contact gets their own personalized version.

    Returns the sequence ID.
    """
    # Use the first prospect as the representative for LLM generation.
    # In a real deployment, you'd create templates with {{firstName}},
    # {{company}}, etc. and let the sequence engine personalize per contact.
    sample = prospects[0]

    print(f"\n  Generating email copy for step 1/3 (initial outreach)...")
    initial = generate_email_copy(client, sample, "initial")
    print(f"    Subject: {initial['subject']}")

    print(f"  Generating email copy for step 2/3 (follow-up)...")
    followup = generate_email_copy(client, sample, "follow-up")
    print(f"    Subject: {followup['subject']}")

    print(f"  Generating email copy for step 3/3 (final check-in)...")
    final = generate_email_copy(client, sample, "final")
    print(f"    Subject: {final['subject']}")

    # Build the sequence with interleaved email and delay steps.
    # The Pigeons sequence API accepts all steps in a single create call.
    # Step types:
    #   "email"   - sends an email to the enrolled contact
    #   "delay"   - pauses the sequence for the specified duration
    #   "condition"  - branches based on engagement (not used here)
    sequence = pigeons.sequences.create({
        "name": "AI Outreach  - Drip Sequence",
        "steps": [
            # Day 0: Initial outreach
            {
                "type": "email",
                "subject": initial["subject"],
                "templateData": {
                    "html": initial["html"],
                    "from": FROM_EMAIL,
                },
            },
            # Wait 3 days before the follow-up
            {
                "type": "delay",
                "delayDuration": "3d",
            },
            # Day 3: Follow-up with value proposition
            {
                "type": "email",
                "subject": followup["subject"],
                "templateData": {
                    "html": followup["html"],
                    "from": FROM_EMAIL,
                },
            },
            # Wait 4 more days (day 7 total)
            {
                "type": "delay",
                "delayDuration": "4d",
            },
            # Day 7: Final check-in
            {
                "type": "email",
                "subject": final["subject"],
                "templateData": {
                    "html": final["html"],
                    "from": FROM_EMAIL,
                },
            },
        ],
    })

    print(f"\n  Sequence created: {sequence['id']}")
    print(f"  Status: {sequence['status']}")
    print(f"  Steps:  {len(sequence.get('steps', []))}")

    return sequence["id"]


# ---------------------------------------------------------------------------
# Step 5: Activate and enroll contacts
# ---------------------------------------------------------------------------


def activate_and_enroll(
    pigeons: Pigeons,
    sequence_id: str,
    contact_ids: dict[str, str],
) -> list[dict]:
    """
    Activate the sequence and enroll every imported contact.

    A sequence must be activated before contacts can be enrolled. Once
    active, each enrolled contact starts at step 0 and progresses through
    the delay/email steps automatically.

    Returns a list of enrollment objects.
    """
    # Activate the sequence  - transitions from "draft" to "active".
    # This validates that the sequence has at least one step.
    activated = pigeons.sequences.activate(sequence_id)
    print(f"  Sequence activated: {activated['status']}")

    # Enroll each contact individually. The enroll endpoint creates an
    # enrollment record and schedules the first step for processing.
    enrollments: list[dict] = []
    for email, contact_id in contact_ids.items():
        enrollment = pigeons.sequences.enroll(sequence_id, contact_id)
        enrollments.append(enrollment)
        print(f"    Enrolled {email} -> {enrollment['id']}")

    return enrollments


# ---------------------------------------------------------------------------
# Step 6: Poll sequence stats
# ---------------------------------------------------------------------------


def monitor_progress(pigeons: Pigeons, sequence_id: str) -> None:
    """
    Poll the sequence stats to show enrollment progress.

    The sequence stats object tracks:
      - enrolled:  total contacts ever enrolled
      - active:    currently progressing through steps
      - completed: finished all steps
      - exited:    removed or bounced before completing

    In production you'd use webhooks instead of polling. This loop is
    just for demonstration purposes.
    """
    for i in range(MAX_POLLS):
        sequence = pigeons.sequences.get(sequence_id)
        stats = sequence["stats"]

        print(
            f"  [{i + 1}/{MAX_POLLS}] "
            f"enrolled={stats['enrolled']}  "
            f"active={stats['active']}  "
            f"completed={stats['completed']}  "
            f"exited={stats['exited']}"
        )

        # If no contacts are still active, the sequence has settled
        if stats["enrolled"] > 0 and stats["active"] == 0:
            print("  All enrollments settled.")
            break

        time.sleep(POLL_INTERVAL)
    else:
        print(
            f"  Still processing after {MAX_POLLS * POLL_INTERVAL}s  - "
            "check the Pigeons API for final status."
        )

    # Show per-step delivery stats if available
    if sequence.get("steps"):
        print("\n  Per-step stats:")
        for step in sequence["steps"]:
            if step["type"] == "email":
                s = step["stats"]
                print(
                    f"    Step {step['position']} ({step['type']}): "
                    f"sent={s['sent']}  delivered={s['delivered']}  "
                    f"opened={s['opened']}  bounced={s['bounced']}"
                )
            else:
                print(
                    f"    Step {step['position']} ({step['type']}): "
                    f"delay={step.get('delayDuration', 'n/a')}"
                )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the full outreach pipeline."""

    # Validate that required environment variables are set
    missing: list[str] = []
    for var in ("PIGEONS_URL", "PIGEONS_API_KEY", "ANTHROPIC_API_KEY"):
        if not os.environ.get(var):
            missing.append(var)
    if missing:
        print(f"Error: missing environment variables: {', '.join(missing)}")
        print("Copy .env.example to .env and fill in your values.")
        sys.exit(1)

    # Initialize clients.
    # The Pigeons client reads PIGEONS_URL and PIGEONS_API_KEY from env.
    # The Anthropic client reads ANTHROPIC_API_KEY from env.
    pigeons = Pigeons()
    claude = anthropic.Anthropic()

    # ── Step 1: Load prospects from CSV ────────────────────────────────────
    print("Step 1: Loading contacts from CSV\n")

    prospects = load_prospects(CSV_PATH)
    print(f"  Loaded {len(prospects)} prospects from {CSV_PATH.name}")
    for p in prospects:
        print(f"    {p.name}  - {p.role} at {p.company}")

    # ── Step 2: Batch-import contacts ──────────────────────────────────────
    print("\nStep 2: Importing contacts into Pigeons\n")

    try:
        contact_ids = import_contacts(pigeons, prospects)
    except PigeonsError as exc:
        print(f"  Error importing contacts: {exc}")
        sys.exit(1)

    print(f"  Total contacts ready: {len(contact_ids)}")

    # ── Step 3: Generate personalized emails with Claude ───────────────────
    print("\nStep 3: Generating personalized email copy with Claude")

    try:
        sequence_id = create_drip_sequence(pigeons, claude, prospects)
    except anthropic.APIError as exc:
        print(f"  Error calling Claude API: {exc}")
        sys.exit(1)
    except PigeonsError as exc:
        print(f"  Error creating sequence: {exc}")
        sys.exit(1)

    # ── Step 4: Activate sequence and enroll contacts ──────────────────────
    print("\nStep 4: Activating sequence and enrolling contacts\n")

    try:
        enrollments = activate_and_enroll(pigeons, sequence_id, contact_ids)
    except PigeonsError as exc:
        print(f"  Error during enrollment: {exc}")
        sys.exit(1)

    print(f"\n  Total enrollments: {len(enrollments)}")

    # ── Step 5: Monitor delivery progress ──────────────────────────────────
    print("\nStep 5: Monitoring sequence progress\n")

    monitor_progress(pigeons, sequence_id)

    # ── Done ───────────────────────────────────────────────────────────────
    print(f"\nDone! Sequence {sequence_id} is running.")
    print("Contacts will receive emails on day 0, day 3, and day 7.")
    print(f"View sequence: GET {os.environ['PIGEONS_URL']}/v1/sequences/{sequence_id}")


if __name__ == "__main__":
    main()
