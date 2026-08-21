'use strict';

// Thin wrapper around WhatsApp's Cloud API (Meta Graph API). All WhatsApp
// config lives in .env — see .env.example for the full list. This module is
// only ever exercised for real_estate accounts; if the env vars aren't set,
// the higher-level routes in server.js treat WhatsApp as "not configured"
// rather than crashing the whole app.

require('dotenv').config();
const axios = require('axios');

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';

function isConfigured() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_VERIFY_TOKEN);
}

function client() {
  const baseURL = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Send a pre-approved template message — required for the first message to
 * any number that hasn't messaged in within the last 24h (WhatsApp policy,
 * not a choice; freeform text simply fails outside that window).
 */
async function sendTemplateMessage(to, templateName, languageCode, bodyParams = []) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  };
  const res = await client().post('', payload);
  return res.data;
}

/** Freeform text — only works within the 24h customer-service window. */
async function sendTextMessage(to, body) {
  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } };
  const res = await client().post('', payload);
  return res.data;
}

/** Meta's GET /webhook verification handshake, performed once when the callback URL is saved. */
function verifyWebhookChallenge(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return challenge;
  return null;
}

/**
 * Extracts the useful bits out of a raw webhook POST body. Returns null if
 * this payload isn't an inbound user message (e.g. a delivery/read receipt,
 * which WhatsApp posts to the same URL).
 */
function parseIncomingMessage(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return null;

    const contact = value?.contacts?.[0];
    const text =
      message.type === 'text' ? message.text?.body
      : message.type === 'button' ? message.button?.text
      : message.type === 'interactive' ? (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title)
      : `[unsupported message type: ${message.type}]`;

    return {
      from: message.from,
      name: contact?.profile?.name || null,
      text,
      type: message.type,
      timestamp: message.timestamp,
      messageId: message.id,
    };
  } catch (err) {
    console.error('[whatsappClient] failed to parse webhook payload', err);
    return null;
  }
}

module.exports = { isConfigured, sendTemplateMessage, sendTextMessage, verifyWebhookChallenge, parseIncomingMessage };
