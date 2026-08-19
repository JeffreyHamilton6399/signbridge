# Ethics

This is the document to read before adding a feature, and the one to cite when
pushing back on a request — including one from the project owner.

## 1. This is not an interpreter, and never calls itself one

The word "interpreter" appears in this app only in reference to human, qualified
interpreters, and only to say that SignBridge is not a substitute for one. An
E2E test enforces this (`tests/e2e/app.spec.ts`).

A certified interpreter conveys meaning, register, intent, and cultural context
between two languages. This app does pattern matching on hand positions. In
medical, legal, emergency, financial, or educational-accommodation settings the
gap between those two things is where people get hurt — misdiagnosed, wrongly
detained, denied accommodations they are legally owed. In many jurisdictions
handing someone an app also does not discharge an accessibility obligation.

The disclaimer is persistent and non-dismissible. Do not add a close button.

## 2. ASL is a language, not encoded English

It has its own grammar, spatial syntax, and non-manual markers — facial
expression, eyebrow position, head tilt, mouth morphemes — that carry
grammatical meaning. Topic-comment structure, verb agreement through space,
classifier predicates, and role shift have no English word-order equivalent.

Consequences for this codebase:

- Any sentence-level feature goes through a **translation** step, never a
  per-word swap. `src/modes/reverse/glossEngine.ts` and
  `src/modes/conversation/glossToEnglish.ts` are both labelled approximate in
  the UI, and both surface the rules they applied.
- Non-manual markers are emitted as first-class tokens, not decoration. A
  yes/no question without raised brows is not a question.
- A rule engine cannot do classifiers, spatial referencing, or role shift. The
  UI says so. Do not remove that label because the output "looks good enough".

## 3. Video never leaves the device

Landmark extraction and inference both run in the browser. There is no server.
No frames, no landmarks, no transcripts are uploaded.

If a cloud model is ever added it must be opt-in, behind an explicit
plain-language consent screen that names what is sent, where, and for how long
it is kept. `privacy.onDeviceOnly` is locked on in the schema and re-forced on
every settings write and every migration, specifically so that a future
refactor cannot quietly flip it.

One honest exception, disclosed in the UI: in Chrome and Edge, the Web Speech
API's `SpeechRecognition` sends audio to the browser vendor's service. That is
why Reverse mode's speech input carries its own notice and why typed input is
always available.

## 4. Deaf-led, or it does not ship

Hearing-built ASL apps have a bad track record and a well-earned reputation
problem in the Deaf community: gloves that "translate" fingerspelling and
nothing else, avatars that produce fluent-looking nonsense, products announced
to hearing press with no Deaf involvement at all.

Requirements before this is put in front of anyone as a product, not
nice-to-haves:

- **Deaf signers testing it**, compensated for their time, with their feedback
  visibly changing the product.
- **Deaf consultants on the vocabulary.** The 150-sign target list in
  `src/modes/signs/vocabulary.ts` is a hearing developer's guess and is marked
  as such. Regional variation means several entries have more than one correct
  form.
- **Credited data sources and consultants**, by name where they consent to it.
- **A feedback path that goes somewhere real** and gets read.

If those are not in place, the honest thing is to describe this as a prototype
and say who built it.

## 5. Confidence is a first-class UI element

Never display a recognised word as if it were certain.

- Confidence is encoded in the typography itself — a letter being formed renders
  light and wide-tracked, and firms up as it commits.
- The top-3 alternates are always one tap away.
- Low-confidence committed words are marked in the transcript, and the marking
  survives export.
- The debug panel reports per-letter accuracy from the user's own calibration
  set, including the letters that are bad.

**Do not lower the confidence threshold to make a demo look better.** If
accuracy is poor, the honest move is to say so and fix the model.

## 6. Prefer deleting a feature over shipping a misleading one

Applied decisions in this build:

- **No shipped sign model.** A 2000-sign vocabulary at 45% is a demo that wastes
  people's time. Sign mode ships with only user-recorded signs, which actually
  work, and states plainly that no general model is installed.
- **No avatar.** There is no open, production-quality ASL avatar. A rigged model
  driven by a gloss stream produces handshapes that are close but wrong, with no
  non-manual markers — which reads as fluent and is not. The flag exists so the
  decision is visible, and the panel behind it explains the absence.
- **Conversation mode off by default.** Continuous ASL recognition is an open
  research problem. It ships behind an experimental flag and is built to fail
  visibly rather than confidently.

## 7. Not built here

Other sign languages. BSL, Auslan, LSF, and the rest are entirely separate
languages with their own grammars and lexicons — not dialects of ASL. Claiming
support for them because a model produces output is a lie. If someone wants BSL,
that is a different project with different Deaf communities leading it.
