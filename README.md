# Bakeland VRF Hub

Bakeland VRF Hub exists to make verifiable randomness reusable across the
Bakeland ecosystem.

Without a shared coordinator, every game or application has to repeat the same
work: deploy a program, manage MagicBlock VRF callbacks, avoid account-lock
contention, preserve fulfilled results, and checkpoint evidence back to Solana.
The Hub centralizes that coordination while keeping each application isolated.

One deployed program can register multiple apps. Every app receives its own
authority, lane pool, request history, and batch accumulator. Independent lanes
allow concurrent requests, while ordered batch roots provide a durable audit
anchor on Solana.

## What the Hub is—and is not

The Hub owns the randomness lifecycle:

- app registration and isolated PDA derivation;
- concurrent request lanes;
- authenticated MagicBlock VRF callbacks;
- atomic result consumption into an ordered batch root;
- delayed, recorded cancellation; and
- batched checkpointing from the Ephemeral Rollup to Solana.

The Hub intentionally does **not** decide rewards, move funds, grant inventory,
or define session and privacy policy. Those responsibilities remain with each
consumer application. This keeps the shared program narrow, auditable, and
useful to very different Bakeland apps without coupling their economic logic.

## Current status

- Devnet program: `3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd`
- Four concurrent lanes completed 104/104 calls across a real 100-result batch
  checkpoint and rollover.
- Fulfilled results cannot be released before they are folded into the app's
  ordered accumulator.
- App administration uses a two-step propose/accept transfer.
- Mainnet is **not deployed**. Governance, reproducible release builds,
  consumer integration safety, failure testing, a longer soak, and the planned
  lower-cost batch lifecycle remain before production.

## Start here

- [One-page overview](docs/VRF_HUB_ONE_PAGER.md) — the problem, architecture,
  proof, capacity, and cost shape in brief.
- [Instructions](Instructions.md) — build, deployment, app initialization,
  request lifecycle, test harnesses, and the remaining mainnet work.
- [Devnet evidence](docs/DEVNET_BATCH100_EVIDENCE_2026-10-21.md) — deployment,
  transaction, batch-root, and rollover evidence.
- [Program boundaries](docs/PROGRAM_BOUNDARIES.md) — why consumer economics,
  session keys, privacy, and payments stay outside the Hub.
- [Local testing notes](docs/LOCAL_TESTING.md) — detailed v2 behavior and the
  existing development harness.

## Validate the repository

The supported validation entry point runs native tests, strict Clippy, the
optimized SBF build, IDL generation, and program-ID consistency checks:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-vrf-hub.ps1
```

Build artifacts and all keypairs are ignored by Git. Deployment and upgrade
keys must come from the studio's approved secret-management process; never add
them to this repository.
