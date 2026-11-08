# VRF Hub instructions

This guide covers the supported development and devnet workflow for Bakeland
VRF Hub, how a consumer app uses it, and the work that remains before a mainnet
release.

The current deployment is a validated devnet integration, not a permissionless
production service. Treat all mainnet steps below as release gates rather than
evidence that the program is already approved for production.

## 1. Prerequisites

The repository currently targets:

- Rust `1.89` through `rust-toolchain.toml`;
- Solana/Agave CLI with the SBF toolchain;
- Anchor CLI compatible with `anchor-lang = 1.0.2`;
- Node.js for the devnet harnesses; and
- an existing Node project containing the Solana and MagicBlock JavaScript
  packages used by the scripts.

The test harness deliberately reuses dependencies from that external Node
project. This repository therefore does not duplicate a package tree or store
RPC credentials.

## 2. Build and validate

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-vrf-hub.ps1
```

The validation script runs:

1. native Rust tests;
2. strict Clippy checks;
3. the optimized SBF build;
4. IDL and TypeScript type generation; and
5. consistency checks between the compiled program, `declare_id!`, and an
   optional `PROGRAM_KEYPAIR`.

Expected generated artifacts:

```text
target/deploy/bakeland_vrf_hub.so
target/idl/bakeland_vrf_hub.json
target/types/bakeland_vrf_hub.ts
```

If validating a specific deployment identity, point `PROGRAM_KEYPAIR` at the
approved local keypair before running the script:

```powershell
$env:PROGRAM_KEYPAIR='C:\secure\path\vrf-hub-program-keypair.json'
powershell -ExecutionPolicy Bypass -File .\scripts\test-vrf-hub.ps1
```

Never copy a payer, buffer, program, or upgrade-authority keypair into the
repository.

## 3. Deploy a reviewed build

The validated devnet deployment remains:

```text
3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd
```

The checked-in production program identity is:

```text
7RmytTQ3nCN635ivpELmJQqqMK7LcALSZRi1qbqNGw8F
```

For a fresh deployment:

1. obtain the intended program and upgrade-authority keys through approved
   secret management;
2. confirm the target cluster explicitly;
3. update and revalidate `declare_id!`, `Anchor.toml`, and the program keypair
   as one release change if the program address changes;
4. run the complete validation script against the exact release source;
5. record the SHA-256 of `target/deploy/bakeland_vrf_hub.so`; and
6. deploy that unchanged binary with the approved authority.

Example devnet deployment command after those checks:

```powershell
solana config set --url devnet
solana program deploy .\target\deploy\bakeland_vrf_hub.so `
  --program-id C:\secure\path\vrf-hub-program-keypair.json `
  --upgrade-authority C:\secure\path\upgrade-authority.json
```

Do not infer mainnet approval from the presence of a mainnet stanza in
`Anchor.toml`. Before any mainnet deployment, explicitly decide whether the
same address is intended and confirm that its key material, governance, and
release artifact have passed the mainnet gates below.

### Mainnet deployment inputs

Prepare these before changing the source program ID or funding deployment:

1. a **deployment wallet keypair** funded with the approved SOL budget;
2. a separate **program keypair** that fixes the permanent program address;
3. the initial **upgrade authority**, preferably the studio multisig rather
   than an individual hot wallet;
4. a production mainnet RPC endpoint that supports program deployment;
5. the approved app IDs, app admins/operators, lane counts, and operational
   fee payer; and
6. a release record containing the source commit, toolchain versions, binary
   size and SHA-256, program address, deployment transaction, and on-chain dump
   comparison.

The deployment wallet key alone is not sufficient: a fresh program also needs
its own program keypair. Do not send either private key in chat or store it in
the repository. Place key files in the approved local secret location, set
their filesystem permissions, and pass only their paths to the validation and
deployment commands.

At the currently validated 325,240-byte binary size, mainnet rent quoted on
6 November 2026 is about `1.6531 SOL` for ProgramData. A fresh deployment also
needs an upload buffer of roughly the same size until finalization, so the
wallet should have at least `3.35 SOL` available during deployment plus a small
fee margin. Buffer rent is returned after a successful deployment; it is
temporary liquidity, not permanent spend. A `2.3 SOL` operating budget can
still leave roughly `0.647 SOL` after permanent program rent, but cannot by
itself fund both accounts at the same moment.

After selecting the production program keypair, update `declare_id!`, both
`Anchor.toml` cluster entries, and script defaults; run the full validation
again because changing the program ID changes the release binary. Deploy the
exact resulting `.so`, dump it back from mainnet, and compare the meaningful
binary prefix byte-for-byte before initializing any app.

## 4. Register an application

Give each consumer a stable, versioned 32-byte `app_id`. A domain digest keeps
human-readable application names out of fixed-size PDA seeds while preventing
accidental reuse:

```text
SHA256("bakeland:game-client:v2")
SHA256("bakeland:ramen-rush:v2")
```

Initialize the app on Solana:

1. `initialize_app(app_id, operator, max_lanes)`
2. `initialize_lane(app_id, lane_id)` for every required concurrent lane
3. `initialize_batch(app_id)`
4. delegate each lane with `delegate_lane`
5. delegate the accumulator with `delegate_batch`

Relevant PDAs are isolated by `app_id`:

```text
App config:        ["vrf_app", app_id]
Randomness lane:   ["vrf_lane", app_id, lane_id]
Batch accumulator: ["vrf_batch", app_id]
```

The program permits up to 64 lanes per app. Start with the concurrency the app
actually needs; additional lanes increase account and operational overhead.

## 5. Request and consume randomness

On the Ephemeral Rollup:

1. select an idle lane;
2. call `request_randomness_er(request_id, client_seed)`;
3. wait for the authenticated `fulfill_randomness_er` callback;
4. call `consume_result_er(request_id, nonce)`; and
5. persist the consumer action associated with that request ID.

`consume_result_er` folds the outcome into the ordered app accumulator before
the lane returns to idle. A fulfilled result therefore cannot be cleared
without durable batch accounting.

A lane supports one unresolved request at a time. Applications gain concurrency
by distributing work across independent lanes rather than sharing one writable
request account.

If a request cannot complete, `cancel_pending_er` becomes available only after
the configured 150-slot delay. Cancellation is inserted into the same ordered
history and cannot silently erase a request.

## 6. Seal, checkpoint, and roll over batches

The accumulator seals every 100 entries. The first nine sealed checkpoints in
a session use `checkpoint_batch`: the root is committed while the accumulator
stays delegated, then the next 100-entry checkpoint opens immediately. On the
tenth checkpoint, `commit_and_undelegate_batch` publishes the final root and
returns the accumulator to Solana. The operator then:

1. verifies the Solana root matches the sealed ER root;
2. calls `advance_session(app_id)`; and
3. delegates the empty accumulator for the next 1,000-result session.

Request lanes remain delegated throughout. This lifecycle was validated on
devnet with 1,000 results across four concurrent lanes, ten checkpoints, a
clean rollover, and four post-rollover results.

## 7. Run the devnet harnesses

Set the external Node dependency project and RPC connection:

```powershell
$env:BAKELAND_NODE_PROJECT='C:\path\to\node-project'
$env:RPC_URL='<devnet RPC URL>'
$env:NODE_OPTIONS='--use-system-ca'
```

Optional settings include `PROGRAM_ID`, `PAYER_KEYPAIR`, `APP_DOMAIN`,
`ER_ENDPOINT`, `LANE_COUNT`, `ITERATIONS`, and `FULFILL_TIMEOUT_MS`.

Run one concurrent four-lane round:

```powershell
$env:LANE_COUNT='4'
$env:ITERATIONS='1'
node .\scripts\smoke-vrf-hub-devnet.mjs
```

Run the full 1,000-result keepalive lifecycle and post-rollover check:

```powershell
node .\scripts\stress-vrf-hub-devnet.mjs
```

Checkpoint the sealed root and open the next batch:

```powershell
node .\scripts\checkpoint-vrf-hub-batch-devnet.mjs
```

The compatibility entry point above runs the keepalive stress harness. Set a
stable `APP_DOMAIN` so an interrupted run can be inspected or resumed; use
`START_CHECKPOINT` only after confirming the current ER batch state. The
supplied harness accepts `LANE_COUNT` values from 2 through 8. Normal runs
should consume every result; `KEEP_RESULTS=1` is diagnostic only.

## 8. Consumer integration boundary

The Hub returns and commits raw randomness. A consumer program or trusted
backend must bind the request ID to the action being resolved and apply all
app-specific invariants, including:

- payment and price validation;
- loot-table or combat rules;
- inventory mutation;
- replay protection;
- authorization and session policy; and
- retention of the checkpointed batch root as an audit anchor.

Do not add token custody, generic wallet sessions, private-state permissions,
or game-specific reward tables to the Hub. See
[Program boundaries](docs/PROGRAM_BOUNDARIES.md) for the intended separation.

## 9. Mainnet refinement and release gates

The following work should be completed before the Hub is presented as a
mainnet-ready shared service.

### Consumer safety

- Define a safe consumer CPI or equally strong atomic integration so a result
  cannot be consumed without the intended application transition.
- Specify request ownership, replay protection, idempotency, and recovery for
  every consumer.
- Add app admission, lane quotas, and fee-payer limits before onboarding
  untrusted third parties.

### Batch lifecycle and economics

- Keep the 1,000-result keepalive lifecycle covered by release regression and
  longer multi-session soak tests.
- Verify recovery when a commit, undelegation, rollover, or redelegation is
  interrupted.
- Recalculate rent, Solana fees, ER fees, and operating cost using current
  MagicBlock pricing immediately before release.

### Governance and release integrity

- Move the upgrade authority and production app-admin roles to the approved
  multisig or governance process.
- Align the Anchor CLI and dependency toolchain with the reviewed release.
- Produce a reproducible build and verify the deployed binary against the
  reviewed artifact hash.
- Complete an independent security review focused on callback authentication,
  account constraints, authority transfer, cancellation, and batch rollover.

### Reliability and operations

- Run a longer soak with materially more concurrent lanes and multiple apps.
- Add failure-injection tests for RPC loss, delayed callbacks, duplicate
  delivery, stale lanes, ER restarts, checkpoint failure, and operator loss.
- Add monitoring for request age, lane saturation, callback failure, batch
  sealing, checkpoint lag, payer balance, and authority changes.
- Publish an incident, rollback, and upgrade procedure with named operators.

Mainnet approval should require all release gates to have dated evidence. The
current [keepalive evidence](docs/DEVNET_KEEPALIVE1000_EVIDENCE_2026-11-06.md)
proves the four-lane, 1,000-result session and rollover path; it is not a
security audit or permissionless production soak.
