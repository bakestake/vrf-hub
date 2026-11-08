# Keepalive lifecycle devnet evidence — 6 November 2026

The upgraded Bakeland VRF Hub was deployed in place on devnet at
`3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd`. This is an upgrade of the
existing Bakeland test deployment, not a duplicate program.

## Release artifact

- Final upgrade transaction: `o567kjAm1YmamUTEdam1Bajp32CBGyaLQXo2d7gUjW7rcju9WcqF2Sq1QP1G15vTmigq228cUQiKMs6kcPeHsd6`
- Deployment slot: `519298553`
- Optimized SBF length: `325240` bytes
- SHA-256: `77E38C5010303C23F4BEED83BD49BDD6F7A227EC93ECF85DA84B10BB71B94907`
- On-chain dump: exact binary prefix match; remaining program-data capacity was
  zero padding.
- Validation: six native tests, strict Clippy, optimized SBF build, and IDL
  generation passed.

## Lifecycle result

The test app `bakeland:vrf-hub-keepalive-stress-20261106-v3` used four lanes.
It fulfilled and consumed 1,000 VRF results while the batch accumulator stayed
in one delegated session. Every 100 results produced an ordered checkpoint;
the first nine kept the accumulator delegated and the tenth committed and
undelegated it.

- Batch PDA: `CRkkujHzANUU7g7itPEtVKupCdv9Swi8qpPRdG4wiwXG`
- Completed session: batch indexes `0` through `9`
- Completed results: `1000`
- Final global root: `d85d1edf308939f55f260095b24fea93a3cb4028c9f8a34bf42091e725c60211`
- Final commit and undelegate: `3bBwWWPRAJ1whHJGvUpE5P5557FywGXA5w2rVnMd3rNGAvPZ7W2FxszQhPsYENyjf2daprETvAZcGeTkfqsmGAQt`
- Advance next session: `kbtFe111vJeN5YkstjeEiqCqdT1RGWMpPX4MqxpvSdTGwA7JWix3gsgdjbUTMrCb8toGbZ4jKo4Jdrc4ywftyCK`
- Redelegate next session: `5EhJjvo3mEVk5Bfr5abzVrN5LZtbyrur1p1WwSn6S2gNM8gVRfeGFgs1navk2Xy8Vc52JQReYQb6dDLLNssAeg58`

After rollover, four more concurrent calls fulfilled and were consumed. The
new session reported batch index `10`, `totalEntries=1004`,
`sessionCommits=0`, and all four lanes idle. Sample post-rollover request
transactions:

- lane 0: `5AjcYzXRZNBCxusZWnFBRvJX4ZL5KkT6z2w8evdgK1QFCcoC2cB7m2HXbbGJaNqz67j9gLBdTUjwJoS1YqNwjoqW`
- lane 1: `DbPExaR5UCJgdPQWL2VBffRpg5SCgY9mxQDS45rCcQJmqCb6VhTJiXaT4FZX2mYxHUvQuwY9cqBxz5zuDxkwzC6`
- lane 2: `2z86NLTgMMNHLKGZYbqjHYBvFJhT8fAikCnzseKd4k82mndZB6aEQwkp3NRqRFxv5s6tMgouNzbsPdsMcT8ANDPg`
- lane 3: `416NWnfVmmCbUFQ1i2aEPTVDjyV5TYHUPYR6fxMXBqakCozpxYssfntuRz4AKnggJK3gL8TM2aQuiAXQMH9DDbxr`

This proves the lower-cost lifecycle and rollover mechanics on devnet. It does
not replace an independent security review, failure-injection campaign, or
production authority controls.
