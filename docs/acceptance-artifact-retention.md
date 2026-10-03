# Acceptance artifact retention

The independent batch began at `597059edee6b446aaa4a6deed1207fcdf8a8d91e`.

- Root `test-results/` and per-invocation `.playwright/` are ignored and contain no tracked generated outputs.
- All existing failure screenshots, traces, HTML reports and per-run status markers were retained. A failed legacy marker is not evidence of failure on the current tested code.
- The legacy root `test-results/.last-run.json` was copied byte-identically to `.playwright/retained/legacy-root-last-run.json` before removing the redundant active-location marker. Its 1,272 bytes have SHA-256 `10d493e53154e96abb4bced1e13d655d9e4928f247393129b1dbbf057a68dc4d`.
- At that cleanup point, `.playwright/` contained 60 files / 18,167,978 bytes and root `test-results/` retained 30 files / 11,587,770 bytes. New gate reports add to the retained inventory; these numbers are not a claimed final count.
- No synthetic watch sentinel or owned temporary PostgreSQL cluster remained before the new gates.
- New parallel invocations retain isolated JSON and HTML reports plus `evidence.json`, including exact commands, revision, dirty state, code-input fingerprints and outcome counts. SQL reports have a separate owned path.

No broad deletion, trace rewriting, or erasure of failed-run history was performed.

## Interrupted-run and restart boundary

- Completed failed runs `60069d2b-9ed0-484b-996c-a2f90d9f8b52` and `b679acf8-0698-4ba5-a03e-56a28c1d9995` retain their original JSON/HTML/evidence and failure artifacts in the workspace.
- The deliberately stopped old-harness run `f7235276-86a7-40fa-980d-889bf91ba3df` and restart-interrupted run `e31b87c8-7886-46ab-97b5-ee2643caed0b` retain original in-progress evidence. Their stale `running` labels do not indicate an active process or a passing gate; originals were not rewritten.
- Earlier interrupted serial runs are not counted as complete acceptance. The workspace restart removed their `/tmp` redirected logs/JSON and other temporary logs; surviving workspace reports were preserved. No lost temporary output is claimed as retained evidence.
- Final gate logs, exit markers, serial JSON and start/end fingerprints are written under ignored `.playwright/independent-batch/`, rather than `/tmp`. Parallel runs additionally keep their existing isolated per-run artifact paths.

At the final inventory check, `.playwright/` retained **38,157 files / 1,547,138,549 bytes**, including owned compiler caches relevant to the unresolved native loader failures. Root `test-results/` still retained **30 files / 11,587,770 bytes**. These caches were not deleted as “redundant” while their diagnostic value remained unresolved. The retained legacy marker hash still matches its original hash. Both final failed parallel runs preserve original evidence, JSON/HTML and any produced artifacts.

## Subsequent local-only cleanup

The subsequent cleanup began at synchronized `6b9201eefe9375b377404ee92a0211c3302077f4`.
New durable logs, scanner reports, exit markers, startup screenshot and code
fingerprints are under `.playwright/final-independent/`. Full parallel reports
continue to use owned per-invocation paths under `.playwright/runs/`.
The instrumented passing sweep, reproduced default-loader failure and
deliberately interrupted second default-loader sweep are retained separately
from the final compatibility-loader gates. Interrupted evidence is not a
complete gate even if its original status label remains `running`.
The inventory above is historical, not a count of the enlarged current set.
No historical failure reports, traces or caches were deleted by this cleanup.