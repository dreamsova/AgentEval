# Test-candidate labels

`candidate-labels.json` contains AI-proposed annotations for the 60 repository-visible test candidates. It is physically separate from `datasets/test/inputs.json`, and every label is marked `needs_human_review`. It is review material, not an accepted test-label store.

Independent annotators should work from the input file without access to these proposals. After independent review and conflict resolution, accepted labels must move to evaluator-only access and be loaded only after predictions are finalized. Evaluator, prompt-construction, split-assignment, and tuning code must never import candidate or accepted test labels.
