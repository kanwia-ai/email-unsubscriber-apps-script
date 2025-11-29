# AI Email Unsubscriber - Google Apps Script Design

## Overview

A Google Apps Script that automatically classifies promotional emails, unsubscribes from unwanted ones, and logs everything to a Google Sheet for learning and review.

## Architecture

**Components:**
- Google Apps Script (main script)
- Gmail (native `GmailApp` service)
- Google Sheets (native `SpreadsheetApp` service)
- Gemini API (via `UrlFetchApp`)

**Flow (runs daily at 9am):**
1. Fetch unread emails from Promotions category
2. Read Sheet for past corrections (learning)
3. For each email:
   - Extract sender, subject, snippet
   - Check whitelist (skip AI if match)
   - Call Gemini API for classification
   - If UNSUBSCRIBE: try mailto, then http, then log as manual
   - Archive the email
   - Log to Sheet with status
4. Send summary email with Sheet link

## Classification Logic

### Whitelist (instant KEEP, no AI call)
- Lenny's Newsletter
- AI with Allie
- Peter Yang
- The Listings Project
- Thrifty Traveler
- Snacks / Morning Brew
- Ideabrowser
- a16z Speedrun
- LinkedIn
- Harvard Black Alumni
- National Black MBA Association

### Topics to Keep
- AI and artificial intelligence
- Work and career
- Black communities and culture
- Entrepreneurship and startups

### Gemini Prompt Structure
```
You are an email classifier.

TOPICS TO KEEP: AI, work, career, Black communities,
culture, entrepreneurship, startups

PAST USER CORRECTIONS:
[dynamically inserted from Sheet, if any exist]

EMAIL:
From: {sender}
Subject: {subject}
Snippet: {first 200 chars}

Return JSON only:
{"decision":"KEEP or UNSUBSCRIBE","confidence":"high/medium/low","topic":"...","reason":"..."}
```

## Unsubscribe Logic

**Priority order:**
1. `mailto:` in List-Unsubscribe header → Send blank email
2. `http:` in List-Unsubscribe header → Fetch URL
3. Search email body for unsubscribe link → Fetch URL
4. None found → Mark as "Manual needed"

**Status values:**
- `Email sent` - Sent unsubscribe email via mailto
- `Link visited` - HTTP unsubscribe URL was fetched
- `Manual needed` - No automated method worked
- `Kept` - Email was kept (whitelist or AI decision)

## Google Sheet Structure

| Column | Description |
|--------|-------------|
| Date | When processed |
| From | Sender name/email |
| Subject | Email subject |
| AI Decision | KEEP or UNSUBSCRIBE |
| Confidence | high / medium / low |
| Topic | What AI detected |
| Reason | Why AI decided this |
| Unsubscribe Link | Extracted URL or mailto |
| Status | Email sent / Link visited / Manual needed / Kept |
| Your Correction | User fills this to teach the system |

**Sheet ID:** `1PgDENBnvvq_wGYMIHNFz-jnSfArn2UoSsS2-sR1d-YM`

## Summary Email

Sent after each run with:
- Count of emails processed
- List of unsubscribed emails with status
- List of kept emails with reason
- Direct link to Sheet for corrections

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Gemini API fails | Default to UNSUBSCRIBE, log "API error" in Reason |
| Unsubscribe URL times out | Mark as "Manual needed", continue |
| Empty inbox | Send summary: "No promotional emails today" |
| Sheet is empty | Skip learning section, use whitelist/topics only |
| Rate limits | Process in batches of 20, pause between |

## Limits

- Apps Script: 6 min execution time (sufficient for ~100 emails)
- Gemini free tier: 60 requests/minute
- Gmail: 100 emails/day sending limit (for mailto unsubscribes)

## Setup Requirements

1. Existing Google Sheet (already have)
2. Gemini API key (already have)
3. ~5 minutes to paste script and configure trigger

## Next Steps

1. Create the Apps Script in the Google Sheet
2. Implement core functions
3. Test with manual execution
4. Set up daily 9am trigger
