# Sign clips

This directory is intentionally empty.

Reverse mode plays a short video per gloss and stitches the clips together. The
app ships without any, because sign video is somebody's work and somebody's
likeness. Two ways to fill it:

1. **Record your own, with Deaf signers, with a signed release.** This is the
   better answer. It is also the only way to get consistent framing, lighting
   and signing style across the set, which matters more than clip count.
2. **License a set.** Read the terms before you ship. "Available on the internet"
   is not a license.

## Adding clips

Drop `.mp4` (H.264) or `.webm` files here and list them in `manifest.json`:

```json
{
  "version": 1,
  "source": "Recorded at <place>, <date>",
  "license": "CC BY-SA 4.0",
  "credits": ["Signer name, with permission"],
  "entries": [
    { "gloss": "HELLO", "file": "/clips/hello.mp4", "durationMs": 900,
      "credit": "Signer name", "license": "CC BY-SA 4.0" }
  ]
}
```

Conventions that keep playback from looking broken:

- Start and end each clip in a neutral rest position, hands down, ~150ms of
  stillness at both ends. The crossfade needs somewhere to land.
- Same signer, same framing, same background across the whole set.
- Chest-up framing, hands never cropped, 30fps, ≥720p.
- Glosses in `SCREAMING-KEBAB` matching `src/modes/signs/vocabulary.ts`.

Any gloss without an entry is fingerspelled instead. That is a deliberate,
visible fallback, not a failure.
