# Models

Every model that ships in SignBridge needs a card in this file before it ships.
A model without a card does not go in `public/models/`.

---

## Currently shipped: none

`public/models/manifest.json` is empty. This is a deliberate state, not an
oversight. The alternative — bundling a model trained on a dataset with murky
provenance, or worse, an untrained placeholder that produces plausible-looking
output — would be exactly the overclaim this project is built to avoid.

What the app actually runs on today:

| Path | What it is | Where it comes from |
|---|---|---|
| Fingerspelling baseline | 24 hand-written geometric templates over interpretable features (finger extension, tip gaps, thumb depth, pointing direction) | `src/modes/fingerspell/letterTemplates.ts` |
| Fingerspelling personal head | MLP, 63 -> 48 -> K, fitted in-browser on augmented samples | The user's own calibration samples |
| Built-in signs | 97 hand-written geometry rules over handshape, body-anchored location, movement and orientation | `src/modes/signs/signTemplates.ts` |
| Custom signs | Nearest-centroid prototypes over a 64×134 window | The user's own recordings |
| Conversation | Nothing | — |

### Accuracy of the built-in signs: unmeasured

There is no held-out-signer evaluation for the 29 rule-based signs, because
there is no evaluation set. What *is* measured is the separation between a real
sign and a hand at rest, on synthetic observations: idle poses top out at 0.40,
clean signs score 1.00, and the rejection floor sits at 0.55 between them
(`tests/signs.test.ts`).

That is a statement about the rules being internally consistent, **not** about
how often they are right on a real signer. Expect real-world accuracy to be well
below a trained model's, to vary hugely with lighting and signing style, and to
be worst on the pairs listed in `CONFUSABLE`. Anyone reporting a number for this
mode needs to collect held-out signers first and write it up here like any other
model.

---

## Card template

Copy this for every model added.

```markdown
### <model id> — <version>

**File** `public/models/<file>.onnx` · **SHA-256** `<hash>`
**Input** <shape and feature contract, referencing normalize.ts>
**Output** <shape, label order, whether logits or probabilities>

**Training data**
- Source dataset(s), version, and download date
- Licence, and whether it permits redistribution of derived weights
- Number of clips / samples, number of distinct signers

**Signer demographics**
- Count by self-reported skin tone (Fitzpatrick or Monk scale)
- Count by handedness
- Count by Deaf / hard-of-hearing / hearing signer
- Age range, and whether signers are native/L1 or L2
- If any of this is unknown, say "unknown" — do not omit the row

**Evaluation**
- Split method — MUST be held-out signer, not held-out clip
- Top-1 and top-5 on the held-out signers
- Per-class accuracy table
- Accuracy broken down by skin tone, handedness, and lighting condition

**Known failure modes**
- Specific, concrete, and honest

**Intended use and out-of-scope use**
```

---

## Evaluation rules

**Split by signer, never by clip.** A random split over clips leaks signer
identity into the training set and inflates reported accuracy dramatically —
often by 20–30 points on isolated-sign benchmarks. The model learns *this
person's* version of a sign and is scored on more of the same person.

**Report the breakdown or say you cannot.** Accuracy by skin tone, handedness,
and lighting condition goes in the card. If the dataset does not carry that
metadata, the card must say so explicitly. "We did not measure this" is an
acceptable card entry. Silence is not.

**Do not tune the confidence threshold to make demos look better.** If accuracy
is bad, the card says accuracy is bad.

---

## Candidate datasets

Availability and licence terms change. **Verify both yourself before using any
of these** — the notes below are orientation, not legal advice.

| Dataset | Content | Notes |
|---|---|---|
| **ASL Citizen** (Microsoft Research) | Isolated signs, large, consented collection | Best-documented starting point for Phase 2. Check the current licence and any registration requirement. |
| **WLASL** | ~2000 glosses, web-scraped | Widely used in papers; provenance and licensing are murky. Read the terms before shipping anything trained on it. |
| **MS-ASL** | YouTube-sourced | Link rot is a known and substantial problem. |
| **ChicagoFSWild / FSWild+** | Fingerspelling in natural video | Relevant to Phase 1. |
| **How2Sign**, **OpenASL** | Continuous ASL with English alignment | Relevant to Phase 4. |

### For fingerspelling, record your own

A fingerspelling sample is 63 floats. A few thousand samples across several
people is an afternoon of work, and it matches this pipeline's exact
preprocessing rather than approximating it. That is usually better than any
public dataset for Phase 1 — provided the signers are compensated, consented,
and credited, and provided a meaningful number of them are Deaf.

---

## Integrity

`src/models/registry.ts` verifies a SHA-256 before creating an inference
session, and refuses to load on mismatch. To add a model:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" model.onnx
```

Put the hash in `manifest.json` alongside the file, the label list, the input
dimension, and a `card` pointer back to this document.
