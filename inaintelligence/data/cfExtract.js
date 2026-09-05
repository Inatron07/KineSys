'use strict';

// Bill/receipt photo -> {amount, currency, vendor, date, confidence, notes}
// for the Cash Flow Tracker module. Ported from the standalone
// cashflow-tracker app's src/claudeExtract.js, adapted to reuse this app's
// existing Anthropic client pattern (see whatsappAgent.js) instead of
// creating a second one.

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function anthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

// Forcing a tool call (instead of asking Claude to "reply in JSON") is what
// makes this reliable — the API guarantees the response matches this schema
// rather than us hoping Claude's prose-JSON parses cleanly every time.
const RECORD_BILL_TOOL = {
  name: 'record_bill',
  description: "Record what's on this bill/receipt image.",
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'The total amount on the bill, as a plain number (no currency symbol).' },
      currency: { type: 'string', description: 'Currency if shown, e.g. AED, INR. Empty string if not legible.' },
      vendor: { type: 'string', description: 'The shop/vendor/business name on the bill. Empty string if not legible.' },
      date: { type: 'string', description: 'The date on the bill in YYYY-MM-DD format if legible, otherwise empty string.' },
      confidence: {
        type: 'number',
        description:
          'Your confidence (0 to 1) that the extracted amount is correct. Use a LOW value (below 0.6) if the image is blurry, the total is ambiguous (e.g. multiple totals/subtotals visible, handwriting, glare), or you are guessing at any digit. Use a HIGH value (above 0.9) only when the total is clearly printed and unambiguous.',
      },
      notes: { type: 'string', description: 'Anything the reviewer should double-check, e.g. "total partly obscured" or "two totals visible, used the larger one". Empty string if nothing to flag.' },
    },
    required: ['amount', 'confidence'],
  },
};

/**
 * Extracts {amount, currency, vendor, date, confidence, notes} from a bill
 * image or PDF. Returns null (never throws) if Claude isn't configured or
 * the call fails — callers should treat that as "needs manual entry",
 * exactly like a very-low-confidence result, not a hard error.
 */
async function extractCfBill(buffer, mimeType) {
  if (!isConfigured()) {
    console.warn('[cfExtract] ANTHROPIC_API_KEY not set — skipping extraction, entry will need manual review.');
    return null;
  }
  try {
    const isPdf = mimeType === 'application/pdf';
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } };

    const anthropic = anthropicClient();
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      tools: [RECORD_BILL_TOOL],
      tool_choice: { type: 'tool', name: 'record_bill' },
      messages: [
        {
          role: 'user',
          content: [
            block,
            { type: 'text', text: 'This is a photographed or scanned bill/receipt. Extract its details using the record_bill tool. If the image is too unclear to read a field, leave it as an empty string (or 0 for amount) and reflect that in a low confidence score rather than guessing confidently.' },
          ],
        },
      ],
    });

    const toolUse = msg.content.find((c) => c.type === 'tool_use' && c.name === 'record_bill');
    if (!toolUse) return null;
    const out = toolUse.input || {};
    return {
      amount: typeof out.amount === 'number' ? out.amount : Number(out.amount) || 0,
      currency: out.currency || '',
      vendor: out.vendor || '',
      date: out.date || '',
      confidence: typeof out.confidence === 'number' ? Math.max(0, Math.min(1, out.confidence)) : 0,
      notes: out.notes || '',
    };
  } catch (err) {
    console.error('[cfExtract] extraction failed', err.message);
    return null;
  }
}

module.exports = { extractCfBill };
