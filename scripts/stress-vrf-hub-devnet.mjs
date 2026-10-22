// The v2 stress path is the normal smoke lifecycle repeated across concurrent
// lanes. Results are consumed into the app's mandatory 100-entry accumulator.
process.env.LANE_COUNT ||= '4';
process.env.ITERATIONS ||= '25';

await import('./smoke-vrf-hub-devnet.mjs');
