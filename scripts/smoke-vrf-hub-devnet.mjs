import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeProject = process.env.BAKELAND_NODE_PROJECT;
if (!nodeProject) throw new Error('BAKELAND_NODE_PROJECT must point to a Node project with Solana and MagicBlock dependencies.');
const require = createRequire(path.join(nodeProject, 'package.json'));

const {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js');
const {
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} = require('@magicblock-labs/ephemeral-rollups-sdk');

const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL is required.');

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd');
const VRF_PROGRAM_ID = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const ORACLE_QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
const APP_SEED = Buffer.from('vrf_app');
const LANE_SEED = Buffer.from('vrf_lane');
const BATCH_SEED = Buffer.from('vrf_batch');
const IDENTITY_SEED = Buffer.from('identity');
const TARGET_CLUSTER = process.env.TARGET_CLUSTER || 'devnet';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
if (TARGET_CLUSTER === 'mainnet-beta' && process.env.CONFIRM_MAINNET !== 'RUN_BAKELAND_VRF_CANARY') {
  throw new Error('Set CONFIRM_MAINNET=RUN_BAKELAND_VRF_CANARY for a mainnet canary.');
}
const LANE_COUNT = Math.min(8, Math.max(1, Number(process.env.LANE_COUNT) || 3));
const LANE_START = Math.max(0, Number(process.env.LANE_START) || 0);
const ITERATIONS = Math.max(1, Number(process.env.ITERATIONS) || 1);
const FULFILL_TIMEOUT_MS = Math.max(10_000, Number(process.env.FULFILL_TIMEOUT_MS) || 45_000);
const payerPath = process.env.PAYER_KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, 'utf8'))));
const base = new Connection(rpcUrl, 'confirmed');

const appDomain = process.env.APP_DOMAIN || 'bakeland:vrf-hub-devnet-keepalive:v3';
const appId = crypto.createHash('sha256').update(appDomain).digest();
const [app] = PublicKey.findProgramAddressSync([APP_SEED, appId], PROGRAM_ID);
const [batch] = PublicKey.findProgramAddressSync([BATCH_SEED, appId], PROGRAM_ID);
const [programIdentity] = PublicKey.findProgramAddressSync([IDENTITY_SEED], PROGRAM_ID);

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function initializeAppInstruction() {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: app, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      discriminator('initialize_app'),
      appId,
      payer.publicKey.toBuffer(),
      u16(LANE_COUNT),
    ]),
  });
}

function laneAddress(laneId) {
  return PublicKey.findProgramAddressSync([LANE_SEED, appId, u16(laneId)], PROGRAM_ID)[0];
}

function initializeLaneInstruction(laneId, lane) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: app, isSigner: false, isWritable: false },
      { pubkey: lane, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('initialize_lane'), appId, u16(laneId)]),
  });
}

function initializeBatchInstruction() {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: app, isSigner: false, isWritable: false },
      { pubkey: batch, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('initialize_batch'), appId]),
  });
}

function delegateLaneInstruction(laneId, lane) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: app, isSigner: false, isWritable: false },
      { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(lane, PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(lane), isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(lane), isSigner: false, isWritable: true },
      { pubkey: lane, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('delegate_lane'), appId, u16(laneId)]),
  });
}

function delegateBatchInstruction() {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: app, isSigner: false, isWritable: false },
      { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(batch, PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(batch), isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(batch), isSigner: false, isWritable: true },
      { pubkey: batch, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('delegate_batch'), appId]),
  });
}

function requestInstruction(lane, requestId, clientSeed) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: lane, isSigner: false, isWritable: true },
      { pubkey: ORACLE_QUEUE, isSigner: false, isWritable: true },
      { pubkey: programIdentity, isSigner: false, isWritable: false },
      { pubkey: VRF_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('request_randomness_er'), requestId, clientSeed]),
  });
}

function consumeResultInstruction(lane, requestId, nonce) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: lane, isSigner: false, isWritable: true },
      { pubkey: batch, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([discriminator('consume_result_er'), requestId, u64(nonce)]),
  });
}

function decodeLane(data) {
  if (!data || data.length < 229) throw new Error(`Invalid lane data length: ${data?.length ?? 0}`);
  return {
    appId: Buffer.from(data.subarray(40, 72)),
    authority: new PublicKey(data.subarray(72, 104)),
    enabled: data[104] !== 0,
    laneId: data.readUInt16LE(105),
    state: data[107],
    nonce: data.readBigUInt64LE(108),
    requestId: Buffer.from(data.subarray(116, 148)),
    randomness: Buffer.from(data.subarray(180, 212)),
  };
}

function decodeBatch(data) {
  if (!data || data.length < 189) throw new Error(`Invalid batch data length: ${data?.length ?? 0}`);
  return {
    batchIndex: data.readBigUInt64LE(104),
    entryCount: data.readUInt16LE(112),
    totalEntries: data.readBigUInt64LE(114),
    batchRoot: Buffer.from(data.subarray(122, 154)),
    globalRoot: Buffer.from(data.subarray(154, 186)),
    sessionCommits: data[186],
    sealed: data[187] !== 0,
  };
}

async function send(connection, instruction) {
  return sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
}

async function findEr(lanes) {
  const endpoints = TARGET_CLUSTER === 'mainnet-beta'
    ? [process.env.ER_ENDPOINT, 'https://mainnet.magicblock.app/'].filter(Boolean)
    : [process.env.ER_ENDPOINT, 'https://devnet-as.magicblock.app/', 'https://devnet-eu.magicblock.app/',
      'https://devnet-us.magicblock.app/'].filter(Boolean);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const endpoint of endpoints) {
      const connection = new Connection(endpoint, 'confirmed');
      try {
        const infos = await connection.getMultipleAccountsInfo(lanes, 'confirmed');
        if (infos.every(Boolean)) return { endpoint, connection };
      } catch {
        // Delegation propagation or endpoint transient; try the next endpoint.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Delegated lanes did not appear on a public devnet ER within 30 seconds.');
}

async function waitForResults(connection, expected) {
  const deadline = Date.now() + FULFILL_TIMEOUT_MS;
  const results = new Map();
  while (Date.now() < deadline && results.size < expected.length) {
    const infos = await connection.getMultipleAccountsInfo(expected.map(item => item.lane), 'confirmed');
    infos.forEach((info, index) => {
      if (!info || results.has(index)) return;
      const lane = decodeLane(info.data);
      if (lane.state === 2 && lane.requestId.equals(expected[index].requestId)) {
        results.set(index, lane);
      }
    });
    if (results.size < expected.length) await new Promise(resolve => setTimeout(resolve, 150));
  }
  return results;
}

const lanes = Array.from({ length: LANE_COUNT }, (_, index) => {
  const laneId = LANE_START + index;
  return { laneId, lane: laneAddress(laneId) };
});
const genesis = await base.getGenesisHash();
const expectedGenesis = TARGET_CLUSTER === 'mainnet-beta' ? MAINNET_GENESIS : DEVNET_GENESIS;
if (genesis !== expectedGenesis) throw new Error(`RPC genesis ${genesis} does not match ${TARGET_CLUSTER}.`);
if (!(await base.getAccountInfo(app, 'confirmed'))) {
  const signature = await send(base, initializeAppInstruction());
  console.log(JSON.stringify({ phase: 'initialize-app', signature, app: app.toBase58() }));
}

if (!(await base.getAccountInfo(batch, 'confirmed'))) {
  const signature = await send(base, initializeBatchInstruction());
  console.log(JSON.stringify({ phase: 'initialize-batch', signature, batch: batch.toBase58() }));
}

for (const item of lanes) {
  const info = await base.getAccountInfo(item.lane, 'confirmed');
  if (!info) {
    const signature = await send(base, initializeLaneInstruction(item.laneId, item.lane));
    console.log(JSON.stringify({ phase: 'initialize-lane', laneId: item.laneId, signature, lane: item.lane.toBase58() }));
  }
}

for (const item of lanes) {
  const info = await base.getAccountInfo(item.lane, 'confirmed');
  if (info?.owner.equals(PROGRAM_ID)) {
    const signature = await send(base, delegateLaneInstruction(item.laneId, item.lane));
    console.log(JSON.stringify({ phase: 'delegate-lane', laneId: item.laneId, signature, lane: item.lane.toBase58() }));
  } else if (!info?.owner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error(`Lane ${item.laneId} has unexpected owner ${info?.owner?.toBase58() ?? 'missing'}.`);
  }
}


const batchInfo = await base.getAccountInfo(batch, 'confirmed');
if (batchInfo?.owner.equals(PROGRAM_ID)) {
  const signature = await send(base, delegateBatchInstruction());
  console.log(JSON.stringify({ phase: 'delegate-batch', signature, batch: batch.toBase58() }));
} else if (!batchInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
  throw new Error(`Batch has unexpected owner ${batchInfo?.owner?.toBase58() ?? 'missing'}.`);
}

const er = await findEr([...lanes.map(item => item.lane), batch]);
console.log(JSON.stringify({ phase: 'er-ready', endpoint: new URL(er.endpoint).host, lanes: LANE_COUNT }));

const testRun = crypto.randomBytes(16).toString('hex');
let completedIterations = 0;
let fulfilledTotal = 0;
let finalBatchState = null;

for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  const beforeBatch = decodeBatch((await er.connection.getAccountInfo(batch, 'confirmed')).data);
  if (beforeBatch.sealed) break;
  const remainingCapacity = 100 - beforeBatch.entryCount;
  const iterationLanes = lanes.slice(0, Math.min(lanes.length, remainingCapacity));
  const expected = iterationLanes.map(item => ({
    ...item,
    requestId: crypto.createHash('sha256').update(`bakeland-vrf-smoke:${testRun}:${iteration}:${item.laneId}`).digest(),
    clientSeed: crypto.randomBytes(32),
  }));

  for (const item of expected) {
    const lane = decodeLane((await er.connection.getAccountInfo(item.lane, 'confirmed')).data);
    if (lane.state !== 0) throw new Error(`Lane ${item.laneId} is not idle (state ${lane.state}); reconcile it before rerunning.`);
  }

  const submittedAt = Date.now();
  const requestSignatures = await Promise.all(expected.map(async item => ({
    laneId: item.laneId,
    signature: await send(er.connection, requestInstruction(item.lane, item.requestId, item.clientSeed)),
  })));

  const results = await waitForResults(er.connection, expected);
  fulfilledTotal += results.size;
  const fulfilled = expected.map((item, index) => {
    const lane = results.get(index);
    return {
      laneId: item.laneId,
      fulfilled: Boolean(lane),
      nonce: lane?.nonce?.toString() ?? null,
      requestIdHex: item.requestId.toString('hex'),
      randomnessHex: lane?.randomness?.toString('hex') ?? null,
    };
  });

  if (results.size !== expected.length) {
    console.log(JSON.stringify({
      phase: 'iteration-failed',
      iteration,
      elapsedMs: Date.now() - submittedAt,
      requests: requestSignatures,
      results: fulfilled,
    }));
    process.exitCode = 2;
    break;
  }

  const consumptions = [];
  if (process.env.KEEP_RESULTS !== '1') {
    for (let index = 0; index < expected.length; index += 1) {
      const item = expected[index];
      const lane = results.get(index);
      consumptions.push({
        laneId: item.laneId,
        signature: await send(er.connection, consumeResultInstruction(item.lane, item.requestId, lane.nonce)),
      });
    }
  }

  const after = await er.connection.getMultipleAccountsInfo(lanes.map(item => item.lane), 'confirmed');
  const allIdle = process.env.KEEP_RESULTS === '1'
    ? false
    : after.every(info => info && decodeLane(info.data).state === 0);
  finalBatchState = decodeBatch((await er.connection.getAccountInfo(batch, 'confirmed')).data);
  completedIterations += 1;
  console.log(JSON.stringify({
    phase: 'iteration-complete',
    iteration,
    elapsedMs: Date.now() - submittedAt,
    allIdle,
    requests: requestSignatures,
    results: fulfilled,
    consumptions,
    batch: {
      address: batch.toBase58(),
      batchIndex: finalBatchState.batchIndex.toString(),
      entryCount: finalBatchState.entryCount,
      totalEntries: finalBatchState.totalEntries.toString(),
      sessionCommits: finalBatchState.sessionCommits,
      sealed: finalBatchState.sealed,
      batchRootHex: finalBatchState.batchRoot.toString('hex'),
    },
  }));
  if (process.env.KEEP_RESULTS !== '1' && !allIdle) {
    process.exitCode = 3;
    break;
  }
  if (finalBatchState.sealed) break;
}

console.log(JSON.stringify({
  phase: 'stress-summary',
  lanes: LANE_COUNT,
  requestedIterations: ITERATIONS,
  completedIterations,
  fulfilledTotal,
  finalBatch: finalBatchState && {
    address: batch.toBase58(),
    batchIndex: finalBatchState.batchIndex.toString(),
    entryCount: finalBatchState.entryCount,
    totalEntries: finalBatchState.totalEntries.toString(),
    sessionCommits: finalBatchState.sessionCommits,
    sealed: finalBatchState.sealed,
    batchRootHex: finalBatchState.batchRoot.toString('hex'),
  },
}));

process.exit(process.exitCode || 0);
