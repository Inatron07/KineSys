'use strict';

// The conversational "brain" behind the WhatsApp Integration tab: given a
// lead + prior message history + their new inbound text, asks Claude for the
// next reply, letting it call two tools along the way — update_lead_stage to
// keep the CRM record current, and search_properties to look up real
// re_inventory listings instead of guessing. Ported from the standalone
// whatsapp-outreach-agent prototype, adapted to this app's schema/db.js.

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function anthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

const UPDATE_LEAD_TOOL = {
  name: 'update_lead_stage',
  description:
    "Update this lead's conversation stage. Call this once per turn to reflect the current state of the conversation, before writing your reply.",
  input_schema: {
    type: 'object',
    properties: {
      stage: { type: 'string', enum: ['in_conversation', 'needs_human', 'not_interested', 'booked_viewing'] },
      notes: { type: 'string', description: 'Brief update: what you learned this turn (budget, area, timeline, etc).' },
    },
    required: ['stage', 'notes'],
  },
};

const SEARCH_PROPERTIES_TOOL = {
  name: 'search_properties',
  description:
    "Search current available listings. Use this whenever the lead asks about specific properties, pricing, or what's available in an area — never guess or invent listing details. Returns up to 5 matches.",
  input_schema: {
    type: 'object',
    properties: {
      area: { type: 'string', description: 'Locality/area to filter by, e.g. "Dubai Marina"' },
      property_type: { type: 'string', description: 'e.g. "2BHK", "Villa", "Apartment", "Plot"' },
      min_price: { type: 'number' },
      max_price: { type: 'number' },
      min_bedrooms: { type: 'number' },
    },
  },
};

const TOOLS = [UPDATE_LEAD_TOOL, SEARCH_PROPERTIES_TOOL];
const MAX_TOOL_ROUNDS = 4;

function buildSystemPrompt(lead) {
  const agentName = process.env.AGENT_NAME || 'Zara';
  const businessName = process.env.BUSINESS_NAME || 'the team';
  const businessContext = process.env.BUSINESS_CONTEXT || '';

  return `You are ${agentName}, a real-estate outreach assistant for ${businessName}, chatting with leads over WhatsApp.

BUSINESS CONTEXT:
${businessContext || '(no additional context configured — set BUSINESS_CONTEXT in .env)'}

WHO YOU'RE TALKING TO:
Name: ${lead?.name || 'Unknown'}
Property interest: ${lead?.property_interest || 'Unknown'}
Budget: ${lead?.budget ? lead.budget : 'Unknown'}
Nationality: ${lead?.nationality || 'Unknown'}
Notes on file: ${lead?.remarks || 'None'}

YOUR GOAL:
Re-engage this lead about their property interest, answer their questions helpfully,
qualify them (budget range, preferred area, property type, timeline to buy/rent,
purpose — end-use vs investment), and move them toward booking a site visit or a
call with a human broker from the team.

STYLE (this is WhatsApp, not email):
- Short messages. 1-4 sentences per message, plain text, no markdown, no bullet lists.
- Warm and conversational, not salesy or pushy. One question at a time, not a checklist.
- Use the lead's first name occasionally, not in every message.
- If asked directly whether you're a bot/AI, say yes honestly and offer to connect
  them with a human whenever they'd like.

LISTINGS (use the search_properties tool):
- The moment a lead asks about specific properties, pricing, or what's available in
  an area, call search_properties — don't answer from memory or guess.
- Only state details (price, size, bedrooms, status) that the tool actually
  returned. If it returns nothing, say honestly that you don't have a match right
  now and offer to have a human broker check newer listings — never invent a
  property, price, or address.
- Don't dump all results as a list — mention one or two of the best matches
  conversationally and ask if they'd like more.

WHEN TO ESCALATE TO A HUMAN (use the update_lead_stage tool):
- The lead wants to schedule a site visit or call → stage "booked_viewing"
- The lead is negotiating price, asking for legal/loan specifics, or explicitly
  asks for a human → stage "needs_human"
- The lead says they're no longer interested → stage "not_interested"
- Otherwise, while you're still actively qualifying/chatting → stage "in_conversation"

Always call the update_lead_stage tool once per turn to keep the lead's record
current, using your best judgement on stage/notes, THEN write your WhatsApp reply.`;
}

/**
 * Given a lead row (from re_leads) + prior re_wa_messages history + the new
 * inbound text, returns { replyText, stageUpdate } where stageUpdate is the
 * last { stage, notes } the model set, or null.
 */
async function generateReply(accountId, lead, history, incomingText) {
  const anthropic = anthropicClient();
  const messages = [
    ...history.map((h) => ({ role: h.direction === 'in' ? 'user' : 'assistant', content: h.message })),
    { role: 'user', content: incomingText },
  ];

  let stageUpdate = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: buildSystemPrompt(lead),
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const replyText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    if (!toolUses.length) return { replyText, stageUpdate };

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const call of toolUses) {
      if (call.name === 'update_lead_stage') {
        stageUpdate = call.input;
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'ok' });
      } else if (call.name === 'search_properties') {
        const matches = await db.searchREInventory(accountId, call.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: matches.length ? JSON.stringify(matches) : 'No matching available properties found.',
        });
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'Unknown tool.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });

    if (replyText && round === MAX_TOOL_ROUNDS - 1) return { replyText, stageUpdate };
  }

  const followup = await anthropic.messages.create({
    model: MODEL, max_tokens: 600, system: buildSystemPrompt(lead), messages,
  });
  const replyText = followup.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { replyText, stageUpdate };
}

module.exports = { isConfigured, generateReply };
