# AI Email Unsubscriber

A Google Apps Script that automatically classifies promotional emails using Gemini AI, unsubscribes from unwanted ones, and logs everything to Google Sheets.

## Features

- **AI-powered classification** using Google Gemini 2.5 Flash
- **Whitelist support** for senders you always want to keep
- **Topic-based filtering** - customize topics you want to keep
- **Auto-unsubscribe** via mailto or HTTP links
- **Learning from corrections** - improves over time based on your feedback
- **Daily summary email** with processing results
- **Gmail link fallback** when manual unsubscribe is needed

## Setup

1. Open your Google Sheet
2. Go to **Extensions > Apps Script**
3. Paste the contents of `email-unsubscriber.gs`
4. Update the CONFIG section:
   - `GEMINI_API_KEY`: Your Gemini API key
   - `SHEET_ID`: Your Google Sheet ID
   - `SUMMARY_EMAIL`: Your email address
5. Run `setupSheet` to create headers
6. Run `testOne` to test on a single email
7. Run `setupTrigger` to enable daily 9am runs

## How It Works

1. Fetches unread emails from Gmail's Promotions category
2. Checks sender against whitelist (instant KEEP if matched)
3. Calls Gemini API for AI classification
4. For UNSUBSCRIBE decisions:
   - Tries mailto unsubscribe (sends email)
   - Tries HTTP unsubscribe (visits link)
   - Falls back to Gmail link for manual action
5. Archives processed emails
6. Logs everything to Google Sheet
7. Sends summary email

## Sheet Columns

| Column | Description |
|--------|-------------|
| Date | Processing date |
| From | Sender |
| Subject | Email subject |
| AI Decision | KEEP or UNSUBSCRIBE |
| Confidence | high/medium/low |
| Topic | Detected topic |
| Reason | AI's explanation |
| Unsubscribe Link | Link used or Gmail link for manual |
| Status | Email sent/Link visited/Manual needed/Kept |
| Your Correction | Fill this to teach the AI |

## Customization

Edit the CONFIG section to customize:

- **WHITELIST** - Senders that are always kept (partial match, case-insensitive)
- **TOPICS_TO_KEEP** - Topics the AI should keep
- **MAX_EMAILS** - How many emails to process per run

## Rate Limits

- Gemini 2.5 Flash free tier: 10 requests/minute
- Script includes 7-second delay between emails to stay under limit
- 50 emails takes ~6 minutes to process

## Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Click "Get API Key"
3. Create a new API key
4. Copy it into the CONFIG section

## License

MIT
