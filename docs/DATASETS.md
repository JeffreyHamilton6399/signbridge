# Datasets

What was checked, what the terms actually say, and what this project will and
will not train on. Verified August 2026 — **re-check before use.** Dataset
hosting and terms move, and a licence that was permissive when this was written
is not a licence today.

The rule this document exists to serve: a dataset needs *both* a licence that
permits what we intend to do, **and** provenance that the people in it consented
to. Either one alone is not enough. A permissive licence on non-consensual data
is still non-consensual data.

---

## Decision: FSboard

**Use FSboard for Phase 1 fingerspelling. Do not use ChicagoFSWild.**

| | FSboard | ChicagoFSWild / +
|---|---|---|
| Licence | **CC BY 4.0** — explicit, permits derivatives with attribution | **None stated** |
| Consent | 147 **paid and consenting** Deaf signers | Scraped from YouTube, aslized.org, deafvideo.tv |
| Recruitment | Recruited, shipped a phone, prompted to sign | Not contacted; a takedown request form exists |
| Size | >3M characters, >250 hours | 7,304 sequences / 55,232 sequences |
| Format | Video; MediaPipe Holistic landmarks used by the baseline | JPG frame sequences |
| Download | Kaggle, ~1.3 TB full | 14 GB / 82 GB |

---

## FSboard

- Paper: [arXiv:2407.15806](https://arxiv.org/abs/2407.15806)
- Data: [kaggle.com/datasets/googleai/fsboard](https://www.kaggle.com/datasets/googleai/fsboard)
- Licence: **CC BY 4.0**. Permits redistribution and derivative works, including
  a trained model, with attribution.

Collected from **147 paid and consenting Deaf signers** using Pixel 4A selfie
cameras across a variety of environments. Largest fingerspelling dataset by more
than 10×.

This is the right dataset for this project on the terms that matter here. The
signers were recruited, compensated, and consented — which is what "Deaf-led or
don't ship" (ETHICS.md) demands of a data source, and what no scraped corpus can
offer retroactively. The CC BY licence means a shipped model has an unambiguous
legal basis, and attribution is a requirement we would want to meet anyway.

Related and also usable: the **Google ASL Fingerspelling Recognition** corpus on
Kaggle is landmark-only (no imagery), de-identified, and from 100+ Deaf signers
recruited the same way. Being landmarks rather than video, it is far smaller and
far closer to this project's pipeline. Confirm its competition rules permit
non-competition use before relying on it.

### The open problem: FSboard is not per-letter labelled

This is the real work, and it is not a licence question.

Phase 1's model is a **per-frame letter classifier** — 63 floats in, 24 letters
out. FSboard is **sequence** data: a clip of someone fingerspelling a phrase,
labelled with the phrase. There is no per-frame alignment saying "frames 40–52
are an R". `train_fingerspell.py` cannot consume it as-is, and neither can
`prepare_data.py`.

Three ways forward, in order of preference:

1. **CTC forced alignment.** Train a CTC sequence model on FSboard, then use it
   to align letters to frames, then train the per-frame classifier on the
   result. Standard, and reuses the CTC head Phase 4 already needs.
2. **Train the sequence model directly** and change Phase 1's architecture to
   match the literature. Probably the better recogniser. A much larger change
   to the app, and it would replace the dwell-time commit mechanic.
3. **Segment on hold detection** — treat low-motion frames as letter centres.
   Cheap, crude, and would produce mislabelled training data at exactly the
   transitions that matter. Not recommended.

Do not start any of these without deciding which. The pipeline in `training/`
currently assumes shape (1) or (3).

### Practical constraints

- 1.3 TB is not something GitHub Actions can hold. Training on FSboard needs
  either a machine with real storage or a filtered subset pulled through the
  Kaggle API. The landmark-only Kaggle corpus is the tractable path.
- Landmarks must be re-extracted with **our** MediaPipe settings and run through
  `training/normalize.py`, not taken as given. FSboard's baseline uses Holistic;
  this app uses HandLandmarker, and `test_parity.py` pins what the app expects.

---

## ChicagoFSWild / ChicagoFSWild+ — rejected

- Page: [home.ttic.edu/~klivescu/ChicagoFSWild.htm](https://home.ttic.edu/~klivescu/ChicagoFSWild.htm)

**No licence document. No data use agreement. No redistribution terms.** The
page states the data is released "in the interest of improving digital
interfaces for signers, communication between signers and non-signers,
linguistic understanding of American Sign Language, and computer vision
research", and asks for citation. That is a statement of purpose, not a grant of
rights.

The clips come from YouTube, aslized.org and deafvideo.tv, annotated via
Mechanical Turk. The page carries this notice:

> If you see any of your own videos here and have any concerns with them being
> included, please contact the Principal Investigators.

That is a takedown mechanism. Its existence is an acknowledgement that the
signers in this corpus were never asked.

Both facts are disqualifying here, independently:

- **No licence** means no basis for shipping a derived model in a public app.
  CLAUDE.md §8 already flags this pattern for WLASL — "read the terms before
  shipping anything trained on it". The terms, read, do not exist.
- **No consent** puts it in direct conflict with ETHICS.md. Deaf people's
  language data being taken from public video and used to build tools they were
  not consulted about is a specific, well-documented grievance in this
  community, and a hearing-built ASL app repeating it would earn the reaction it
  got.

This is not a criticism of the dataset's authors — it is a widely used research
corpus and the research value is real. Research use under fair use and shipping
a product on it are different acts, and only the second one is being ruled out.

---

## Others, unverified

Listed in CLAUDE.md §8 and **not** checked as part of this pass. Do not treat
their inclusion here as approval.

- **ASL Citizen** (Microsoft Research) — isolated signs, documented consent.
  The likely candidate for **Phase 2**, not Phase 1; verify terms first.
- **WLASL** — web-scraped, murky provenance. Expect the ChicagoFSWild analysis
  to apply.
- **MS-ASL** — YouTube-sourced, known link rot. Same expectation.
- **How2Sign**, **OpenASL** — continuous ASL, relevant to Phase 4.

---

## Before training on anything

1. Re-read the current terms at the source. Record the date here.
2. Confirm consent and compensation, not just a licence.
3. Extract landmarks with our settings; run `python test_parity.py`.
4. Split by **signer**, never by clip (`training/splits.py` enforces this).
5. Write the card in `MODELS.md` — including a demographic breakdown, or an
   explicit statement that it is unavailable.
6. Credit the dataset and its signers in the app, not only in a file.
