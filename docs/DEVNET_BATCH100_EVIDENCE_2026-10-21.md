# VRF Hub v2 devnet deployment and batch proof

Date: 21 October 2026
Network: Solana devnet + MagicBlock devnet ER
Program: `3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd`

## Result

The fresh v2 program was deployed from the same optimized artifact that passed
the local validation suite. Four lanes then completed 25 concurrent rounds:
100 requests were submitted, 100 were fulfilled, every result was consumed,
and every lane returned to idle. The accumulator sealed automatically at
100/100.

The sealed root was committed from the ER to Solana, verified byte-for-byte,
advanced to batch 1, and delegated again. Four more concurrent calls completed
in batch 1. The observed total is therefore 104 successful devnet VRF calls
across a real batch rollover.

## Deployment proof

- Release binary size: `362344` bytes
- Local and downloaded onchain SHA-256:
  `832B8A0F0C9C3CCE913E8AA0C7FBD85E86E778D77E24CDF71BD89E58DEE0C3DE`
- ProgramData account: `GbwgAanGLRX4hcXuAMzj9jS1fkd1cgz7PkoM2m26Eu3F`
- Deployment slot: `513358239`
- Deployment transaction:
  `5KMFhMgYoiG9ZAvgqvzJBGXdM8Jgi1fB7JCeDsKSZFApfzuE4wXYKozB815DnSsbUyQnqUHLiPk9FwWJxzCdGmon`
- Validation: six native tests passed, strict Clippy passed, optimized SBF build
  passed, and the downloaded program hash matched the local artifact.

## Batch 0 proof

- App PDA: `8B5XMP6abZ2uH9bvFApUiokcoMxtPwefJWxeUBRrgcu2`
- Batch PDA: `AtjbN8YYBBVXRYDQiHF5zydRmn9HxCroQkLWKZGbwv1v`
- Entries: `100`
- Batch root:
  `17fdf5ddcfd8c9327b3ee0df08f97d63fa6bf5f21d0c9ce02e2412eb126f21ad`
- Chained global root:
  `6f70411a66f552c583f1334d5802cf362e23562541bff6914440a65a5146d65f`
- First observed request transaction:
  `3NHV13BCDcZwu84xkhLkHAzNW6m3pEnSkczhwvBpapJYVHVUCYQphwBetfpQyMrnxNcEgcpSToU6FXChVKXUYBJ1`
- Final batch-0 consumption transaction:
  `2sUwTTMgST24U8GeaRaXXsQjXMfaRnNofLj3hiQMzJYSR98z9xShKfJrGzRB5FmoaULGMqwrdZ73BYSLfFaqffMN`
- Commit-and-undelegate transaction:
  `66ERwsuVnRaustwCr2xArVv2rbdBG52uULw9wkrkgJ5yit1LauJkjLfb4XxJ8DRkSYmGJuEjfnoMB3b4gnuCcKvL`
- Advance-to-batch-1 transaction:
  `2yKi49QZv6BktXme6KvT7RqcGX8vKjxp3pKSB26S68dTtgAcKTMbKqbgtfwtzDsbbZGL4HEsiZipEzh95E716H5X`
- Batch-1 delegation transaction:
  `4mKCFn1dpEvn77xTNNiJu9tjweVNhW6EqLKByY9auGt3XwPTi8dfQgBZPmUnZ1Dt7QfqbqCkdYv4FHbzC6xrJ7nX`

## Rollover proof

Batch 1 opened with the batch-0 global root intact and `totalEntries = 100`.
The next four concurrent requests all fulfilled and were consumed:

- Batch index: `1`
- Batch entries after proof round: `4`
- Total entries: `104`
- Batch-1 root:
  `be13e46745f3ae29cce7dbde07c57cbd3a1df7ad88ce0061a4e7b4532e4da7ab`
- Example request transaction:
  `4BkB35X1rqkWthPTA8oJAZBhHGWjkxae6ZvPHPCxtV2rBgmQaRvB6oFTMPufuZFBxyXA62EJ4MQHyerAVbvDbngo`
- Matching consumption transaction:
  `57Pwe34CTyPY7QgLnyWJcUPpyxroHDqsTjp3xBXsAYFuHYLocDXcduUM1uSL7jyzaJKVdqBeTE4434PGUWDGpgzS`

All listed deployment, setup, checkpoint, rollover, and sampled ER transactions
were re-queried after the run and reported `Finalized`.

## What this proves

The v2 design removes the dangerous gap in which fulfilled randomness could be
cleared without durable accounting. It also demonstrates that checkpointing is
amortized across 100 outcomes: only the accumulator crosses back to Solana,
while the independent request lanes remain available on the ER. App isolation,
ordered hash chaining, exact automatic sealing, and continued service after a
checkpoint are all exercised by this run.

This is strong functional devnet evidence, not a production soak or security
audit. Mainnet still requires governed authorities, final dependency/toolchain
alignment, failure-injection testing, and a longer higher-lane load run.
