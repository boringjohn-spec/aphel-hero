# Aphel · Vesper hero

A single full-viewport hero: the Roket2 model in an interactive particle universe. Brand, product and numbers are invented (see `docs/brief.md`).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Interaction

- **Scroll / swipe / arrow keys:** turn the rocket and the universe together, endlessly.
- **Mouse move:** camera parallax, stars part around the cursor, rocket turns slightly toward it.
- **Drag the rocket:** spin and tip it about its centre of mass; it coasts, then tips back upright.
- **Click the rocket** (or the Ignite Engine button): light the engine, with sound. Click again to cut it.
- **Readouts** (heading, engine) appear only while the cursor is on the rocket or a readout, and step in and out mechanically. On touch they stay up for 2.6 s after you touch the rocket; keyboard focus on the button also shows them.
- **Sound** toggle in the top bar (remembered per browser). Audio starts only after the first ignite click.

## Files

- `src/main.js`: renderer, layout (fits the rocket between the top bar and the copy), input, engine states, readouts, countdown.
- `src/universe.js`: starfield, spiral galaxies, nebulae, dust lanes; one point shader with cursor repel and twinkle.
- `src/audio.js`: Web Audio engine sound (rumble, roar with flutter, hiss, crackle; igniter clicks and whump on light-up), driven by the throttle.
- `src/rocket.js`: loads `public/models/engine.fbx` with the 2K WebP texture set, and builds the exhaust plume.
- `docs/brief.md`: brand, concept, content structure and copy deck.

Add `?still` to the URL to stop the idle drift (for screenshots).
