# F01: Model release integrity

Status: **complete (2026-09-23)**. Release `hist-v1` is active; see the handoff record.

## Outcome

Make a model release an indivisible, verifiable bundle so the Python prediction
path, static export, public copy, and metrics cannot silently use different
training runs.

## Read first

- `docs/product/HANDOFF.md`
- `CONTRIBUTING.md`, especially artifact mismatch and honesty rules
- `src/models/model_config.py`
- `src/models/predict_matchup.py`
- `scripts/setup_production.py`
- `scripts/export_static_site_data.py`
- `scripts/verify_static_export.py`

## Owned interface

Define one release manifest containing, at minimum:

```json
{
  "version": "...",
  "purpose": "historical_entertainment",
  "classifier": {"path": "...", "sha256": "..."},
  "regressor": {"path": "...", "sha256": "..."},
  "columns": {"path": "...", "sha256": "...", "count": 0},
  "profileSchemaVersion": "...",
  "metricsPath": "...",
  "trainedThroughSeason": 0
}
```

Prediction and export code must resolve all release artifacts through this
manifest. A partial production bundle is invalid; do not fall back file by file.

## Work

1. Reproduce the current mismatch and preserve the evidence in a test.
2. Choose and document the intended historical-entertainment release with the
   owner. Do not promote a model solely because it reports a larger metric.
3. Make release promotion atomic and validate hashes, column count, schema, and
   estimator feature names at load time.
4. Make `predict_matchup` fail early with one actionable release error.
5. Add a clean-environment smoke suite with representative playoff,
   non-playoff, historical-name, same-season, and cross-era cases.
6. Align public metadata and remove stale accuracy claims from the served path.

## Completion criteria

- A deliberately mixed bundle fails before inference.
- The selected bundle completes all smoke matchups successfully.
- `scripts/verify_static_export.py` passes its full sample after a fresh export.
- A release can be promoted or rolled back as one unit.
- The manifest and public model description agree on purpose, version, columns,
  and limitations.
- Tests prove that a partial production directory cannot trigger mixed fallback.

## Agent kickoff prompt

> Implement F01 only. Read `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and
> this brief. Reproduce the artifact mismatch first, then introduce an atomic
> release manifest and validation. Preserve unrelated model experiments. Run
> the matchup smoke suite and static-export verifier, and update this brief with
> the chosen release, commands, results, and any interface changes.

## Handoff record

### Reproduced mismatch

With `models/production/` holding only `best_experiment_columns.json` (the
layout in the repo until this change) and the point-in-time retrain in
`models/experiments/`, the old `_resolve()` loaded the classifier from
experiments and the columns from production. `predict_matchup("Warriors", 2017,
"Bulls", 1998)` then failed inside sklearn with "feature names should match
those that were passed during fit" (196 fitted versus 70 listed). This is the
break that commit a138cd0 worked around. `tests/test_release_integrity.py`
preserves it as `test_legacy_partial_production_folder_is_rejected` and
`test_retrained_weights_with_stale_columns_cannot_be_built`.

### Selected release: `hist-v1`

The owner chose option A on 2026-09-23. `hist-v1` bundles the model that was
already shipping, unchanged:
- source: the `models/experiments/` artifacts from 9309302, restored in a138cd0
- model: L1 logistic regression, `playoffs_only`, `regular_plus_playoff_context`
- 70 columns; trained on seasons up to and including 2018

Its recorded 71.04% came from leaky training features, so `metrics.json` sets
`publicAccuracyClaim` to null and keeps the recorded numbers only under
`recordedAtTraining` with `validForClaims: false`. The manifest's
`limitations` hold the public model description.

The point-in-time retrain (61.3% test accuracy) is the candidate for a future
`hist-v2`. It cannot be served until prediction and export compute its `_z`
features from the previous season's distribution.

### Interface

- `src/models/release.py`: `load_active_release()`, `load_release(dir)`,
  `check_profiles()`, `build_release()`, `activate()`, `ReleaseError`.
- Layout: `models/releases/<version>/{manifest,classifier,regressor,columns,metrics}`.
  `models/production/` contains only the `ACTIVE_RELEASE` pointer. Any other
  file there is a hard error.
- The manifest has the brief's fields plus `manifestVersion`, `description`,
  `limitations`, `source`, and an `estimator` name per model. Load-time checks:
  - every file's sha256 is checked before anything is unpickled;
  - the column count matches `columns.json`;
  - both models' `feature_names_in_` equal `columns.json`;
  - both estimator class names match the manifest;
  - `profileSchemaVersion` is `team_season_profiles_extended.v1`;
  - `purpose` is `historical_entertainment`;
  - every stat the model reads exists in the profiles CSV.
- `scripts/promote_release.py --list | --build V --from DIR --info JSON | --activate V`.
  `--activate` is also the rollback command. It validates first, then replaces
  the pointer atomically. Releases are immutable, and a failed build leaves
  no folder behind.
- `model_config.py` no longer exposes `CLF_MODEL_PATH`, `REG_MODEL_PATH`,
  `MODEL_COLUMNS_PATH`, `MODEL_VERSION`, `FEATURE_COUNT`, or `TEST_METRICS`.
- `predict_matchup()` additionally returns `model_release` and `model_purpose`.
  The regressor is now required. The margin text reads "by about N pts".
- `frontend/public/data/index.json` gained `"release": {"version", "purpose"}`.
  F02's `/about` page displays it. `verify_static_export.py` fails if it
  differs from the active release.
- `scripts/setup_production.py` was removed. The stale production
  `model_config.json` and column list moved to `archive/old_models/production-2026-07/`.

### Verification (2026-09-23)

| Command | Result |
|---|---|
| `python scripts/export_static_site_data.py` | 835 team-seasons, 696,390 ordered pairs, release `hist-v1`. All 835 team files were byte-identical to the previous export; only `index.json` changed. |
| `python scripts/verify_static_export.py` | Before the re-export: failed, because the export had no release tag. After: PASSED on 200/200 pairs, max diff 0.0. |
| `python -m pytest tests/test_release_integrity.py` | 23 passed: mixed, partial, tampered, and mismatched bundles; promote and rollback; 5 smoke matchups; the historical-name export check. |
| `python -m src.models.test_prediction_pipeline` | 6/6 matchups succeeded. |
| `python -m src.models.audit_prediction_inputs` | Runs again; it was already broken by an import of the nonexistent `PREDICTION_CONTRACT_PATH`. 70 columns, no missing source fields. |

### Remaining risks

- `predict_matchup()` finds teams by current franchise names. A historical
  team-season such as the 2005 SuperSonics resolves as "Oklahoma City Thunder"
  2005. The site uses era-correct names from the export.
- `models/experiments/experiment_metrics.json` still records 0.7104 as a
  training artifact. It is not on the served path.
- The smoke suite skips its matchup cases when the gitignored profiles CSV is
  absent. A CI job needs the data pipeline or a checked-in fixture to run it.

