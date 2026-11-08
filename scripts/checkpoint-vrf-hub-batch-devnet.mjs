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
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js');
const {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} = require('@magicblock-labs/ephemeral-rollups-sdk');

const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL is required.');

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd');
const APP_SEED = Buffer.from('vrf_app');
const BATCH_SEED = Buffer.from('vrf_batch');
const appDomain = process.env.APP_DOMAIN || 'bakeland:vrf-hub-devnet-keepalive:v3';
const appId = crypto.createHash('sha256').update(appDomain).digest();
const [app] = PublicKey.findProgramAddressSync([APP_SEED, appId], PROGRAM_ID);
const [batch] = PublicKey.findProgramAddressSync([BATCH_SEED, appId], PROGRAM_ID);
const payerPath = process.env.PAYER_KEYPAIR || path.join(os.homedir(), '.config', 'solana', 'id.json');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, 'utf8'))));
const base = new Connection(rpcUrl, 'confirmed');

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
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

function checkpointInstruction() {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: batch, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    ],
    data: discriminator('checkpoint_batch'),
  });
}

function commitAndUndelegateInstruction() {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: batch, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    ],
    data: discriminator('commit_and_undelegate_batch'),
  });
}

function advanceSessionInstruction() {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: app, isSigner: false, isWritable: false },
      { pubkey: batch, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([discriminator('advance_session'), appId]),
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

async function send(connection, instruction, label) {
  try {
    return await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer], {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
  } catch (error) {
    throw new Error(`${label} failed: ${error?.message || error}`, { cause: error });
  }
}

async function findErBatch(timeoutMs = 30_000) {
  const endpoints = [
    process.env.ER_ENDPOINT,
    'https://devnet-as.magicblock.app/',
    'https://devnet-eu.magicblock.app/',
    'https://devnet-us.magicblock.app/',
  ].filter(Boolean);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const endpoint of endpoints) {
      const connection = new Connection(endpoint, 'confirmed');
      try {
        const info = await connection.getAccountInfo(batch, 'confirmed');
        if (info) return { endpoint, connection, info };
      } catch {
        // Try the next ER while delegation propagates.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Batch was not readable through a public devnet ER.');
}

async function waitForBaseOwnership(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await base.getAccountInfo(batch, 'confirmed');
    if (info?.owner.equals(PROGRAM_ID)) return info;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error('Committed batch did not return to base-layer program ownership.');
}

async function waitForNextErCheckpoint(expected, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await findErBatch(5_000);
    const state = decodeBatch(current.info.data);
    if (
      !state.sealed
      && state.entryCount === 0
      && state.batchIndex === expected.batchIndex + 1n
      && state.totalEntries === expected.totalEntries
      && state.sessionCommits === expected.sessionCommits + 1
      && state.globalRoot.equals(expected.globalRoot)
    ) {
      return { ...current, state };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Keepalive checkpoint did not open the expected next ER checkpoint.');
}

const er = await findErBatch();
const erState = decodeBatch(er.info.data);
if (!erState.sealed) {
  throw new Error(`Batch ${erState.batchIndex} is not sealed (${erState.entryCount}/100 entries).`);
}

if (erState.sessionCommits < 9) {
  const signature = await send(er.connection, checkpointInstruction(), 'keepalive checkpoint');
  const next = await waitForNextErCheckpoint(erState);
  console.log(JSON.stringify({
    phase: 'checkpoint-kept-alive',
    endpoint: new URL(next.endpoint).host,
    batch: batch.toBase58(),
    committedBatchIndex: erState.batchIndex.toString(),
    nextBatchIndex: next.state.batchIndex.toString(),
    sessionCommits: next.state.sessionCommits,
    totalEntries: next.state.totalEntries.toString(),
    globalRootHex: next.state.globalRoot.toString('hex'),
    signature,
  }));
  process.exit(0);
}

if (erState.sessionCommits !== 9) {
  throw new Error(`Unexpected session commit count ${erState.sessionCommits}; expected 0-9.`);
}

const commitSignature = await send(er.connection, commitAndUndelegateInstruction(), 'commit and undelegate batch');
console.log(JSON.stringify({
  phase: 'checkpoint-submitted',
  endpoint: new URL(er.endpoint).host,
  batch: batch.toBase58(),
  batchIndex: erState.batchIndex.toString(),
  entries: erState.entryCount,
  sessionCommits: erState.sessionCommits + 1,
  batchRootHex: erState.batchRoot.toString('hex'),
  globalRootHex: erState.globalRoot.toString('hex'),
  signature: commitSignature,
}));

const committedInfo = await waitForBaseOwnership();
const committedState = decodeBatch(committedInfo.data);
if (
  !committedState.sealed
  || committedState.sessionCommits !== 10
  || !committedState.batchRoot.equals(erState.batchRoot)
  || !committedState.globalRoot.equals(erState.globalRoot)
) {
  throw new Error('Base-layer checkpoint does not match the sealed ER batch.');
}

const advanceSignature = await send(base, advanceSessionInstruction(), 'advance session');
const delegateSignature = await send(base, delegateBatchInstruction(), 'delegate next batch');
const next = await findErBatch();
const nextState = decodeBatch(next.info.data);
if (
  nextState.sealed
  || nextState.entryCount !== 0
  || nextState.sessionCommits !== 0
  || nextState.batchIndex !== erState.batchIndex + 1n
) {
  throw new Error('Next delegation session did not open with the expected empty state.');
}

console.log(JSON.stringify({
  phase: 'checkpoint-confirmed',
  committedBatchIndex: committedState.batchIndex.toString(),
  nextBatchIndex: nextState.batchIndex.toString(),
  totalEntries: nextState.totalEntries.toString(),
  sessionCommits: nextState.sessionCommits,
  globalRootHex: nextState.globalRoot.toString('hex'),
  advanceSignature,
  delegateSignature,
}));

process.exit(0);
