# Mainnet deployment evidence — 8 November 2026

Bakeland VRF Hub was deployed as a fresh production program on Solana
mainnet-beta. This deployment contains the 1,000-result keepalive lifecycle
validated on devnet; it is not the separate pooled/open-source service.

## Program and authority

- Program: `7RmytTQ3nCN635ivpELmJQqqMK7LcALSZRi1qbqNGw8F`
- ProgramData: `7mRUSRxNPevsHQy2aT7Yah6mxQ8THKNR71Ra8xfiZMZs`
- Initial upgrade authority: `4S9V2gcQoXib5Son4F5Fw7YN3ZcCTuVLXhFiyBKwnxbM`
- Deployment transaction: `GGpW3BM6gtWVjzWb8w6ZdTwSSc5yKtTjcyVcTLLPnSUj5pMtxhdSjh4NM1J2TSbBCCXDLuksMn3B6DKog3t3Tka`
- Deployment slot: `466874079`
- Source commit: `87bc09c`

## Artifact verification

- Local SBF length: `325240` bytes
- On-chain dump length: `325240` bytes
- Local SHA-256: `43EA24B405A6017C3D14217213FFCA30425FDE5CDDA96BD2BF31E03F9722D8AF`
- On-chain SHA-256: `43EA24B405A6017C3D14217213FFCA30425FDE5CDDA96BD2BF31E03F9722D8AF`
- First mismatching byte: none
- Trailing padding: none

The on-chain program is an exact byte-for-byte match with the validated release
artifact.

## Funding result

- Wallet balance before deployment: `3.370001 SOL`
- Wallet balance after deployment and buffer refund: `1.714353817 SOL`
- Net wallet reduction: `1.655647183 SOL`
- ProgramData rent: `1.65309804 SOL`
- Upload buffer: closed successfully and its rent was refunded

## Bakeland app initialization

The Bakeland app was initialized later on 8 November 2026 with the stable domain
`bakeland:game-client:v2` and two active lanes. Treasure-hunt pills and
dimensional-spore drops share one daily request on lane 0; paid lootbox
purchases use lane 1. Their gameplay outcomes are domain-separated after
fulfillment.

- App ID: `f93320526ec9ce081ef0750693c4c719cf536d3615c80a5362a4bf4b20455c00`
- App config: `6pL6xH2qJsoUdETHDnFNKFhq1q3bK6M2tPM723Vb5mWf`
- Lane 0: `Xb2h3vM4oU5tGAgPVgct5dYm84wodbHAiv5m4EwbQP8`
- Batch accumulator: `HKmf9CArTYMR4JjJ5k6fsALiQXvFuMXMCfKgXgbctt6Q`
- Initialize app: `3MxC9ghLAxXM7A3PG2CK4wTTGMHovPvFYVpoFuWHvW97kH6pWGyydZKhZbMGSshRXY5VcndU3J8jTNYvqVD7YEVd`
- Initialize batch: `43vfVFhC2w5cm8vgVcmstXDWAb7arFq9Tw12dbs8C94cadjQeu8pyPttDJUkCcoztGnihqe3WR6s23Z2UwDoQU28`
- Initialize lane: `2AcUGomA7o41N72f9P47FxGb8EQzJxCv216k7SEHLPBwrRrWfU4qKX13Qs6ZDpgjmern8xdoNATyAFMghxRK5PeC`
- Delegate lane: `2YiQkq3fYfaYPo9XwWdd7zEev1qpyAvVNzgbbQ8wNUAf9xhF9VPrHPRKZYHoBP7zpTMHPEwyJKUzf15m5qd2u5kE`
- Delegate batch: `iJu5rzdGZmJNWCFXd6oq5jJXT5hpD1F6J81G5PDqoAmvDUuEnMpPfsPb8JSpP1jAzJZTYUfXJRoKg1AhfFpyfD6`

A mainnet canary fulfilled in 1.824 seconds and was consumed into the accumulator:

- Request: `48QuJDng4TqMpjH1ySCv3PnLC6EqNdS5AE58bHkJ3En8w7bMmUG7pjfYGZGv18eYBRPcwrGXDzzKu92Yx3X2oLFs`
- Consume: `4vVieZU3nYTykj2yZNbStDgFfjWPx8Aggkgwe9gaeCpjmU1qsj7asihs6YhUnhxCuZHMA9mp9M6DyndSTkgqGeFj`
- Result: lane idle at nonce 1; batch index 0 has one entry.

## Paid-lootbox lane

The app capacity was expanded from one to two lanes. Lane 1 was initialized,
delegated and exercised independently while retaining the same batch
accumulator.

- Expand app to two lanes: `3D5XBpXg4Ev4cTLzQSCsuwFC4svFJHVcXQ2oGoPw3YuEvDQqmRrqASLoy89ziB2bxBQ7TZ4Jt3N2tkh2jXKLmzT`
- Lane 1: `ADAZsaCk643qQ22tHA9L9PV6WEJZb4EuUhVbfu53KAyV`
- Initialize lane 1: `49EQQi4eK3qhuwH8eLpvT64TRP9BfbiqMh4K9x8bUZGg9vAzQHZVPHJ2okRAbc2B4XHzBHm4mJ1c5bBfn7AiHAv1`
- Delegate lane 1: `5ATZZikVEq55UHxuhqXwhNTpZXiSLfzqSRDxRk7cpDP7pFES2N3X4dz3Ja4aQWh3dk2oN8dqWq4S6qih2R7gymNpL`
- Canary request: `3jEYgFtxoUUgStUhGRpfAXDei4hSVVJ5bhrr7smcyC5ynrvHgVLyy2cjWXCGcQspoy75vDJHEjGLxnQvqz5WX8vt`
- Canary consume: `rmAhyR5X3DPHhA4YyzsN8mQ2sG7b3AdkRPUHCEYYcM3MCLAB4H4gMR7aUbQQc9B5az7eWqNv2cjRuad9JvRXTF`
- Result: fulfilled in about 1.267 seconds; lane idle at nonce 1; shared batch index 0 has two entries.

The build retains upstream SBF stack-frame diagnostics from crypto dependency
functions; the build succeeds and the lifecycle passed the recorded devnet
stress test, but this remains a security-review item.
