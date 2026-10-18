use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

pub const PROGRAM_ID: &str = "DqZiBhjX49fyGPL3RkTw2PJeuo9aASPCrPcnaw485Zod";
pub const SOL_USD_FEED_ID: &str =
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const TARGET_USD_CENTS: u64 = 1_000;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const MAX_PARTICIPANTS: u8 = 100;
pub const CAMPAIGN_DURATION_SECONDS: i64 = 3_600;
pub const MAX_PYTH_PRICE_AGE_SECONDS: u64 = 30;
pub const MAX_QUOTE_TTL_SECONDS: i64 = 20;
pub const MAX_CONFIDENCE_BPS: u64 = 100; // 1% of the integer Pyth price.

declare_id!("DqZiBhjX49fyGPL3RkTw2PJeuo9aASPCrPcnaw485Zod");

#[program]
pub mod launchpad_escrow {
    use super::*;

    pub fn start_campaign(ctx: Context<StartCampaign>, campaign_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let deadline = now
            .checked_add(CAMPAIGN_DURATION_SECONDS)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let campaign = &mut ctx.accounts.campaign;
        campaign.creator = ctx.accounts.creator.key();
        campaign.campaign_id = campaign_id;
        campaign.started_at = now;
        campaign.ends_at = deadline;
        campaign.participant_count = 0;
        campaign.refunded_count = 0;
        campaign.total_lamports = 0;
        campaign.status = CampaignStatus::Open;
        campaign.bump = ctx.bumps.campaign;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn contribute(
        ctx: Context<Contribute>,
        quoted_price: i64,
        quoted_confidence: u64,
        quoted_exponent: i32,
        quoted_publish_time: i64,
        quote_expires_at: i64,
        expected_lamports: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let campaign = &mut ctx.accounts.campaign;

        require!(
            campaign.status == CampaignStatus::Open,
            EscrowError::CampaignNotOpen
        );
        require!(now < campaign.ends_at, EscrowError::CampaignExpired);
        require!(
            campaign.participant_count < MAX_PARTICIPANTS,
            EscrowError::CampaignFull
        );
        require!(
            quote_expires_at > now && quote_expires_at <= now.saturating_add(MAX_QUOTE_TTL_SECONDS),
            EscrowError::QuoteExpired
        );

        let feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)
            .map_err(|_| error!(EscrowError::InvalidPriceFeed))?;
        let price = ctx.accounts.price_update.get_price_no_older_than(
            &Clock::get()?,
            MAX_PYTH_PRICE_AGE_SECONDS,
            &feed_id,
        )?;

        require!(
            price.price == quoted_price
                && price.conf == quoted_confidence
                && price.exponent == quoted_exponent
                && price.publish_time == quoted_publish_time,
            EscrowError::QuoteDoesNotMatchPyth
        );
        require!(price.price > 0, EscrowError::InvalidPrice);
        require!(
            price.publish_time <= now.saturating_add(5),
            EscrowError::InvalidPrice
        );
        require!(
            confidence_is_acceptable(price.price as u64, price.conf),
            EscrowError::PriceConfidenceTooWide
        );

        let amount = calculate_required_lamports(TARGET_USD_CENTS, price.price, price.exponent)
            .map_err(|_| error!(EscrowError::InvalidPrice))?;
        require!(
            amount == expected_lamports,
            EscrowError::IncorrectLamportAmount
        );

        let transfer_accounts = Transfer {
            from: ctx.accounts.contributor.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.key(), transfer_accounts),
            amount,
        )?;

        let participant = &mut ctx.accounts.participant;
        participant.campaign = campaign.key();
        participant.wallet = ctx.accounts.contributor.key();
        participant.amount_lamports = amount;
        participant.price = price.price;
        participant.confidence = price.conf;
        participant.exponent = price.exponent;
        participant.publish_time = price.publish_time;
        participant.quote_expires_at = quote_expires_at;
        participant.joined_at = now;
        participant.bump = ctx.bumps.participant;

        campaign.participant_count = campaign
            .participant_count
            .checked_add(1)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        campaign.total_lamports = campaign
            .total_lamports
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        if campaign.participant_count == MAX_PARTICIPANTS {
            campaign.status = CampaignStatus::Successful;
        }

        emit!(ContributionRecorded {
            campaign: campaign.key(),
            wallet: participant.wallet,
            amount_lamports: amount,
            price: price.price,
            confidence: price.conf,
            exponent: price.exponent,
            publish_time: price.publish_time,
            joined_at: now,
        });
        Ok(())
    }

    pub fn finalize_failure(ctx: Context<FinalizeFailure>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let campaign = &mut ctx.accounts.campaign;
        require!(
            campaign.status == CampaignStatus::Open,
            EscrowError::CampaignNotOpen
        );
        require!(
            refund_window_is_open(campaign.participant_count, now, campaign.ends_at),
            EscrowError::CampaignNotRefundable
        );
        campaign.status = CampaignStatus::Failed;
        Ok(())
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let campaign = &mut ctx.accounts.campaign;
        let participant = &ctx.accounts.participant;
        require!(
            campaign.status == CampaignStatus::Failed,
            EscrowError::CampaignNotRefundable
        );
        require!(
            refund_window_is_open(campaign.participant_count, now, campaign.ends_at),
            EscrowError::CampaignNotRefundable
        );
        require!(
            participant.amount_lamports > 0,
            EscrowError::InvalidRefundAmount
        );

        let refund_amount = participant.amount_lamports;
        let campaign_key = campaign.key();
        let vault_bump = [ctx.bumps.vault];
        let vault_seeds: &[&[u8]] = &[b"vault", campaign_key.as_ref(), &vault_bump];
        let transfer_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.wallet.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                transfer_accounts,
                &[vault_seeds],
            ),
            refund_amount,
        )?;

        campaign.total_lamports = campaign
            .total_lamports
            .checked_sub(refund_amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        campaign.refunded_count = campaign
            .refunded_count
            .checked_add(1)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        emit!(RefundClaimed {
            campaign: campaign_key,
            wallet: ctx.accounts.wallet.key(),
            amount_lamports: refund_amount,
        });
        // The participant PDA is closed to its wallet by the account constraint.
        // A replay then fails because that unique PDA no longer exists; closure
        // also returns the account's rent reserve to the participant.
        Ok(())
    }

    pub fn close_success_receipt(_ctx: Context<CloseSuccessReceipt>) -> Result<()> {
        // Only the participant account's rent is returned by this instruction.
        // Campaign contributions stay in the vault; there is no success
        // withdrawal path.
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct StartCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Campaign::SPACE,
        seeds = [b"campaign", creator.key().as_ref(), campaign_id.to_le_bytes().as_ref()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        init,
        payer = contributor,
        space = Participant::SPACE,
        seeds = [b"participant", campaign.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,
    /// CHECK: The address is a campaign-specific PDA and must remain System Program-owned.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
        constraint = vault.owner == &system_program::ID @ EscrowError::InvalidVaultOwner
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeFailure<'info> {
    pub caller: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        close = wallet,
        seeds = [b"participant", campaign.key().as_ref(), wallet.key().as_ref()],
        bump = participant.bump,
        has_one = wallet,
        constraint = participant.campaign == campaign.key() @ EscrowError::InvalidParticipant
    )]
    pub participant: Account<'info, Participant>,
    /// CHECK: This is a System Program-owned PDA whose seeds are checked below.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
        constraint = vault.owner == &system_program::ID @ EscrowError::InvalidVaultOwner
    )]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseSuccessReceipt<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(
        constraint = campaign.status == CampaignStatus::Successful @ EscrowError::CampaignNotSuccessful
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        close = wallet,
        seeds = [b"participant", campaign.key().as_ref(), wallet.key().as_ref()],
        bump = participant.bump,
        has_one = wallet,
        constraint = participant.campaign == campaign.key() @ EscrowError::InvalidParticipant
    )]
    pub participant: Account<'info, Participant>,
}

#[account]
pub struct Campaign {
    pub creator: Pubkey,
    pub campaign_id: u64,
    pub started_at: i64,
    pub ends_at: i64,
    pub participant_count: u8,
    pub refunded_count: u8,
    pub status: CampaignStatus,
    pub total_lamports: u64,
    pub bump: u8,
}

impl Campaign {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1;
}

#[account]
pub struct Participant {
    pub campaign: Pubkey,
    pub wallet: Pubkey,
    pub amount_lamports: u64,
    pub price: i64,
    pub confidence: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub quote_expires_at: i64,
    pub joined_at: i64,
    pub bump: u8,
}

impl Participant {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 4 + 8 + 8 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CampaignStatus {
    Open,
    Successful,
    Failed,
}

#[event]
pub struct ContributionRecorded {
    pub campaign: Pubkey,
    pub wallet: Pubkey,
    pub amount_lamports: u64,
    pub price: i64,
    pub confidence: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub joined_at: i64,
}

#[event]
pub struct RefundClaimed {
    pub campaign: Pubkey,
    pub wallet: Pubkey,
    pub amount_lamports: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("The campaign is not open.")]
    CampaignNotOpen,
    #[msg("The campaign contribution deadline has passed.")]
    CampaignExpired,
    #[msg("The participant target has already been reached.")]
    CampaignFull,
    #[msg("The quote has expired or exceeds the permitted quote lifetime.")]
    QuoteExpired,
    #[msg("The Pyth update does not match the displayed quote.")]
    QuoteDoesNotMatchPyth,
    #[msg("The Pyth SOL/USD price is invalid.")]
    InvalidPrice,
    #[msg("The Pyth price confidence interval exceeds one percent.")]
    PriceConfidenceTooWide,
    #[msg("The amount does not equal the on-chain $10 calculation.")]
    IncorrectLamportAmount,
    #[msg("The campaign has not expired with fewer than 100 participants.")]
    CampaignNotRefundable,
    #[msg("The participant receipt can only be closed after campaign success.")]
    CampaignNotSuccessful,
    #[msg("The participant record is invalid.")]
    InvalidParticipant,
    #[msg("The vault must be owned by the System Program.")]
    InvalidVaultOwner,
    #[msg("The refund amount is invalid.")]
    InvalidRefundAmount,
    #[msg("The Pyth SOL/USD feed ID could not be parsed.")]
    InvalidPriceFeed,
    #[msg("Integer arithmetic overflowed.")]
    ArithmeticOverflow,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PriceCalculationError {
    InvalidInput,
    Overflow,
}

pub fn calculate_required_lamports(
    usd_cents: u64,
    price: i64,
    exponent: i32,
) -> std::result::Result<u64, PriceCalculationError> {
    if usd_cents == 0 || price <= 0 || !(-12..=12).contains(&exponent) {
        return Err(PriceCalculationError::InvalidInput);
    }

    let mut numerator = (usd_cents as u128)
        .checked_mul(LAMPORTS_PER_SOL as u128)
        .ok_or(PriceCalculationError::Overflow)?;
    let mut denominator = 100u128
        .checked_mul(price as u128)
        .ok_or(PriceCalculationError::Overflow)?;
    if exponent < 0 {
        let scale = 10u128
            .checked_pow((-exponent) as u32)
            .ok_or(PriceCalculationError::Overflow)?;
        numerator = numerator
            .checked_mul(scale)
            .ok_or(PriceCalculationError::Overflow)?;
    } else {
        let scale = 10u128
            .checked_pow(exponent as u32)
            .ok_or(PriceCalculationError::Overflow)?;
        denominator = denominator
            .checked_mul(scale)
            .ok_or(PriceCalculationError::Overflow)?;
    }

    let rounded_up = numerator
        .checked_add(denominator - 1)
        .ok_or(PriceCalculationError::Overflow)?
        / denominator;
    u64::try_from(rounded_up).map_err(|_| PriceCalculationError::Overflow)
}

pub fn confidence_is_acceptable(price: u64, confidence: u64) -> bool {
    price > 0 && (confidence as u128) * 10_000 <= (price as u128) * (MAX_CONFIDENCE_BPS as u128)
}

pub fn refund_window_is_open(participants: u8, now: i64, deadline: i64) -> bool {
    now >= deadline && participants < MAX_PARTICIPANTS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_exact_ten_dollars_in_lamports() {
        assert_eq!(
            calculate_required_lamports(1_000, 10_000_000_000, -8),
            Ok(100_000_000)
        );
    }

    #[test]
    fn rounds_up_to_avoid_undercollecting() {
        assert_eq!(
            calculate_required_lamports(1_000, 300_000_000, -8),
            Ok(3_333_333_334)
        );
    }

    #[test]
    fn accepts_only_positive_prices_and_bounded_exponents() {
        assert_eq!(
            calculate_required_lamports(1_000, 0, -8),
            Err(PriceCalculationError::InvalidInput)
        );
        assert_eq!(
            calculate_required_lamports(1_000, 100, -13),
            Err(PriceCalculationError::InvalidInput)
        );
    }

    #[test]
    fn confidence_must_be_at_most_one_percent() {
        assert!(confidence_is_acceptable(10_000, 100));
        assert!(!confidence_is_acceptable(10_000, 101));
        assert!(!confidence_is_acceptable(0, 0));
    }

    #[test]
    fn refunds_open_only_at_or_after_deadline_when_target_was_missed() {
        assert!(!refund_window_is_open(99, 3_599, 3_600));
        assert!(refund_window_is_open(99, 3_600, 3_600));
        assert!(!refund_window_is_open(100, 3_600, 3_600));
    }
}
