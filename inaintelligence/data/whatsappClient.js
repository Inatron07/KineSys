'use strict';

// Thin wrapper around WhatsApp's Cloud API (Meta Graph API).
//
// Multi-tenant: every send function takes an optional trailing `creds`
// object ({ phoneNumberId, accessToken }). Pass the requesting account's own
// WhatsApp config (from db.getEffectiveWhatsAppConfig) so each real_estate
// customer sends from their own number. When `creds` is omitted, falls back
// to the WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID .env vars — this keeps the
// original demo account working without a re_whatsapp_config row.

require('dotenv').config();
const axios = require('axios');

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';

function isConfigured() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_VERIFY_TOKEN);
}

/**
 * CRM lead/broker records store phone numbers exactly as typed (Add Lead
 * form) or exactly as they appeared in an imported Excel sheet — that means
 * "+971 50 585 3891", "050-585-3891", "00971505853891" etc. are all sitting
 * in the same `phone` column. Meta's Cloud API expects `to` as digits only
 * (country code, no leading +, no spaces/dashes); sending the raw, unnormalized
 * value works for *some* formats and silently fails for others, which is why
 * a bulk send can succeed for a few contacts and fail for the rest with no
 * obvious pattern. Every send function below normalizes right before it hits
 * the wire so this is fixed in exactly one place regardless of where the
 * phone number originally came from.
 */
function normalizeOutboundPhone(to) {
  const digits = String(to || '').replace(/\D/g, '');
  if (!digits) throw new Error(`Invalid WhatsApp recipient number: "${to}"`);
  return digits;
}

function client(creds) {
  const phoneNumberId = creds?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = creds?.accessToken || process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp is not configured for this account — set up a phone number + access token first.');
  }
  const baseURL = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Send a pre-approved template message — required for the first message to
 * any number that hasn't messaged in within the last 24h (WhatsApp policy,
 * not a choice; freeform text simply fails outside that window).
 */
async function sendTemplateMessage(to, templateName, languageCode, bodyParams = [], creds) {
  const payload = {
    messaging_product: 'whatsapp',
    to: normalizeOutboundPhone(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  };
  const res = await client(creds).post('', payload);
  return res.data;
}

/** Freeform text — only works within the 24h customer-service window. */
async function sendTextMessage(to, body, creds) {
  const payload = { messaging_product: 'whatsapp', to: normalizeOutboundPhone(to), type: 'text', text: { body, preview_url: false } };
  const res = await client(creds).post('', payload);
  return res.data;
}

/**
 * Send a single image by public HTTPS URL (WhatsApp fetches and re-hosts it
 * on their CDN — no file upload/media ID needed). Like sendTextMessage, only
 * works within the 24h customer-service window unless sent as part of a
 * template. Caption is optional.
 */
async function sendImageMessage(to, imageUrl, caption, creds) {
  const payload = { messaging_product: 'whatsapp', to: normalizeOutboundPhone(to), type: 'image', image: { link: imageUrl, caption: caption || undefined } };
  const res = await client(creds).post('', payload);
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
      phoneNumberId: value?.metadata?.phone_number_id || null, // which of our WhatsApp numbers this came in on — used to route to the right account
    };
  } catch (err) {
    console.error('[whatsappClient] failed to parse webhook payload', err);
    return null;
  }
}

/**
 * Extracts an async delivery-status update (sent/delivered/read/failed) out
 * of a raw webhook POST body. Meta posts these to the same webhook URL as
 * inbound messages but under `statuses` instead of `messages` — this is how
 * we find out a template actually got rejected (e.g. error 131049 ecosystem
 * engagement throttling) after the initial send API call already returned
 * 200 OK. Returns null if this payload isn't a status update.
 */
function parseStatusUpdate(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const status = value?.statuses?.[0];
    if (!status) return null;

    const error = status.errors?.[0];
    return {
      waMessageId: status.id,
      status: status.status, // 'sent' | 'delivered' | 'read' | 'failed'
      recipientId: status.recipient_id,
      errorCode: error?.code || null,
      errorTitle: error?.title || null,
      errorDetail: error?.error_data?.details || error?.message || null,
      phoneNumberId: value?.metadata?.phone_number_id || null,
    };
  } catch (err) {
    console.error('[whatsappClient] failed to parse status webhook payload', err);
    return null;
  }
}

module.exports = { isConfigured, sendTemplateMessage, sendTextMessage, sendImageMessage, verifyWebhookChallenge, parseIncomingMessage, parseStatusUpdate };
