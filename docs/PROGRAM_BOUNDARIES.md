# Bakeland onchain program boundaries

## Recommended deployment model

Use one repository and release process if convenient, but keep independently
auditable concerns as standalone programs. Program-deployment rent is not a
good reason to combine unrelated authorities and state transitions.

### Bakeland VRF Hub

Bakeland-owned standalone program. It registers apps, coordinates concurrent
MagicBlock VRF requests, authenticates callbacks, and exposes raw fulfilled
randomness. It must not decide loot, move funds, or grant inventory.

### Consumer programs

App-owned programs interpret randomness and enforce app-specific invariants.
Examples include paid lootbox settlement, a raffle, combat rolls, or procedural
generation. A consumer may use the same VRF Hub without sharing writable state
with other apps.

### Session Keys

MagicBlock already deploys the standalone Session Keys program at:

```text
KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5
```

Bakeland does not need to redeploy that program. Consumer programs that accept
user session signatures add the `session-keys` crate and validate the external
session token in their own instructions. Session duration, allowed instructions,
spend caps, and revocation belong to each consumer's policy.

The VRF Hub currently accepts only its registered operator. This is appropriate
for backend-sponsored randomness and avoids putting user authorization policy in
the shared hub. If direct user VRF requests are later required, add a narrowly
scoped authorization adapter after defining its abuse and fee model; do not make
the hub a general wallet/session authority.

### Private transactions and state

MagicBlock Private Ephemeral Rollups use existing standalone infrastructure:

```text
Permission Program: ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1
Delegation Program: DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
TEE validator:       MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo
```

A Bakeland program that owns private state adds permission and delegation CPIs,
then delegates the relevant state accounts to the TEE validator. This normally
requires an upgrade or deployment of that app's consumer program, but not a new
Bakeland privacy-infrastructure program.

Private SPL payments are a separate asset-custody concern. Prefer MagicBlock's
Private Payments API and Ephemeral SPL Token reference flow, or a separately
audited Bakeland payment program if product requirements exceed that API. Never
place private token custody inside the VRF Hub.

## Why these should not be combined

- Different trust boundaries: randomness, delegated authorization, privacy ACLs,
  and token custody fail in different ways.
- Smaller audit surface and lower upgrade blast radius.
- Independent authorities can be transferred or made immutable on different
  schedules.
- Consumer apps can adopt only the capabilities they need.
- A VRF upgrade cannot accidentally change payment or privacy semantics.
- Existing MagicBlock infrastructure programs are shared dependencies and do
  not need to be copied into Bakeland deployments.

Combining ER delegation hooks and private ACL calls inside a consumer program is
normal because that program owns the state being delegated. Combining those
generic infrastructure implementations into the VRF Hub is not.
