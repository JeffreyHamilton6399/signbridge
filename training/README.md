# Training

Offline pipeline for the models the app can load. Separate from the web app on
purpose: nothing here runs in a browser, and the app must work with none of it.

> **Smoke-tested in CI, never run on real data.** The `training` job in
> `.github/workflows/ci.yml` runs both pipelines end to end — train, evaluate,
> export, verify the ONNX against PyTorch — on synthetic input from
> `make_smoke_data.py`. The plumbing is exercised on every push.
>
> What that does *not* tell you is anything about accuracy, or about
> `prepare_data.py`, whose MediaPipe path still has no coverage because
> synthetic images contain no hands. Expect to fix things there on first run.

## Setup

```bash
cd training
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

## The contract with the app

The single thing that must not drift: **feature extraction here must match
`src/features/normalize.ts` exactly.** `prepare_data.py` reimplements it, and
`test_parity.py` checks the reimplementation against fixtures exported from the
TypeScript tests. Run it before every training run.

```bash
python test_parity.py
```

If it fails, fix the Python — the TypeScript is the source of truth, because it
is what runs at inference time.

## Fingerspelling

```bash
# 1. Landmark a directory of labelled clips or images into .npz
python prepare_data.py --input data/fingerspell --task fingerspell --out data/fs.npz

# 2. Train. Split is BY SIGNER, never by clip.
python train_fingerspell.py --data data/fs.npz --out runs/fs-v1

# 3. Evaluate on held-out signers and emit the numbers the model card needs
python evaluate.py --run runs/fs-v1 --data data/fs.npz --report runs/fs-v1/report.md

# 4. Export
python export_onnx.py --run runs/fs-v1 --out ../public/models/fingerspell-v1.onnx
```

Then hash it, add it to `public/models/manifest.json`, and write its card in
`docs/MODELS.md`. The app refuses to load a model whose hash does not match, and
a model without a card does not ship.

## Signs

Same shape, with a temporal model over 64-frame windows:

```bash
python prepare_data.py --input data/signs --task signs --out data/signs.npz
python train_signs.py --data data/signs.npz --out runs/signs-v1 --arch gru
python evaluate.py --run runs/signs-v1 --data data/signs.npz --report runs/signs-v1/report.md
python export_onnx.py --run runs/signs-v1 --out ../public/models/signs-v1.onnx
```

`--arch gru` (bidirectional GRU) or `--arch transformer` (4-layer encoder). Both
include a `<no-sign>` class — it is essential and routinely forgotten, and
without it the recogniser fires during every transition.

## Input layout

```
data/
  fingerspell/
    <signer_id>/
      A/  *.jpg | *.mp4
      B/
      ...
  signs/
    <signer_id>/
      HELLO/  *.mp4
      THANK-YOU/
      <no-sign>/     <- transitions, idle hands, scratching your nose
```

The `signer_id` directory level is not optional. It is what makes a held-out
*signer* split possible, and a held-out-clip split inflates reported accuracy by
20–30 points on isolated-sign benchmarks — you learn one person's version of a
sign and score yourself on more of the same person.

## Metadata for the model card

`prepare_data.py` reads an optional `data/<task>/signers.csv`:

```csv
signer_id,skin_tone_monk,handedness,deaf_status,age_range,l1_asl,consent_ref
s01,4,right,deaf,25-34,yes,CONSENT-2026-011
```

`evaluate.py` uses it to break accuracy down by skin tone, handedness and
lighting. If the file is missing, the report says the breakdown is unavailable —
which is an acceptable card entry. Silence is not.

## Which dataset

Read [`../docs/DATASETS.md`](../docs/DATASETS.md) before downloading anything.
Short version: **FSboard** (CC BY 4.0, 147 paid and consenting Deaf signers) for
Phase 1. **Not ChicagoFSWild** — it has no licence at all and its signers were
never asked.

FSboard is sequence-labelled, not per-letter labelled, so it does not drop into
`prepare_data.py` as-is. DATASETS.md sets out the three ways to bridge that and
which one to pick. Decide before writing code against it.

## Smoke data

```bash
python make_smoke_data.py --out data/smoke.npz --task fingerspell
python make_smoke_data.py --out data/smoke-signs.npz --task signs
```

Made-up hands, for exercising the pipeline. A model trained on this recognises
nothing and its accuracy number means nothing. Never commit one to
`public/models/`, never write it up in a card. CI trains one, checks it exports,
and throws it away.

Useful locally for the same reason: it tells you the plumbing works before you
spend an afternoon extracting landmarks.

## Reading a report

`evaluate.py` reports **only over signers the model never saw**, read from the
run's `run.json`. Signers that were in training appear in the per-signer table
labelled as such and are excluded from every total.

The gap between those two numbers is the most informative line in the report. A
large one means the model has learned particular people rather than the
language. Only the held-out number goes in a model card.
