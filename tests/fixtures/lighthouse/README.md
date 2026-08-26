# Recorded Lighthouse output

`local-fixture-page.json` is real output from Lighthouse 13.4.1, captured against
a **local fixture page served from `127.0.0.1`** — never a government site, per
the constitution's rule that tests exercise network behaviour against local
servers only.

It exists because `src/quality/deep-check.ts` describes the tool's result
structurally rather than importing its types, and a hand-written stand-in would
only ever prove that the code agrees with itself. This fixture proves it agrees
with the tool.

Two things are trimmed, and nothing is edited:

- each audit keeps `id`, `score`, `scoreDisplayMode`, `numericValue` and
  `numericUnit`, and drops `details` — the bulk of the payload, and the only part
  that carries page content;
- each category keeps `id`, `title` and `score`. The scores are **kept
  deliberately**: one of the guarantees is that they never reach the record, and
  a fixture without them could not catch a regression that let them through.

Re-capture it when the Lighthouse major version changes. A shape the code reads
that the tool stopped emitting should fail here, loudly, rather than in
production as a field that silently went missing.
