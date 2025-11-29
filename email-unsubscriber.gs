/**
 * AI Email Unsubscriber
 *
 * Automatically classifies promotional emails, unsubscribes from unwanted ones,
 * and logs everything to Google Sheets for learning and review.
 *
 * SETUP:
 * 1. Open your Google Sheet
 * 2. Go to Extensions → Apps Script
 * 3. Paste this entire code
 * 4. Update CONFIG section below with your values
 * 5. Run setupTrigger() once to schedule daily execution
 * 6. Run main() manually to test
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

const CONFIG = {
  // Your Gemini API key
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY_HERE',

  // Your Google Sheet ID (from the URL)
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',

  // Sheet tab name
  SHEET_NAME: 'Sheet1',

  // Your email for summary
  SUMMARY_EMAIL: 'YOUR_EMAIL@gmail.com',

  // Max emails to process per run (stay within limits)
  MAX_EMAILS: 50,

  // Whitelisted senders (always KEEP, no AI call)
  // Add partial matches - e.g., 'morning brew' matches 'Morning Brew <news@morningbrew.com>'
  WHITELIST: [
    'example newsletter',
    'important sender',
    'linkedin'
    // Add your whitelisted senders here
  ],

  // Topics to keep - emails matching these topics will be kept
  TOPICS_TO_KEEP: [
    'AI',
    'artificial intelligence',
    'work',
    'career',
    'entrepreneurship',
    'startups'
    // Add your topics here
  ]
};

// ============================================================================
// MAIN FUNCTION - Entry point
// ============================================================================

function main() {
  console.log('Starting email unsubscriber...');

  // Get promotional emails
  const emails = getPromotionalEmails();
  console.log(`Found ${emails.length} promotional emails`);

  if (emails.length === 0) {
    sendSummaryEmail([], []);
    return;
  }

  // Get past corrections for learning
  const corrections = getPastCorrections();
  console.log(`Loaded ${corrections.length} past corrections for learning`);

  // Process each email
  const kept = [];
  const unsubscribed = [];

  for (const email of emails) {
    try {
      const result = processEmail(email, corrections);

      if (result.decision === 'KEEP') {
        kept.push(result);
      } else {
        unsubscribed.push(result);
      }

      // Log to sheet
      logToSheet(result);

      // Delay to stay under Gemini free tier rate limit (10 req/min)
      Utilities.sleep(7000);

    } catch (error) {
      console.error(`Error processing email: ${error.message}`);
    }
  }

  // Send summary email
  sendSummaryEmail(kept, unsubscribed);

  console.log(`Done! Kept: ${kept.length}, Unsubscribed: ${unsubscribed.length}`);
}

// ============================================================================
// EMAIL FETCHING
// ============================================================================

function getPromotionalEmails() {
  const emails = [];

  // Search for unread promotional emails
  const threads = GmailApp.search('category:promotions is:unread', 0, CONFIG.MAX_EMAILS);

  for (const thread of threads) {
    const messages = thread.getMessages();
    const message = messages[messages.length - 1]; // Get latest message in thread

    emails.push({
      id: message.getId(),
      threadId: thread.getId(),
      from: message.getFrom(),
      subject: message.getSubject(),
      snippet: message.getPlainBody().substring(0, 500),
      date: message.getDate(),
      message: message,
      thread: thread
    });
  }

  return emails;
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

function processEmail(email, corrections) {
  const result = {
    date: new Date().toISOString().split('T')[0],
    from: email.from,
    subject: email.subject,
    decision: null,
    confidence: null,
    topic: null,
    reason: null,
    unsubscribeLink: null,
    status: null
  };

  // Extract unsubscribe link first (we log it regardless of decision)
  result.unsubscribeLink = extractUnsubscribeLink(email.message);

  // Check whitelist first
  const fromLower = email.from.toLowerCase();
  for (const whitelisted of CONFIG.WHITELIST) {
    if (fromLower.includes(whitelisted.toLowerCase())) {
      result.decision = 'KEEP';
      result.confidence = 'high';
      result.topic = 'whitelist';
      result.reason = `Sender matches whitelist: ${whitelisted}`;
      result.status = 'Kept';
      return result;
    }
  }

  // Call Gemini for classification
  const aiResult = classifyWithGemini(email, corrections);
  result.decision = aiResult.decision;
  result.confidence = aiResult.confidence;
  result.topic = aiResult.topic;
  result.reason = aiResult.reason;

  // If UNSUBSCRIBE, try to unsubscribe and archive
  if (result.decision === 'UNSUBSCRIBE') {
    result.status = tryUnsubscribe(email.message, result.unsubscribeLink);

    // If we couldn't auto-unsubscribe, replace with Gmail link
    if (result.status === 'Manual needed') {
      result.unsubscribeLink = 'https://mail.google.com/mail/u/0/#inbox/' + email.id;
    }

    archiveEmail(email.thread);
  } else {
    result.status = 'Kept';
  }

  return result;
}

function classifyWithGemini(email, corrections) {
  const defaultResult = {
    decision: 'UNSUBSCRIBE',
    confidence: 'low',
    topic: 'unknown',
    reason: 'API error - defaulting to unsubscribe'
  };

  try {
    // Build corrections context
    let correctionsContext = '';
    if (corrections.length > 0) {
      correctionsContext = '\n\nPAST USER CORRECTIONS (learn from these):\n';
      for (const c of corrections.slice(-20)) { // Last 20 corrections
        correctionsContext += `- "${c.from}" was corrected to ${c.correction}\n`;
      }
    }

    const prompt = `You are an email classifier.

TOPICS TO KEEP: ${CONFIG.TOPICS_TO_KEEP.join(', ')}
${correctionsContext}

EMAIL TO CLASSIFY:
From: ${email.from}
Subject: ${email.subject}
Snippet: ${email.snippet.substring(0, 300)}

INSTRUCTIONS:
1. If topic matches interests above, decide KEEP
2. Otherwise, decide UNSUBSCRIBE
3. Return ONLY valid JSON, no other text

{"decision":"KEEP or UNSUBSCRIBE","confidence":"high or medium or low","topic":"detected topic","reason":"brief explanation"}`;

    const response = callGeminiAPI(prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        decision: (parsed.decision || 'UNSUBSCRIBE').toUpperCase(),
        confidence: (parsed.confidence || 'medium').toLowerCase(),
        topic: parsed.topic || 'unknown',
        reason: parsed.reason || ''
      };
    }

    return defaultResult;

  } catch (error) {
    console.error(`Gemini error: ${error.message}`);
    return defaultResult;
  }
}

function callGeminiAPI(prompt) {
  var baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  var url = baseUrl + '?key=' + CONFIG.GEMINI_API_KEY;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    return json.candidates[0].content.parts[0].text;
  }

  throw new Error('Invalid Gemini response');
}

// ============================================================================
// UNSUBSCRIBE LOGIC
// ============================================================================

function extractUnsubscribeLink(message) {
  try {
    // Get raw message to access headers
    const rawMessage = message.getRawContent();

    // Look for List-Unsubscribe header
    const headerMatch = rawMessage.match(/List-Unsubscribe:\s*([^\r\n]+)/i);

    if (headerMatch) {
      const headerValue = headerMatch[1];

      // Prefer HTTP link
      const httpMatch = headerValue.match(/<(https?:\/\/[^>]+)>/);
      if (httpMatch) {
        return httpMatch[1];
      }

      // Fall back to mailto
      const mailtoMatch = headerValue.match(/<(mailto:[^>]+)>/);
      if (mailtoMatch) {
        return mailtoMatch[1];
      }
    }

    // Search body for unsubscribe link
    const body = message.getBody();
    const bodyMatch = body.match(/href=["'](https?:\/\/[^"']*unsubscribe[^"']*)["']/i);
    if (bodyMatch) {
      return bodyMatch[1];
    }

    return 'Not found';

  } catch (error) {
    console.error(`Error extracting unsubscribe link: ${error.message}`);
    return 'Error extracting';
  }
}

function tryUnsubscribe(message, unsubscribeLink) {
  if (!unsubscribeLink || unsubscribeLink === 'Not found' || unsubscribeLink === 'Error extracting') {
    return 'Manual needed';
  }

  try {
    // Handle mailto links
    if (unsubscribeLink.startsWith('mailto:')) {
      return tryMailtoUnsubscribe(unsubscribeLink);
    }

    // Handle HTTP links
    if (unsubscribeLink.startsWith('http')) {
      return tryHttpUnsubscribe(unsubscribeLink);
    }

    return 'Manual needed';

  } catch (error) {
    console.error(`Unsubscribe error: ${error.message}`);
    return 'Manual needed';
  }
}

function tryMailtoUnsubscribe(mailtoLink) {
  try {
    // Parse mailto link: mailto:unsub@example.com?subject=Unsubscribe
    const withoutPrefix = mailtoLink.replace('mailto:', '');
    const [email, params] = withoutPrefix.split('?');

    let subject = 'Unsubscribe';
    if (params) {
      const subjectMatch = params.match(/subject=([^&]*)/i);
      if (subjectMatch) {
        subject = decodeURIComponent(subjectMatch[1]);
      }
    }

    GmailApp.sendEmail(email, subject, 'Please unsubscribe me from this mailing list.');
    return 'Email sent';

  } catch (error) {
    console.error(`Mailto error: ${error.message}`);
    return 'Manual needed';
  }
}

function tryHttpUnsubscribe(url) {
  try {
    const options = {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      timeout: 10000
    };

    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code >= 200 && code < 400) {
      return 'Link visited';
    }

    return 'Manual needed';

  } catch (error) {
    console.error(`HTTP unsubscribe error: ${error.message}`);
    return 'Manual needed';
  }
}

function archiveEmail(thread) {
  try {
    thread.moveToArchive();
  } catch (error) {
    console.error(`Archive error: ${error.message}`);
  }
}

// ============================================================================
// GOOGLE SHEETS
// ============================================================================

function getSheet() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
}

function getPastCorrections() {
  const corrections = [];

  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();

    // Skip header row, find rows with corrections
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const correction = row[9]; // "Your Correction" column (index 9)

      if (correction && correction.toString().trim() !== '') {
        corrections.push({
          from: row[1], // From column
          originalDecision: row[3], // AI Decision column
          correction: correction.toString().trim().toUpperCase()
        });
      }
    }

  } catch (error) {
    console.error(`Error reading corrections: ${error.message}`);
  }

  return corrections;
}

function logToSheet(result) {
  try {
    const sheet = getSheet();

    sheet.appendRow([
      result.date,
      result.from,
      result.subject,
      result.decision,
      result.confidence,
      result.topic,
      result.reason,
      result.unsubscribeLink,
      result.status,
      '' // Your Correction - empty for user to fill
    ]);

  } catch (error) {
    console.error(`Error logging to sheet: ${error.message}`);
  }
}

function ensureHeaders() {
  const sheet = getSheet();
  const firstRow = sheet.getRange(1, 1, 1, 10).getValues()[0];

  // Check if headers exist
  if (firstRow[0] !== 'Date') {
    sheet.getRange(1, 1, 1, 10).setValues([[
      'Date',
      'From',
      'Subject',
      'AI Decision',
      'Confidence',
      'Topic',
      'Reason',
      'Unsubscribe Link',
      'Status',
      'Your Correction'
    ]]);
  }
}

// ============================================================================
// SUMMARY EMAIL
// ============================================================================

function sendSummaryEmail(kept, unsubscribed) {
  const total = kept.length + unsubscribed.length;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}`;

  let html = `<h2>Email Cleanup Summary</h2>`;
  html += `<p><strong>${total}</strong> emails processed</p>`;

  if (total === 0) {
    html += `<p>No promotional emails found today. Your inbox is clean!</p>`;
  } else {
    // Unsubscribed section
    html += `<h3 style="color: #c00;">Unsubscribed (${unsubscribed.length})</h3>`;
    if (unsubscribed.length > 0) {
      html += `<table border="1" cellpadding="8" style="border-collapse: collapse;">`;
      html += `<tr style="background: #f5f5f5;"><th>From</th><th>Subject</th><th>Status</th></tr>`;
      for (const e of unsubscribed) {
        html += `<tr><td>${escapeHtml(e.from)}</td><td>${escapeHtml(e.subject)}</td><td>${e.status}</td></tr>`;
      }
      html += `</table>`;
    } else {
      html += `<p>None</p>`;
    }

    // Kept section
    html += `<h3 style="color: #080;">Kept (${kept.length})</h3>`;
    if (kept.length > 0) {
      html += `<table border="1" cellpadding="8" style="border-collapse: collapse;">`;
      html += `<tr style="background: #f5f5f5;"><th>From</th><th>Subject</th><th>Reason</th></tr>`;
      for (const e of kept) {
        html += `<tr><td>${escapeHtml(e.from)}</td><td>${escapeHtml(e.subject)}</td><td>${escapeHtml(e.reason)}</td></tr>`;
      }
      html += `</table>`;
    } else {
      html += `<p>None</p>`;
    }
  }

  html += `<hr>`;
  html += `<p><a href="${sheetUrl}">Review & correct decisions in Google Sheet</a></p>`;

  GmailApp.sendEmail(
    CONFIG.SUMMARY_EMAIL,
    `Email Cleanup: ${total} processed`,
    `Processed ${total} emails. View details: ${sheetUrl}`,
    { htmlBody: html }
  );
}

function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// SETUP & TRIGGERS
// ============================================================================

/**
 * Run this once to set up the daily trigger
 */
function setupTrigger() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new daily trigger at 9am
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  console.log('Daily trigger set for 9am');
}

/**
 * Run this once to ensure sheet has headers
 */
function setupSheet() {
  ensureHeaders();
  console.log('Sheet headers confirmed');
}

/**
 * Test function - process just one email
 */
function testOne() {
  const emails = getPromotionalEmails();
  if (emails.length > 0) {
    const corrections = getPastCorrections();
    const result = processEmail(emails[0], corrections);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('No promotional emails found');
  }
}
