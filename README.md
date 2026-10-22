# Bakeland VRF Hub

A reusable, multi-application MagicBlock VRF coordinator for Bakeland apps.
It isolates each app into its own configuration, lane pool, and durable batch
accumulator while sharing one program deployment.

## Current status

- Devnet program: `3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd`
- Four concurrent lanes completed 104/104 devnet calls across a real batch
  checkpoint and rollover.
- Fulfilled results cannot be released without first being folded into the
  app's ordered accumulator.
- Batches seal automatically at 100 entries.
- Mainnet is **not deployed**. A governed upgrade authority, reproducible
  verified build, security review, failure-injection tests, and longer soak are
  still required.

The current v2 checkpoint instruction commits and undelegates after each
100-entry batch. The proposed lower-cost production lifecycle—keepalive commits
every 100 entries and rotation after ten commits—is not implemented in this
revision and must be devnet-tested before mainnet.

## Design

- App config PDA: `['vrf_app', app_id]`
- Reusable lane PDA: `['vrf_lane', app_id, lane_id]`
- Batch accumulator PDA: `['vrf_batch', app_id]`
- One unresolved request per lane; separate lanes execute concurrently.
- Request seeds are domain-separated by program, app, lane, nonce, request ID,
  and caller seed.
- Cancellations require a 150-slot delay and are included in the batch history.
- App administration uses a two-step propose/accept transfer.

Game-specific loot tables, payments, inventory writes, session policies, and
privacy rules intentionally remain outside this hub.

## Validate

Requirements follow the current MagicBlock toolchain: Rust 1.89, Solana/Agave,
Anchor 1.0.2, and the Solana CLI.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-vrf-hub.ps1
```

The script runs native tests, strict Clippy, the optimized SBF build, IDL
generation, and program-ID consistency checks. Build artifacts and every
keypair are ignored by Git.

## Devnet test flow

The JavaScript harnesses load Solana and MagicBlock packages from an existing
Node project so this repository does not duplicate a package tree or contain
RPC credentials.

```powershell
$env:BAKELAND_NODE_PROJECT='C:\path\to\node-project'
$env:RPC_URL='<devnet RPC URL>'
$env:NODE_OPTIONS='--use-system-ca'

# One concurrent round
$env:LANE_COUNT='4'
$env:ITERATIONS='1'
node .\scripts\smoke-vrf-hub-devnet.mjs

# 25 rounds x 4 lanes = 100 results
node .\scripts\stress-vrf-hub-devnet.mjs

# Checkpoint the sealed batch and open the next one
node .\scripts\checkpoint-vrf-hub-batch-devnet.mjs
```

See [local testing](docs/LOCAL_TESTING.md),
[devnet evidence](docs/DEVNET_BATCH100_EVIDENCE_2026-10-21.md), and
[program boundaries](docs/PROGRAM_BOUNDARIES.md) for details.

## Secrets and deployment keys

Program-ID, buffer, payer, and upgrade-authority keypairs are never stored in
this repository. Maintainers must obtain them through the studio's approved
secret-management process before deployment or upgrade operations.
