use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

const COMP_DEF_OFFSET_INIT_MATCH_STATE: u32 = comp_def_offset("init_match_state");
const COMP_DEF_OFFSET_SUBMIT_FLEET: u32 = comp_def_offset("submit_fleet");
const COMP_DEF_OFFSET_FIRE_SHOT: u32 = comp_def_offset("fire_shot");

const ENCRYPTED_STATE_OFFSET: u32 = 9;
const ENCRYPTED_STATE_SIZE: u32 = 32 * 4;
const SHIPS_PER_PLAYER: u8 = 3;

const PENDING_NONE: u8 = 0;
const PENDING_INIT: u8 = 1;
const PENDING_FLEET: u8 = 2;
const PENDING_SHOT: u8 = 3;

declare_id!("8LCtkMQAaFKDJ7aVRWaiuKdxgTZ5qEA5psdggvvdbvtS");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameStatus {
    Initializing,
    WaitingForOpponent,
    FleetSetup,
    Active,
    Finished,
    Cancelled,
}

#[arcium_program]
pub mod arxship {
    use super::*;

    pub fn init_match_state_comp_def(ctx: Context<InitMatchStateCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://zxfradkkhbepggmffgav.supabase.co/storage/v1/object/public/arxship/init_match_state.arcis"
                    .to_string(),
                hash: circuit_hash!("init_match_state"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_submit_fleet_comp_def(ctx: Context<InitSubmitFleetCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://zxfradkkhbepggmffgav.supabase.co/storage/v1/object/public/arxship/submit_fleet.arcis"
                    .to_string(),
                hash: circuit_hash!("submit_fleet"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_fire_shot_comp_def(ctx: Context<InitFireShotCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://zxfradkkhbepggmffgav.supabase.co/storage/v1/object/public/arxship/fire_shot.arcis"
                    .to_string(),
                hash: circuit_hash!("fire_shot"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        computation_offset: u64,
        callsign: String,
    ) -> Result<()> {
        require!(callsign.len() <= 64, ErrorCode::CallsignTooLong);

        let game = &mut ctx.accounts.game;
        game.bump = ctx.bumps.game;
        game.encrypted_state = [[0u8; 32]; 4];
        game.state_nonce = 0;
        game.creator = ctx.accounts.creator.key();
        game.opponent = Pubkey::default();
        game.status = GameStatus::Initializing;
        game.current_turn = 0;
        game.p1_ready = false;
        game.p2_ready = false;
        game.p1_shots = 0;
        game.p2_shots = 0;
        game.pending_action = PENDING_INIT;
        game.pending_player = 0;
        game.pending_cell = 0;
        game.last_shooter = 0;
        game.last_cell = 0;
        game.last_hit = false;
        game.winner = 0;
        game.ships_per_player = SHIPS_PER_PLAYER;
        game.created_at = Clock::get()?.unix_timestamp;
        game.game_id = game_id;
        game.callsign = callsign;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            ArgBuilder::new().build(),
            vec![InitMatchStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.game.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        emit!(GameCreatedEvent {
            game: ctx.accounts.game.key(),
            creator: ctx.accounts.creator.key(),
            game_id,
        });

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_match_state")]
    pub fn init_match_state_callback(
        ctx: Context<InitMatchStateCallback>,
        output: SignedComputationOutputs<InitMatchStateOutput>,
    ) -> Result<()> {
        let encrypted = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitMatchStateOutput { field_0 }) => field_0,
            Err(_) => return err!(ErrorCode::AbortedComputation),
        };

        let game = &mut ctx.accounts.game;
        game.encrypted_state = encrypted.ciphertexts;
        game.state_nonce = encrypted.nonce;
        game.pending_action = PENDING_NONE;
        game.status = GameStatus::WaitingForOpponent;

        emit!(GameInitializedEvent {
            game: ctx.accounts.game.key(),
        });

        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.status == GameStatus::WaitingForOpponent,
            ErrorCode::GameNotJoinable
        );
        require!(
            game.creator != ctx.accounts.opponent.key(),
            ErrorCode::CreatorCannotJoinOwnGame
        );

        game.opponent = ctx.accounts.opponent.key();
        game.status = GameStatus::FleetSetup;

        emit!(GameJoinedEvent {
            game: game.key(),
            opponent: ctx.accounts.opponent.key(),
        });

        Ok(())
    }

    pub fn submit_fleet(
        ctx: Context<SubmitFleet>,
        computation_offset: u64,
        encrypted_fleet: [u8; 32],
        fleet_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let player_index = player_index_for(&ctx.accounts.game, ctx.accounts.player.key())?;
        let game = &mut ctx.accounts.game;

        require!(
            game.status == GameStatus::FleetSetup,
            ErrorCode::FleetSetupClosed
        );
        require!(
            game.pending_action == PENDING_NONE,
            ErrorCode::ComputationPending
        );
        require!(
            (player_index == 1 && !game.p1_ready) || (player_index == 2 && !game.p2_ready),
            ErrorCode::FleetAlreadySubmitted
        );

        game.pending_action = PENDING_FLEET;
        game.pending_player = player_index;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(fleet_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_fleet)
            .plaintext_u128(game.state_nonce)
            .account(
                ctx.accounts.game.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .plaintext_u8(player_index)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![SubmitFleetCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.game.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "submit_fleet")]
    pub fn submit_fleet_callback(
        ctx: Context<SubmitFleetCallback>,
        output: SignedComputationOutputs<SubmitFleetOutput>,
    ) -> Result<()> {
        let parsed = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(SubmitFleetOutput { field_0 }) => field_0,
            Err(_) => return err!(ErrorCode::AbortedComputation),
        };

        let game_key = ctx.accounts.game.key();
        let game = &mut ctx.accounts.game;
        let player_index = game.pending_player;

        if parsed.field_1 {
            game.encrypted_state = parsed.field_0.ciphertexts;
            game.state_nonce = parsed.field_0.nonce;

            if player_index == 1 {
                game.p1_ready = true;
            }
            if player_index == 2 {
                game.p2_ready = true;
            }
            if game.p1_ready && game.p2_ready {
                game.status = GameStatus::Active;
                game.current_turn = 1;
            }
        }

        game.pending_action = PENDING_NONE;
        game.pending_player = 0;

        emit!(FleetSubmittedEvent {
            game: game_key,
            player_index,
            accepted: parsed.field_1,
            both_ready: game.p1_ready && game.p2_ready,
        });

        Ok(())
    }

    pub fn fire_shot(
        ctx: Context<FireShot>,
        computation_offset: u64,
        shot_cell: u8,
    ) -> Result<()> {
        require!(shot_cell < 25, ErrorCode::InvalidShotCell);

        let shooter_index = player_index_for(&ctx.accounts.game, ctx.accounts.player.key())?;
        let game = &mut ctx.accounts.game;

        require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
        require!(
            game.pending_action == PENDING_NONE,
            ErrorCode::ComputationPending
        );
        require!(
            game.current_turn == shooter_index,
            ErrorCode::NotYourTurn
        );

        let shot_mask = shot_mask_for_cell(shot_cell)?;
        let previous_shots = if shooter_index == 1 {
            game.p1_shots
        } else {
            game.p2_shots
        };
        require!(
            (previous_shots / shot_mask) % 2 == 0,
            ErrorCode::CellAlreadyTargeted
        );

        game.pending_action = PENDING_SHOT;
        game.pending_player = shooter_index;
        game.pending_cell = shot_cell;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .plaintext_u128(game.state_nonce)
            .account(
                ctx.accounts.game.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .plaintext_u8(shooter_index)
            .plaintext_u8(shot_cell)
            .plaintext_u64(shot_mask)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![FireShotCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.game.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "fire_shot")]
    pub fn fire_shot_callback(
        ctx: Context<FireShotCallback>,
        output: SignedComputationOutputs<FireShotOutput>,
    ) -> Result<()> {
        let parsed = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(FireShotOutput { field_0 }) => field_0,
            Err(_) => return err!(ErrorCode::AbortedComputation),
        };

        let game_key = ctx.accounts.game.key();
        let game = &mut ctx.accounts.game;
        let shooter_index = game.pending_player;
        let shot_cell = game.pending_cell;
        let shot_mask = shot_mask_for_cell(shot_cell)?;

        game.encrypted_state = parsed.field_0.ciphertexts;
        game.state_nonce = parsed.field_0.nonce;

        if shooter_index == 1 {
            game.p1_shots += shot_mask;
        }
        if shooter_index == 2 {
            game.p2_shots += shot_mask;
        }

        game.last_shooter = shooter_index;
        game.last_cell = shot_cell;
        game.last_hit = parsed.field_1;
        game.winner = parsed.field_2;
        game.pending_action = PENDING_NONE;
        game.pending_player = 0;

        if parsed.field_2 > 0 {
            game.status = GameStatus::Finished;
            game.current_turn = 0;
        } else {
            game.current_turn = if shooter_index == 1 { 2 } else { 1 };
        }

        emit!(ShotResolvedEvent {
            game: game_key,
            shooter_index,
            shot_cell,
            hit: parsed.field_1,
            winner: parsed.field_2,
        });

        Ok(())
    }

    pub fn cancel_open_game(ctx: Context<CancelOpenGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.status == GameStatus::WaitingForOpponent || game.status == GameStatus::FleetSetup,
            ErrorCode::GameCannotBeCancelled
        );
        require!(game.pending_action == PENDING_NONE, ErrorCode::ComputationPending);

        game.status = GameStatus::Cancelled;

        emit!(GameCancelledEvent {
            game: game.key(),
            creator: ctx.accounts.creator.key(),
        });

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub bump: u8,
    pub encrypted_state: [[u8; 32]; 4],
    pub state_nonce: u128,
    pub creator: Pubkey,
    pub opponent: Pubkey,
    pub status: GameStatus,
    pub current_turn: u8,
    pub p1_ready: bool,
    pub p2_ready: bool,
    pub p1_shots: u64,
    pub p2_shots: u64,
    pub pending_action: u8,
    pub pending_player: u8,
    pub pending_cell: u8,
    pub last_shooter: u8,
    pub last_cell: u8,
    pub last_hit: bool,
    pub winner: u8,
    pub ships_per_player: u8,
    pub created_at: i64,
    pub game_id: u64,
    #[max_len(64)]
    pub callsign: String,
}

#[queue_computation_accounts("init_match_state", creator)]
#[derive(Accounts)]
#[instruction(game_id: u64, computation_offset: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", creator.key().as_ref(), &game_id.to_le_bytes()],
        bump,
    )]
    pub game: Box<Account<'info, Game>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = creator,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium mempool PDA.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium executing pool PDA.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium computation PDA.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_MATCH_STATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_match_state")]
#[derive(Accounts)]
pub struct InitMatchStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_MATCH_STATE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Arcium computation PDA.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, Game>>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, Game>>,
}

#[queue_computation_accounts("submit_fleet", player)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SubmitFleet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, Game>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = player,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium mempool PDA.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium executing pool PDA.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium computation PDA.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBMIT_FLEET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("submit_fleet")]
#[derive(Accounts)]
pub struct SubmitFleetCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBMIT_FLEET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Arcium computation PDA.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, Game>>,
}

#[queue_computation_accounts("fire_shot", player)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct FireShot<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, Game>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = player,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium mempool PDA.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium executing pool PDA.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: Arcium computation PDA.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIRE_SHOT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("fire_shot")]
#[derive(Accounts)]
pub struct FireShotCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIRE_SHOT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Arcium computation PDA.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub game: Box<Account<'info, Game>>,
}

#[derive(Accounts)]
pub struct CancelOpenGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator @ ErrorCode::Unauthorized)]
    pub game: Box<Account<'info, Game>>,
}

#[init_computation_definition_accounts("init_match_state", payer)]
#[derive(Accounts)]
pub struct InitMatchStateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp def PDA.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: MXE LUT PDA.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: LUT program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("submit_fleet", payer)]
#[derive(Accounts)]
pub struct InitSubmitFleetCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp def PDA.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: MXE LUT PDA.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: LUT program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("fire_shot", payer)]
#[derive(Accounts)]
pub struct InitFireShotCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp def PDA.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: MXE LUT PDA.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: LUT program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct GameCreatedEvent {
    pub game: Pubkey,
    pub creator: Pubkey,
    pub game_id: u64,
}

#[event]
pub struct GameInitializedEvent {
    pub game: Pubkey,
}

#[event]
pub struct GameJoinedEvent {
    pub game: Pubkey,
    pub opponent: Pubkey,
}

#[event]
pub struct FleetSubmittedEvent {
    pub game: Pubkey,
    pub player_index: u8,
    pub accepted: bool,
    pub both_ready: bool,
}

#[event]
pub struct ShotResolvedEvent {
    pub game: Pubkey,
    pub shooter_index: u8,
    pub shot_cell: u8,
    pub hit: bool,
    pub winner: u8,
}

#[event]
pub struct GameCancelledEvent {
    pub game: Pubkey,
    pub creator: Pubkey,
}

fn player_index_for(game: &Game, player: Pubkey) -> Result<u8> {
    if player == game.creator {
        Ok(1)
    } else if player == game.opponent {
        Ok(2)
    } else {
        err!(ErrorCode::PlayerNotInGame)
    }
}

fn shot_mask_for_cell(cell: u8) -> Result<u64> {
    require!(cell < 25, ErrorCode::InvalidShotCell);
    Ok(1u64 << cell)
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("The callsign is too long")]
    CallsignTooLong,
    #[msg("This game is not joinable")]
    GameNotJoinable,
    #[msg("The creator cannot join their own game")]
    CreatorCannotJoinOwnGame,
    #[msg("This signer is not one of the two players")]
    PlayerNotInGame,
    #[msg("Fleet setup is not open")]
    FleetSetupClosed,
    #[msg("A private computation is still pending")]
    ComputationPending,
    #[msg("This player already submitted a fleet")]
    FleetAlreadySubmitted,
    #[msg("The game is not active")]
    GameNotActive,
    #[msg("It is not your turn")]
    NotYourTurn,
    #[msg("Invalid shot cell")]
    InvalidShotCell,
    #[msg("This cell was already targeted")]
    CellAlreadyTargeted,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("This game cannot be cancelled now")]
    GameCannotBeCancelled,
}
