#![allow(unexpected_cfgs)]
// Anchor's generated entrypoint contains intentional diverging expressions.
#![allow(clippy::diverging_sub_expression)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    anchor::{commit, delegate, ephemeral, vrf, vrf_callback},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};
use solana_sha256_hasher::hashv;

declare_id!("7RmytTQ3nCN635ivpELmJQqqMK7LcALSZRi1qbqNGw8F");

pub const APP_SEED: &[u8] = b"vrf_app";
pub const LANE_SEED: &[u8] = b"vrf_lane";
pub const BATCH_SEED: &[u8] = b"vrf_batch";
pub const REQUEST_DOMAIN: &[u8] = b"bakeland-vrf-hub:request:v2";
pub const RESULT_DOMAIN: &[u8] = b"bakeland-vrf-hub:result:v2";
pub const BATCH_DOMAIN: &[u8] = b"bakeland-vrf-hub:batch:v2";
pub const GLOBAL_DOMAIN: &[u8] = b"bakeland-vrf-hub:global:v2";
pub const MAX_LANES_PER_APP: u16 = 64;
pub const BATCH_SIZE: u16 = 100;
/// Nine keepalive commits followed by one final commit-and-undelegate keep a
/// delegation session within MagicBlock's ten-commit limit.
pub const CHECKPOINTS_PER_SESSION: u8 = 10;
pub const RESULTS_PER_SESSION: u64 = BATCH_SIZE as u64 * CHECKPOINTS_PER_SESSION as u64;
/// A cancelled request is committed to the batch like any other result. The
/// delay prevents an operator from cheaply discarding a request immediately.
pub const MIN_CANCEL_DELAY_SLOTS: u64 = 150;

pub const LANE_IDLE: u8 = 0;
pub const LANE_PENDING: u8 = 1;
pub const LANE_FULFILLED: u8 = 2;
pub const ENTRY_FULFILLED: u8 = 1;
pub const ENTRY_CANCELLED: u8 = 2;

#[ephemeral]
#[program]
pub mod bakeland_vrf_hub {
    use super::*;

    /// Registers one logical Bakeland application. `app_id` should be a stable
    /// SHA-256 identifier, not user-facing text.
    pub fn initialize_app(
        ctx: Context<InitializeApp>,
        app_id: [u8; 32],
        operator: Pubkey,
        max_lanes: u16,
    ) -> Result<()> {
        require!(app_id != [0; 32], VrfHubError::InvalidAppId);
        require!(operator != Pubkey::default(), VrfHubError::InvalidAuthority);
        require!(
            max_lanes > 0 && max_lanes <= MAX_LANES_PER_APP,
            VrfHubError::InvalidLaneCount
        );

        let app = &mut ctx.accounts.app;
        app.app_id = app_id;
        app.admin = ctx.accounts.admin.key();
        app.pending_admin = Pubkey::default();
        app.operator = operator;
        app.max_lanes = max_lanes;
        app.enabled = true;
        app.bump = ctx.bumps.app;

        Ok(())
    }

    /// Starts a two-step admin transfer so a mistyped address cannot
    /// permanently orphan an application configuration.
    pub fn propose_admin(
        ctx: Context<UpdateApp>,
        _app_id: [u8; 32],
        new_admin: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.app.admin,
            ctx.accounts.admin.key(),
            VrfHubError::Unauthorized
        );
        require!(
            new_admin != Pubkey::default(),
            VrfHubError::InvalidAuthority
        );
        ctx.accounts.app.pending_admin = new_admin;
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>, _app_id: [u8; 32]) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.app.pending_admin,
            ctx.accounts.new_admin.key(),
            VrfHubError::Unauthorized
        );
        ctx.accounts.app.admin = ctx.accounts.new_admin.key();
        ctx.accounts.app.pending_admin = Pubkey::default();
        Ok(())
    }

    /// Changes app metadata. Existing lanes deliberately retain their previous
    /// operator until `sync_lane` is called while the lane is on the base layer.
    pub fn update_app(
        ctx: Context<UpdateApp>,
        _app_id: [u8; 32],
        operator: Option<Pubkey>,
        max_lanes: Option<u16>,
        enabled: Option<bool>,
    ) -> Result<()> {
        let app = &mut ctx.accounts.app;
        require_keys_eq!(
            app.admin,
            ctx.accounts.admin.key(),
            VrfHubError::Unauthorized
        );

        if let Some(value) = operator {
            require!(value != Pubkey::default(), VrfHubError::InvalidAuthority);
            app.operator = value;
        }
        if let Some(value) = max_lanes {
            require!(
                value > 0 && value <= MAX_LANES_PER_APP,
                VrfHubError::InvalidLaneCount
            );
            app.max_lanes = value;
        }
        if let Some(value) = enabled {
            app.enabled = value;
        }

        Ok(())
    }

    /// Creates a reusable request lane. Different lane accounts do not share a
    /// write lock, so requests and callbacks can execute concurrently.
    pub fn initialize_lane(
        ctx: Context<InitializeLane>,
        _app_id: [u8; 32],
        lane_id: u16,
    ) -> Result<()> {
        let app = &ctx.accounts.app;
        require!(app.enabled, VrfHubError::AppDisabled);
        require!(lane_id < app.max_lanes, VrfHubError::LaneOutOfRange);
        require!(
            ctx.accounts.authority.key() == app.admin
                || ctx.accounts.authority.key() == app.operator,
            VrfHubError::Unauthorized
        );

        let lane = &mut ctx.accounts.lane;
        lane.app = app.key();
        lane.app_id = app.app_id;
        lane.authority = app.operator;
        lane.enabled = app.enabled;
        lane.lane_id = lane_id;
        lane.state = LANE_IDLE;
        lane.nonce = 0;
        lane.request_id = [0; 32];
        lane.client_seed_hash = [0; 32];
        lane.randomness = [0; 32];
        lane.requested_slot = 0;
        lane.fulfilled_slot = 0;
        lane.bump = ctx.bumps.lane;

        Ok(())
    }

    /// Creates the app-wide accumulator. Fulfilled requests from every lane
    /// are folded into this account and the batch is sealed at 100 entries.
    pub fn initialize_batch(ctx: Context<InitializeBatch>, _app_id: [u8; 32]) -> Result<()> {
        let app = &ctx.accounts.app;
        require!(app.enabled, VrfHubError::AppDisabled);
        require!(
            ctx.accounts.authority.key() == app.admin
                || ctx.accounts.authority.key() == app.operator,
            VrfHubError::Unauthorized
        );

        let batch = &mut ctx.accounts.batch;
        batch.app = app.key();
        batch.app_id = app.app_id;
        batch.authority = app.operator;
        batch.batch_index = 0;
        batch.entry_count = 0;
        batch.total_entries = 0;
        batch.batch_root = [0; 32];
        batch.global_root = [0; 32];
        batch.session_commits = 0;
        batch.sealed = false;
        batch.bump = ctx.bumps.batch;

        Ok(())
    }

    /// Refreshes an undelegated lane after an app operator or consumer changes.
    pub fn sync_lane(ctx: Context<SyncLane>, _app_id: [u8; 32], _lane_id: u16) -> Result<()> {
        let app = &ctx.accounts.app;
        require_keys_eq!(
            app.admin,
            ctx.accounts.admin.key(),
            VrfHubError::Unauthorized
        );
        require!(
            ctx.accounts.lane.state != LANE_PENDING,
            VrfHubError::RequestPending
        );

        let lane = &mut ctx.accounts.lane;
        lane.authority = app.operator;
        lane.enabled = app.enabled;
        Ok(())
    }

    /// Delegates one lane to a public ER or an explicitly supplied validator.
    pub fn delegate_lane(ctx: Context<DelegateLane>, app_id: [u8; 32], lane_id: u16) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.app.admin
                || ctx.accounts.authority.key() == ctx.accounts.app.operator,
            VrfHubError::Unauthorized
        );
        require!(ctx.accounts.app.enabled, VrfHubError::AppDisabled);

        let lane_id_bytes = lane_id.to_le_bytes();
        ctx.accounts.delegate_lane(
            &ctx.accounts.authority,
            &[LANE_SEED, app_id.as_ref(), lane_id_bytes.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Delegates the shared accumulator to the same ER as the app's lanes.
    pub fn delegate_batch(ctx: Context<DelegateBatch>, app_id: [u8; 32]) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.app.admin
                || ctx.accounts.authority.key() == ctx.accounts.app.operator,
            VrfHubError::Unauthorized
        );
        require!(ctx.accounts.app.enabled, VrfHubError::AppDisabled);
        ctx.accounts.delegate_batch(
            &ctx.accounts.authority,
            &[BATCH_SEED, app_id.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Requests randomness on one idle lane. The caller seed is domain-separated
    /// by program, app, lane, nonce, request ID, and the caller-provided seed.
    pub fn request_randomness_er(
        ctx: Context<RequestRandomnessEr>,
        request_id: [u8; 32],
        client_seed: [u8; 32],
    ) -> Result<()> {
        require!(request_id != [0; 32], VrfHubError::InvalidRequestId);

        let (lane_key, nonce, caller_seed) = {
            let lane = &mut ctx.accounts.lane;
            require_keys_eq!(
                lane.authority,
                ctx.accounts.payer.key(),
                VrfHubError::Unauthorized
            );
            require!(lane.enabled, VrfHubError::AppDisabled);
            require!(lane.state == LANE_IDLE, VrfHubError::LaneBusy);

            let nonce = lane.nonce.checked_add(1).ok_or(VrfHubError::MathOverflow)?;
            let caller_seed =
                derive_caller_seed(lane.app_id, lane.lane_id, nonce, request_id, client_seed);

            lane.state = LANE_PENDING;
            lane.nonce = nonce;
            lane.request_id = request_id;
            lane.client_seed_hash = hashv(&[client_seed.as_ref()]).to_bytes();
            lane.randomness = [0; 32];
            lane.requested_slot = Clock::get()?.slot;
            lane.fulfilled_slot = 0;

            (lane.key(), nonce, caller_seed)
        };

        let mut callback_args = Vec::with_capacity(40);
        callback_args.extend_from_slice(&request_id);
        callback_args.extend_from_slice(&nonce.to_le_bytes());

        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::FulfillRandomnessEr::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: lane_key,
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: Some(callback_args),
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

        Ok(())
    }

    /// MagicBlock VRF callback. Each callback writes only its own lane.
    pub fn fulfill_randomness_er(
        ctx: Context<FulfillRandomnessEr>,
        randomness: [u8; 32],
        request_id: [u8; 32],
        nonce: u64,
    ) -> Result<()> {
        let lane = &mut ctx.accounts.lane;
        require!(lane.state == LANE_PENDING, VrfHubError::NoPendingRequest);
        require!(lane.nonce == nonce, VrfHubError::CallbackMismatch);
        require!(lane.request_id == request_id, VrfHubError::CallbackMismatch);

        lane.randomness = randomness;
        lane.state = LANE_FULFILLED;
        lane.fulfilled_slot = Clock::get()?.slot;

        Ok(())
    }

    /// Atomically folds a fulfilled result into the app-wide batch and releases
    /// the lane. There is deliberately no unrecorded fulfilled-result release.
    pub fn consume_result_er(
        ctx: Context<ConsumeResultEr>,
        expected_request_id: [u8; 32],
        expected_nonce: u64,
    ) -> Result<()> {
        let lane = &mut ctx.accounts.lane;
        require_keys_eq!(
            lane.authority,
            ctx.accounts.authority.key(),
            VrfHubError::Unauthorized
        );
        require!(lane.state == LANE_FULFILLED, VrfHubError::ResultNotReady);
        require!(lane.nonce == expected_nonce, VrfHubError::CallbackMismatch);
        require!(
            lane.request_id == expected_request_id,
            VrfHubError::CallbackMismatch
        );

        append_batch_entry(
            &mut ctx.accounts.batch,
            lane,
            ENTRY_FULFILLED,
            lane.randomness,
        )?;

        clear_lane(lane);
        Ok(())
    }

    /// Explicit delayed recovery. A cancellation is itself appended to the
    /// durable batch, so request suppression remains visible in checkpoints.
    pub fn cancel_pending_er(
        ctx: Context<ConsumeResultEr>,
        expected_request_id: [u8; 32],
        expected_nonce: u64,
    ) -> Result<()> {
        let lane = &mut ctx.accounts.lane;
        require_keys_eq!(
            lane.authority,
            ctx.accounts.authority.key(),
            VrfHubError::Unauthorized
        );
        require!(lane.state == LANE_PENDING, VrfHubError::NoPendingRequest);
        require!(lane.nonce == expected_nonce, VrfHubError::CallbackMismatch);
        require!(
            lane.request_id == expected_request_id,
            VrfHubError::CallbackMismatch
        );
        let cancel_after = lane
            .requested_slot
            .checked_add(MIN_CANCEL_DELAY_SLOTS)
            .ok_or(VrfHubError::MathOverflow)?;
        require!(
            Clock::get()?.slot >= cancel_after,
            VrfHubError::CancellationTooEarly
        );

        append_batch_entry(&mut ctx.accounts.batch, lane, ENTRY_CANCELLED, [0; 32])?;
        clear_lane(lane);
        Ok(())
    }

    /// Commits one completed 100-result checkpoint while keeping the batch
    /// accumulator delegated. The post-commit ER state opens the next
    /// checkpoint and retains the cumulative global root.
    pub fn checkpoint_batch(ctx: Context<CommitBatch>) -> Result<()> {
        {
            let batch = &mut ctx.accounts.batch;
            require_keys_eq!(
                batch.authority,
                ctx.accounts.authority.key(),
                VrfHubError::Unauthorized
            );
            require!(batch.sealed, VrfHubError::BatchNotSealed);
            require!(
                batch.session_commits < CHECKPOINTS_PER_SESSION - 1,
                VrfHubError::FinalCheckpointRequired
            );

            batch.session_commits = batch
                .session_commits
                .checked_add(1)
                .ok_or(VrfHubError::MathOverflow)?;
            open_next_checkpoint(batch)?;
        }

        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.batch.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Publishes the tenth 100-result checkpoint and ends only the accumulator's
    /// delegation session. Request lanes remain delegated and available.
    pub fn commit_and_undelegate_batch(ctx: Context<FinalizeBatchSession>) -> Result<()> {
        let batch_info = ctx.accounts.batch.to_account_info();
        {
            // Undelegation changes the account owner during the CPI. Persist the
            // final state first so Anchor never writes after ownership changes.
            let mut account_data = batch_info.try_borrow_mut_data()?;
            let mut readable: &[u8] = &account_data;
            let mut batch = BatchAccumulator::try_deserialize(&mut readable)?;
            require_keys_eq!(
                batch.authority,
                ctx.accounts.authority.key(),
                VrfHubError::Unauthorized
            );
            require!(batch.sealed, VrfHubError::BatchNotSealed);
            require!(
                batch.session_commits == CHECKPOINTS_PER_SESSION - 1,
                VrfHubError::SessionNotReady
            );
            batch.session_commits = CHECKPOINTS_PER_SESSION;

            let expected_batch = Pubkey::create_program_address(
                &[BATCH_SEED, batch.app_id.as_ref(), &[batch.bump]],
                ctx.program_id,
            )
            .map_err(|_| error!(VrfHubError::InvalidBatchAddress))?;
            require_keys_eq!(
                expected_batch,
                batch_info.key(),
                VrfHubError::InvalidBatchAddress
            );

            let mut writable: &mut [u8] = &mut account_data;
            batch.try_serialize(&mut writable)?;
        }

        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[batch_info])
        .build_and_invoke()?;
        Ok(())
    }

    /// Opens the first checkpoint of the next 1,000-result delegation session
    /// after the completed accumulator is back on the base layer.
    pub fn advance_session(ctx: Context<AdvanceBatch>, _app_id: [u8; 32]) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.batch.authority
                || ctx.accounts.authority.key() == ctx.accounts.app.admin,
            VrfHubError::Unauthorized
        );
        require!(ctx.accounts.batch.sealed, VrfHubError::BatchNotSealed);
        require!(
            ctx.accounts.batch.session_commits == CHECKPOINTS_PER_SESSION,
            VrfHubError::SessionNotComplete
        );

        let batch = &mut ctx.accounts.batch;
        open_next_checkpoint(batch)?;
        batch.session_commits = 0;
        batch.authority = ctx.accounts.app.operator;
        Ok(())
    }
}

fn derive_caller_seed(
    app_id: [u8; 32],
    lane_id: u16,
    nonce: u64,
    request_id: [u8; 32],
    client_seed: [u8; 32],
) -> [u8; 32] {
    hashv(&[
        REQUEST_DOMAIN,
        ID.as_ref(),
        app_id.as_ref(),
        lane_id.to_le_bytes().as_ref(),
        nonce.to_le_bytes().as_ref(),
        request_id.as_ref(),
        client_seed.as_ref(),
    ])
    .to_bytes()
}

fn append_batch_entry(
    batch: &mut Account<BatchAccumulator>,
    lane: &Account<RandomnessLane>,
    entry_kind: u8,
    randomness: [u8; 32],
) -> Result<()> {
    require_keys_eq!(batch.app, lane.app, VrfHubError::AppMismatch);
    require!(batch.app_id == lane.app_id, VrfHubError::AppMismatch);
    require_keys_eq!(batch.authority, lane.authority, VrfHubError::Unauthorized);
    require!(!batch.sealed, VrfHubError::BatchSealed);
    require!(
        batch.session_commits < CHECKPOINTS_PER_SESSION,
        VrfHubError::SessionComplete
    );

    let entry_position = batch.entry_count;
    let leaf = hashv(&[
        RESULT_DOMAIN,
        ID.as_ref(),
        lane.app_id.as_ref(),
        lane.key().as_ref(),
        lane.lane_id.to_le_bytes().as_ref(),
        lane.nonce.to_le_bytes().as_ref(),
        lane.request_id.as_ref(),
        lane.client_seed_hash.as_ref(),
        randomness.as_ref(),
        lane.requested_slot.to_le_bytes().as_ref(),
        lane.fulfilled_slot.to_le_bytes().as_ref(),
        &[entry_kind],
    ])
    .to_bytes();

    batch.batch_root = fold_batch_root(
        batch.app_id,
        batch.batch_index,
        entry_position,
        batch.batch_root,
        leaf,
    );
    batch.entry_count = batch
        .entry_count
        .checked_add(1)
        .ok_or(VrfHubError::MathOverflow)?;
    batch.total_entries = batch
        .total_entries
        .checked_add(1)
        .ok_or(VrfHubError::MathOverflow)?;

    if batch.entry_count == BATCH_SIZE {
        seal_batch(batch)?;
    }
    Ok(())
}

fn seal_batch(batch: &mut Account<BatchAccumulator>) -> Result<()> {
    require!(!batch.sealed, VrfHubError::BatchSealed);
    batch.global_root = fold_global_root(
        batch.app_id,
        batch.batch_index,
        batch.entry_count,
        batch.total_entries,
        batch.global_root,
        batch.batch_root,
    );
    batch.sealed = true;

    Ok(())
}

fn open_next_checkpoint(batch: &mut BatchAccumulator) -> Result<()> {
    batch.batch_index = batch
        .batch_index
        .checked_add(1)
        .ok_or(VrfHubError::MathOverflow)?;
    batch.entry_count = 0;
    batch.batch_root = [0; 32];
    batch.sealed = false;
    Ok(())
}

fn fold_batch_root(
    app_id: [u8; 32],
    batch_index: u64,
    entry_position: u16,
    previous_root: [u8; 32],
    leaf: [u8; 32],
) -> [u8; 32] {
    hashv(&[
        BATCH_DOMAIN,
        app_id.as_ref(),
        batch_index.to_le_bytes().as_ref(),
        entry_position.to_le_bytes().as_ref(),
        previous_root.as_ref(),
        leaf.as_ref(),
    ])
    .to_bytes()
}

fn fold_global_root(
    app_id: [u8; 32],
    batch_index: u64,
    entry_count: u16,
    total_entries: u64,
    previous_root: [u8; 32],
    batch_root: [u8; 32],
) -> [u8; 32] {
    hashv(&[
        GLOBAL_DOMAIN,
        app_id.as_ref(),
        batch_index.to_le_bytes().as_ref(),
        entry_count.to_le_bytes().as_ref(),
        total_entries.to_le_bytes().as_ref(),
        previous_root.as_ref(),
        batch_root.as_ref(),
    ])
    .to_bytes()
}

fn clear_lane(lane: &mut Account<RandomnessLane>) {
    lane.state = LANE_IDLE;
    lane.request_id = [0; 32];
    lane.client_seed_hash = [0; 32];
    lane.randomness = [0; 32];
    lane.requested_slot = 0;
    lane.fulfilled_slot = 0;
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32])]
pub struct InitializeApp<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = AppConfig::SPACE,
        seeds = [APP_SEED, app_id.as_ref()],
        bump
    )]
    pub app: Account<'info, AppConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32])]
pub struct UpdateApp<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32])]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32], lane_id: u16)]
pub struct InitializeLane<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
    #[account(
        init,
        payer = authority,
        space = RandomnessLane::SPACE,
        seeds = [LANE_SEED, app_id.as_ref(), lane_id.to_le_bytes().as_ref()],
        bump
    )]
    pub lane: Account<'info, RandomnessLane>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32])]
pub struct InitializeBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
    #[account(
        init,
        payer = authority,
        space = BatchAccumulator::SPACE,
        seeds = [BATCH_SEED, app_id.as_ref()],
        bump
    )]
    pub batch: Account<'info, BatchAccumulator>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32], lane_id: u16)]
pub struct SyncLane<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
    #[account(
        mut,
        seeds = [LANE_SEED, app_id.as_ref(), lane_id.to_le_bytes().as_ref()],
        bump = lane.bump,
        constraint = lane.app == app.key() @ VrfHubError::AppMismatch
    )]
    pub lane: Account<'info, RandomnessLane>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(app_id: [u8; 32], lane_id: u16)]
pub struct DelegateLane<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
    /// CHECK: The delegation macro validates and delegates this PDA.
    #[account(
        mut,
        del,
        seeds = [LANE_SEED, app_id.as_ref(), lane_id.to_le_bytes().as_ref()],
        bump
    )]
    pub lane: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(app_id: [u8; 32])]
pub struct DelegateBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
    /// CHECK: The delegation macro validates and delegates this PDA.
    #[account(
        mut,
        del,
        seeds = [BATCH_SEED, app_id.as_ref()],
        bump
    )]
    pub batch: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomnessEr<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [LANE_SEED, lane.app_id.as_ref(), lane.lane_id.to_le_bytes().as_ref()],
        bump = lane.bump
    )]
    pub lane: Account<'info, RandomnessLane>,
    /// CHECK: Fixed to MagicBlock's public Ephemeral Rollup VRF queue.
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillRandomnessEr<'info> {
    #[account(
        mut,
        seeds = [LANE_SEED, lane.app_id.as_ref(), lane.lane_id.to_le_bytes().as_ref()],
        bump = lane.bump
    )]
    pub lane: Account<'info, RandomnessLane>,
}

#[derive(Accounts)]
pub struct ConsumeResultEr<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [LANE_SEED, lane.app_id.as_ref(), lane.lane_id.to_le_bytes().as_ref()],
        bump = lane.bump
    )]
    pub lane: Account<'info, RandomnessLane>,
    #[account(
        mut,
        seeds = [BATCH_SEED, lane.app_id.as_ref()],
        bump = batch.bump,
        constraint = batch.app == lane.app @ VrfHubError::AppMismatch
    )]
    pub batch: Account<'info, BatchAccumulator>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [BATCH_SEED, batch.app_id.as_ref()],
        bump = batch.bump
    )]
    pub batch: Account<'info, BatchAccumulator>,
}

#[commit]
#[derive(Accounts)]
pub struct FinalizeBatchSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Owner is constrained here; discriminator, PDA, and authority are
    /// validated before the final state is serialized.
    #[account(mut, owner = crate::ID)]
    pub batch: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(app_id: [u8; 32])]
pub struct AdvanceBatch<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [APP_SEED, app_id.as_ref()], bump = app.bump)]
    pub app: Account<'info, AppConfig>,
    #[account(
        mut,
        seeds = [BATCH_SEED, app_id.as_ref()],
        bump = batch.bump,
        constraint = batch.app == app.key() @ VrfHubError::AppMismatch
    )]
    pub batch: Account<'info, BatchAccumulator>,
}

#[account]
pub struct AppConfig {
    pub app_id: [u8; 32],
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub operator: Pubkey,
    pub max_lanes: u16,
    pub enabled: bool,
    pub bump: u8,
}

impl AppConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 2 + 1 + 1;
}

#[account]
pub struct RandomnessLane {
    pub app: Pubkey,
    pub app_id: [u8; 32],
    pub authority: Pubkey,
    pub enabled: bool,
    pub lane_id: u16,
    pub state: u8,
    pub nonce: u64,
    pub request_id: [u8; 32],
    pub client_seed_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub requested_slot: u64,
    pub fulfilled_slot: u64,
    pub bump: u8,
}

impl RandomnessLane {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 2 + 1 + 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct BatchAccumulator {
    pub app: Pubkey,
    pub app_id: [u8; 32],
    pub authority: Pubkey,
    pub batch_index: u64,
    pub entry_count: u16,
    pub total_entries: u64,
    pub batch_root: [u8; 32],
    pub global_root: [u8; 32],
    pub session_commits: u8,
    pub sealed: bool,
    pub bump: u8,
}

impl BatchAccumulator {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 2 + 8 + 32 + 32 + 1 + 1 + 1;
}

#[error_code]
pub enum VrfHubError {
    #[msg("Invalid app ID")]
    InvalidAppId,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid lane count")]
    InvalidLaneCount,
    #[msg("Lane out of range")]
    LaneOutOfRange,
    #[msg("App disabled")]
    AppDisabled,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("App mismatch")]
    AppMismatch,
    #[msg("Invalid batch address")]
    InvalidBatchAddress,
    #[msg("Invalid request ID")]
    InvalidRequestId,
    #[msg("Lane busy")]
    LaneBusy,
    #[msg("No pending request")]
    NoPendingRequest,
    #[msg("Callback mismatch")]
    CallbackMismatch,
    #[msg("Result not ready")]
    ResultNotReady,
    #[msg("Request pending")]
    RequestPending,
    #[msg("Batch sealed")]
    BatchSealed,
    #[msg("Batch not sealed")]
    BatchNotSealed,
    #[msg("The tenth checkpoint must commit and undelegate")]
    FinalCheckpointRequired,
    #[msg("Nine keepalive checkpoints are required before session finalization")]
    SessionNotReady,
    #[msg("The delegation session is complete")]
    SessionComplete,
    #[msg("The delegation session has not completed ten checkpoints")]
    SessionNotComplete,
    #[msg("Cancellation too early")]
    CancellationTooEarly,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_seed_is_deterministic() {
        let app = [1; 32];
        let request = [2; 32];
        let client = [3; 32];
        assert_eq!(
            derive_caller_seed(app, 4, 5, request, client),
            derive_caller_seed(app, 4, 5, request, client)
        );
    }

    #[test]
    fn caller_seed_is_separated_by_app_lane_and_nonce() {
        let request = [2; 32];
        let client = [3; 32];
        let base = derive_caller_seed([1; 32], 0, 1, request, client);
        assert_ne!(base, derive_caller_seed([9; 32], 0, 1, request, client));
        assert_ne!(base, derive_caller_seed([1; 32], 1, 1, request, client));
        assert_ne!(base, derive_caller_seed([1; 32], 0, 2, request, client));
    }

    #[test]
    fn account_sizes_include_anchor_discriminator() {
        assert_eq!(AppConfig::SPACE, 140);
        assert_eq!(RandomnessLane::SPACE, 229);
        assert_eq!(BatchAccumulator::SPACE, 189);
        assert_eq!(RESULTS_PER_SESSION, 1_000);
    }

    #[test]
    fn batch_root_is_ordered_and_domain_separated() {
        let app = [7; 32];
        let first = fold_batch_root(app, 0, 0, [0; 32], [1; 32]);
        let second = fold_batch_root(app, 0, 1, first, [2; 32]);
        let reversed_first = fold_batch_root(app, 0, 0, [0; 32], [2; 32]);
        let reversed = fold_batch_root(app, 0, 1, reversed_first, [1; 32]);
        assert_ne!(second, reversed);
        assert_ne!(second, fold_batch_root(app, 1, 1, first, [2; 32]));
        assert_ne!(second, fold_batch_root([8; 32], 0, 1, first, [2; 32]));
    }

    #[test]
    fn global_root_chains_completed_batches() {
        let app = [5; 32];
        let first = fold_global_root(app, 0, 100, 100, [0; 32], [1; 32]);
        let second = fold_global_root(app, 1, 100, 200, first, [2; 32]);
        assert_ne!(first, second);
        assert_ne!(second, fold_global_root(app, 1, 99, 199, first, [2; 32]));
    }

    #[test]
    fn checkpoint_state_advances_without_losing_global_history() {
        let global_root = [7; 32];
        let mut batch = BatchAccumulator {
            app: Pubkey::new_unique(),
            app_id: [5; 32],
            authority: Pubkey::new_unique(),
            batch_index: 4,
            entry_count: BATCH_SIZE,
            total_entries: 500,
            batch_root: [9; 32],
            global_root,
            session_commits: 5,
            sealed: true,
            bump: 1,
        };

        open_next_checkpoint(&mut batch).unwrap();
        assert_eq!(batch.batch_index, 5);
        assert_eq!(batch.entry_count, 0);
        assert_eq!(batch.total_entries, 500);
        assert_eq!(batch.batch_root, [0; 32]);
        assert_eq!(batch.global_root, global_root);
        assert_eq!(batch.session_commits, 5);
        assert!(!batch.sealed);
    }
}
