## Description

Provide a brief description of the changes proposed in this Pull Request (PR) and why they are needed.

## Types of Changes

- [ ] New Scanner implementation (under `src/maintenance/`)
- [ ] Logic bug fix or edge-case correction
- [ ] Documentation update
- [ ] Test coverage or fixture addition

## Scanner Checklist (If adding/editing a scanner)

- [ ] Finding contains a clear `label` mapping to risk decisions.
- [ ] Concrete `evidence` text and `files` paths are provided.
- [ ] Finding maps to a recommended action.
- [ ] Confidence and effort heuristics are reasonably mapped.
- [ ] Low-signal or speculative findings are marked `hiddenByDefault: true`.

## Testing

- [ ] I have verified these changes locally.
- [ ] I have written deterministic tests covering these changes (no live network dependencies).
- [ ] All tests pass successfully (`npm test`).
