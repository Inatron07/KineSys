# WhatsApp Demo Script — Inacio, Dubai investment property

A ready-to-use storyline for demoing Zara over WhatsApp, using your own lead
(Inacio) as the test case. This starts the way a real conversation actually
starts — with your outreach template going out first, since that's what
re-engages a lead who hasn't messaged recently — then you reply from your
phone playing the lead. Send each reply a few seconds apart and watch it
land in the CRM's WhatsApp tab live.

## Step 0 — Kick it off from the app

In the CRM, open the WhatsApp tab, find **Inacio** in the leads panel, and
hit **Send template** (either from the lead's inline chat window or the lead
detail page). This fires the configured outreach template to your WhatsApp
number.

*Proves:* the outreach template send works end to end, and the message shows
up logged in the chat thread the moment it's sent.

## Act 1 — Inacio replies (send these from your phone, a few seconds apart)

**1. Opening**
> Hi, I saw your properties online. Looking for a 2 bedroom apartment in Dubai, what do you have?

*Proves:* `search_properties` gets called with area/type filters, Zara answers using a real `re_inventory` match (Marina Heights) instead of guessing, and the lead's stage moves to `in_conversation`.

**2. Narrow it down**
> What's the price for that one? And how big is it?

*Proves:* Zara pulls exact price/size from the tool result rather than inventing numbers.

**3. Ask to see it**
> Can you send me some photos?

*Proves:* `send_property_photos` fires — real images from `re_inventory.images` should arrive as WhatsApp image messages right after Zara's text reply.

**4. Budget stretch / upsell**
> Actually my budget can go a bit higher, do you have anything in Palm Jumeirah?

*Proves:* a second `search_properties` call with a different area filter, returning the Palm Jumeirah villa listing.

**5. Qualify further**
> How many bedrooms and bathrooms does the villa have?

*Proves:* Zara reads the `bedrooms`/`bathrooms` fields correctly instead of just repeating "villa."

**6. Timeline**
> I'm looking to close in the next 2-3 months. Can we book a viewing?

*Proves:* stage moves to `booked_viewing`, and in the CRM the lead's pipeline status flips to "Site Visit" automatically — check the lead detail page after sending this.

## Optional side branches (send instead of, or after, step 6 — pick one)

**A. "Are you even human?"**
> Wait, am I talking to a bot?

*Proves:* Zara answers honestly and offers a human handoff, rather than deflecting.

**B. Escalate to a human broker**
> I want to negotiate the price directly with someone, can I speak to an agent?

*Proves:* stage moves to `needs_human` — confirm it shows up flagged in the CRM for a broker to pick up.

**C. Lose interest**
> Actually never mind, I've decided to buy locally instead.

*Proves:* stage moves to `not_interested`, and the lead's pipeline status flips to "Lost."

**D. No-match query (tests honesty, not invention)**
> Do you have anything in London?

*Proves:* Zara says honestly that nothing matches rather than inventing a London listing — this one's important to run since it's the guardrail against hallucinated properties.

## While you're at it, also check

- **Clear chat**: after the demo, open Inacio's chat window and hit "Clear chat" — confirm the thread empties in the app but the real WhatsApp conversation on your phone is untouched.
- **Live sync**: send a message from your phone and watch it appear in the app's chat window within ~4 seconds without refreshing.
- **Bulk outreach**: from the WhatsApp leads panel, select Inacio plus one or two other test leads and try "Send outreach template" to all of them in one go.

Reset between full run-throughs with **Clear chat** so each demo starts clean.
