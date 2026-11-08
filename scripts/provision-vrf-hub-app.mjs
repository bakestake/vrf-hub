import crypto from 'node:crypto';
import fs from 'node:fs';
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
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} = require('@magicblock-labs/ephemeral-rollups-sdk');

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const cluster = process.env.TARGET_CLUSTER || 'devnet';
const expectedGenesis = cluster === 'mainnet-beta' ? MAINNET_GENESIS : DEVNET_GENESIS;
if (cluster === 'mainnet-beta' && process.env.CONFIRM_MAINNET !== 'INITIALIZE_BAKELAND_VRF_HUB') {
  throw new Error('Set CONFIRM_MAINNET=INITIALIZE_BAKELAND_VRF_HUB for a mainnet initialization.');
}

const rpcUrl = process.env.RPC_URL;
const programIdText = process.env.PROGRAM_ID;
const appDomain = process.env.APP_DOMAIN;
const payerPath = process.env.PAYER_KEYPAIR;
if (!rpcUrl || !programIdText || !appDomain || !payerPath) {
  throw new Error('RPC_URL, PROGRAM_ID, APP_DOMAIN and PAYER_KEYPAIR are required.');
}
const maxLanes = Number(process.env.MAX_LANES || 1);
const laneCount = Number(process.env.LANE_COUNT || 1);
if (!Number.isInteger(maxLanes) || maxLanes < 1 || maxLanes > 64) throw new Error('MAX_LANES must be 1..64.');
if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > maxLanes) throw new Error('LANE_COUNT must be 1..MAX_LANES.');

const programId = new PublicKey(programIdText);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, 'utf8'))));
const base = new Connection(rpcUrl, 'confirmed');
const appId = crypto.createHash('sha256').update(appDomain).digest();
const u16 = value => { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; };
const discriminator = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const [app] = PublicKey.findProgramAddressSync([Buffer.from('vrf_app'), appId], programId);
const [batch] = PublicKey.findProgramAddressSync([Buffer.from('vrf_batch'), appId], programId);
const laneAddress = laneId => PublicKey.findProgramAddressSync([Buffer.from('vrf_lane'), appId, u16(laneId)], programId)[0];
const lanes = Array.from({ length: laneCount }, (_, laneId) => ({ laneId, address: laneAddress(laneId) }));
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const instruction = (name, keys, ...data) => new TransactionInstruction({
  programId,
  keys,
  data: Buffer.concat([discriminator(name), ...data]),
});
const send = ix => sendAndConfirmTransaction(base, new Transaction().add(ix), [payer], {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});

const genesis = await base.getGenesisHash();
if (genesis !== expectedGenesis) throw new Error(`RPC genesis ${genesis} does not match ${cluster}.`);
const program = await base.getAccountInfo(programId, 'confirmed');
if (!program?.executable) throw new Error(`Program ${programId.toBase58()} is not executable on ${cluster}.`);

const transactions = [];
const appInfo = await base.getAccountInfo(app, 'confirmed');
if (!appInfo) {
  const signature = await send(instruction('initialize_app', [
    meta(payer.publicKey, true, true), meta(app, false, true), meta(SystemProgram.programId),
  ], appId, payer.publicKey.toBuffer(), u16(maxLanes)));
  transactions.push({ phase: 'initialize-app', signature });
} else {
  if (!appInfo.owner.equals(programId) || appInfo.data.length !== 140 || !appInfo.data.subarray(8, 40).equals(appId)
      || !appInfo.data.subarray(40, 72).equals(payer.publicKey.toBuffer())) {
    throw new Error('Existing app config does not match this program, app ID, or admin.');
  }
  const existingMaxLanes = appInfo.data.readUInt16LE(136);
  if (existingMaxLanes < maxLanes) {
    const signature = await send(instruction('update_app', [meta(payer.publicKey, true), meta(app, false, true)],
      appId, Buffer.from([0]), Buffer.concat([Buffer.from([1]), u16(maxLanes)]), Buffer.from([0])));
    transactions.push({ phase: 'expand-app-lanes', from: existingMaxLanes, to: maxLanes, signature });
  }
}
if (!(await base.getAccountInfo(batch, 'confirmed'))) {
  const signature = await send(instruction('initialize_batch', [
    meta(payer.publicKey, true, true), meta(app), meta(batch, false, true), meta(SystemProgram.programId),
  ], appId));
  transactions.push({ phase: 'initialize-batch', signature });
}
for (const lane of lanes) {
  if (!(await base.getAccountInfo(lane.address, 'confirmed'))) {
    const signature = await send(instruction('initialize_lane', [
      meta(payer.publicKey, true, true), meta(app), meta(lane.address, false, true), meta(SystemProgram.programId),
    ], appId, u16(lane.laneId)));
    transactions.push({ phase: 'initialize-lane', laneId: lane.laneId, signature });
  }
}
for (const lane of lanes) {
  const info = await base.getAccountInfo(lane.address, 'confirmed');
  if (info?.owner.equals(programId)) {
    const signature = await send(instruction('delegate_lane', [
      meta(payer.publicKey, true, true), meta(app),
      meta(delegateBufferPdaFromDelegatedAccountAndOwnerProgram(lane.address, programId), false, true),
      meta(delegationRecordPdaFromDelegatedAccount(lane.address), false, true),
      meta(delegationMetadataPdaFromDelegatedAccount(lane.address), false, true),
      meta(lane.address, false, true), meta(programId), meta(DELEGATION_PROGRAM_ID), meta(SystemProgram.programId),
    ], appId, u16(lane.laneId)));
    transactions.push({ phase: 'delegate-lane', laneId: lane.laneId, signature });
  } else if (!info?.owner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error(`Lane ${lane.laneId} has unexpected owner ${info?.owner?.toBase58() || 'missing'}.`);
  }
}
const batchInfo = await base.getAccountInfo(batch, 'confirmed');
if (batchInfo?.owner.equals(programId)) {
  const signature = await send(instruction('delegate_batch', [
    meta(payer.publicKey, true, true), meta(app),
    meta(delegateBufferPdaFromDelegatedAccountAndOwnerProgram(batch, programId), false, true),
    meta(delegationRecordPdaFromDelegatedAccount(batch), false, true),
    meta(delegationMetadataPdaFromDelegatedAccount(batch), false, true),
    meta(batch, false, true), meta(programId), meta(DELEGATION_PROGRAM_ID), meta(SystemProgram.programId),
  ], appId));
  transactions.push({ phase: 'delegate-batch', signature });
} else if (!batchInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
  throw new Error(`Batch has unexpected owner ${batchInfo?.owner?.toBase58() || 'missing'}.`);
}

console.log(JSON.stringify({
  cluster,
  program: programId.toBase58(),
  appDomain,
  appId: appId.toString('hex'),
  admin: payer.publicKey.toBase58(),
  operator: payer.publicKey.toBase58(),
  maxLanes,
  app: app.toBase58(),
  batch: batch.toBase58(),
  lanes: lanes.map(lane => ({ laneId: lane.laneId, address: lane.address.toBase58() })),
  transactions,
}, null, 2));
