# Aphel · Vesper — hero brief

One full-viewport hero. No nav, no sections below. Brand, product and every number here are invented for this concept.

## Brand

- **Aphel**, from *aphelion*: the farthest point of an orbit. The logo is an orbit ellipse with one amber dot at its far end.
- **Vesper**, the product: a 3.7 m hybrid sounding rocket (the Roket2 model) that flies research payloads past 100 km and back.
- **Audience:** university labs, biotech and materials teams, and space startups who need a few minutes of microgravity or a flight-proven test, without waiting a year for a ride.
- **Voice:** precise, calm, confident. Short sentences, plain words, numbers over adjectives.

## Concept

> **An inspection bay floating in a turning universe.** You hold the rocket in your hand and turn it. The cosmos turns with you. One amber accent, and it only burns when the engine does.

Why it works for the brand: a launch company sells trust. Letting people turn the vehicle over and fire the engine says *look as closely as you like* better than any claim.

## References and what we take from each

| Reference | What we take | What we leave |
|---|---|---|
| fmi-industries.com | Layout: object centred high, headline bottom-left, paragraph and bracketed mono CTA bottom-right, launch plume on the object | Top nav, horizon photo |
| behfar.dev | Particle universe: starfield, spiral galaxies, nebulae, a thin dust lane, mouse parallax, scroll rotates the whole cosmos | Retro outline display type, cookie banner |

## Content structure (top to bottom, left to right)

1. **Wordmark** (top-left): orbit mark + APHEL. Identity only, not a nav.
2. **Next flight countdown** (top-right): a live mono readout. It backs up the "every 14 days" claim.
3. **Rocket** (centre, upper two-thirds): the hero moment. Eye lands here first.
4. **Live readouts** on hairline leaders tied to the rocket:
   - Left, on the body: **Heading** in degrees, plus length and diameter.
   - Right, at the engine: **Engine** state (Cold / Igniting / Burning / Shutdown), **Thrust** in kN, and an **Ignite Engine** button for keyboard users.
5. **Headline** (bottom-left): the claim.
6. **Paragraph + CTA** (bottom-right): the facts, then the action.
7. **Gesture hint** (bottom-centre): how to use the page, in one line.

## Copy deck

**Headline: five options, one pick**

1. Small rocket. Big altitude.
2. Your experiment, 100 km up.
3. Space every 14 days.
4. Look closer. It's ready to fly.
5. **Flight-ready from every angle.** ✅

Picked #5 because the page lets you prove it: you turn the rocket and see every side. The paragraph carries the specifics so the headline can stay short.

**Paragraph** (33 words, grade 8):

> Vesper takes your experiment past the edge of space, 100 km up. Book a seat on any flight. We launch every 14 days and get your payload back to you within 48 hours.

**CTA:** `Book a Payload Slot` (verb + object, Title Case)

**Readouts**

| Label | Value |
|---|---|
| Next flight | T– 09d 14:22:07 (counts down to the next 14-day window) |
| Heading | 128.4° |
| Body | 3.7 m · Ø 0.3 m |
| Engine | Cold → Igniting → Burning → Shutdown |
| Thrust | 0.0 kN → 9.8 kN |
| Button | Ignite Engine / Cut Engine |

**Gesture hint:** Scroll to turn · Drag to inspect · Click to ignite

**Cursor label on the rocket:** Drag to inspect · Click to ignite (while burning: Drag to inspect · Click to cut engine)

**Touch hint:** Swipe to turn · Drag the rocket · Tap to ignite

**Loading:** Fuelling Vesper… 64%

## Interaction model

- **Scroll** (wheel, trackpad, touch swipe, arrow keys, Page Up/Down): turns the rocket and the whole universe together, endlessly. There is no end of page.
- **Mouse move**: the camera drifts toward the cursor, stars near the cursor part around it, and the rocket leans slightly toward it.
- **Drag the rocket**: spin it on its own axis and tip it to see the nozzle or the nose. Its centre of mass never moves. On release it coasts, then tips back upright.
- **Click the rocket** (or press the button): the engine lights with an exhaust plume and sound (igniter clicks, a whump, then a roar that follows the throttle). Click again to cut it.
- **Hover the rocket**: the readouts power up (dot, leader line in steps, label typed in with a flicker). Leaving runs it backwards after a short grace, so you can still reach the Ignite Engine button.
- **Sound toggle** (top-right): Sound On / Off, remembered per browser.
- **Reduced motion**: no idle drift, no shake, no twinkle. Scroll and drag still work because they are user-driven.
