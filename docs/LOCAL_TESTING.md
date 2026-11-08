# Bakeland VRF Hub v2

`bakeland-vrf-hub` is a reusable MagicBlock VRF coordinator for Bakeland apps.
It is deliberately separate from the older `bakeland-lootbox-vrf` deployment,
so apps can migrate independently.

Current devnet program:

```text
3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd
```

The previous hub at `9GQHwUd8x7qti4asrBadTmgZb8nMBPtzQkcoTMcjEvL8`
is v1 test history and must not be used for new integrations.

## What v2 guarantees

- Every app has an isolated config PDA, reusable lane pool, and batch
  accumulator derived from its 32-byte `app_id`.
- Lanes can request and receive VRF concurrently. One lane permits one pending
  request, avoiding write-lock contention between independent calls.
- A fulfilled result cannot simply be released. `consume_result_er` verifies
  the exact request and nonce, folds the outcome into the app's batch root,
  and only then returns the lane to idle.
- Batches seal automatically at exactly 100 outcomes. The sealed root is
  committed to Solana while request lanes remain delegated and available.
- `advance_batch` opens the next accumulator while preserving a chained global
  root and total outcome count.
- Cancellation is delayed by at least 150 slots and is recorded as a batch
  leaf, so it cannot silently erase an outstanding request.
- App administration uses a two-step propose/accept transfer. The app operator
  and admin remain separate from the program upgrade authority.

Use a versioned domain digest for the `app_id`, for example:

```text
SHA256("bakeland:game-client:v2")
SHA256("bakeland:ramen-rush:v2")
```

## Lifecycle

On Solana:

1. `initialize_app(app_id, operator, max_lanes)`
2. `initialize_lane(app_id, lane_id)` for the desired concurrency
3. `initialize_batch(app_id)`
4. Delegate every lane and the batch accumulator

On the Ephemeral Rollup:

1. Select an idle lane.
2. Call `request_randomness_er(request_id, client_seed)`.
3. Wait for `fulfill_randomness_er` to mark the exact request fulfilled.
4. Call `consume_result_er(request_id, nonce)`. This atomically records the
   result in the batch and releases the lane.
5. Continue until the accumulator seals at 100 entries.

Checkpoint and rollover:

1. Call `commit_and_undelegate_batch` on the sealed ER batch.
2. Wait until the batch account returns to hub ownership on Solana.
3. Verify its batch root matches the sealed ER root.
4. Call `advance_batch(app_id)` on Solana.
5. Delegate the empty next batch. The lane pool remains live throughout.

## Build and validate

From the root of this repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-vrf-hub.ps1
```

The script runs native tests, strict Clippy, an optimized SBF build, and IDL
generation. Current artifacts are written to:

```text
target/deploy/bakeland_vrf_hub.so
target/idl/bakeland_vrf_hub.json
target/types/bakeland_vrf_hub.ts
```

The program uses `anchor-lang` 1.0.2. This workstation's system Anchor CLI is
0.32.1, which emits a version warning; the tested build and generated IDL are
still validated by the script. Align the CLI before a production build once
the matching platform tools are available through the team's trusted package
path.

## Devnet smoke and 100-request stress test

The scripts borrow installed Solana/MagicBlock JavaScript dependencies from an
existing Node project. They do not copy RPC credentials into this repository.

```powershell
$env:BAKELAND_NODE_PROJECT='C:\path\to\node-project'
$env:RPC_URL='<devnet RPC URL>'
$env:NODE_OPTIONS='--use-system-ca'

# One concurrent round using four lanes
$env:LANE_COUNT='4'
$env:ITERATIONS='1'
node .\scripts\smoke-vrf-hub-devnet.mjs

# Ten 100-entry checkpoints, final rollover, and post-rollover calls
node .\scripts\stress-vrf-hub-devnet.mjs

# Commit one sealed checkpoint; the tenth also rolls the session
node .\scripts\checkpoint-vrf-hub-batch-devnet.mjs
```

`LANE_COUNT` may be 2-8 in the supplied harness. `ITERATIONS` controls repeated
rounds. Keep it within the remaining capacity of the current batch; the script
stops automatically when the batch seals.

`KEEP_RESULTS=1` is a diagnostic option only. Normal runs must consume every
fulfilled result into the batch so lanes return to idle.

## Production boundary

The hub owns randomness coordination and durable outcome commitments, not game
economics. Loot tables, inventory writes, payments, session policy, and privacy
rules belong in each app's program/backend. An app should bind its own durable
action to the request ID and later retain the checkpointed batch root as its
audit anchor.

Before mainnet, move upgrade authority and app admin roles to the intended
governance/multisig, run a longer soak with more lanes and forced failure cases,
and deploy the exact reviewed binary. Current lifecycle evidence is in
`DEVNET_KEEPALIVE1000_EVIDENCE_2026-11-06.md`.
