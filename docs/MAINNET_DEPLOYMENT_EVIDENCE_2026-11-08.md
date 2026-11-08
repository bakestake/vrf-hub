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

## Scope still pending

No Bakeland app config, request lanes, batch accumulator, or ER delegations were
created as part of the program deployment. Those accounts should be initialized
only after the production app ID, lane count, operator, monitoring, and canary
plan are confirmed. The build also retains upstream SBF stack-frame diagnostics
from crypto dependency functions; the build succeeds and the lifecycle passed
the recorded devnet stress test, but this remains a security-review item.
