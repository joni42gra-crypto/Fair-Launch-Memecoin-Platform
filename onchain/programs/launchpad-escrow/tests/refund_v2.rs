use {
    anchor_lang::{error::ErrorCode, AccountDeserialize, AccountSerialize, AnchorSerialize},
    launchpad_escrow::{
        calculate_required_lamports, CampaignDuration, CampaignParameters, CampaignStatus,
        CampaignV2, EscrowError, ParticipantV2, ID as PROGRAM_ID,
    },
    serde_json::Value,
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_clock::Clock,
    solana_instruction::{error::InstructionError, AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_program::rent::Rent,
    solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::{Transaction, TransactionError},
    std::{fs, path::Path},
};

const START: i64 = 1_700_000_000;
const DEADLINE: i64 = START + 600;
const DEPOSIT: u64 = 50_000_000;
const WALLET_BALANCE: u64 = 5_000_000_000;

fn system_id() -> Pubkey {
    Pubkey::default()
}

fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: system_id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn program_account(value: &impl AccountSerialize) -> Account {
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner: PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }
}

fn sbf_test() -> ProgramTest {
    let directory =
        std::env::var("BPF_OUT_DIR").expect("set BPF_OUT_DIR to the built SBF directory");
    assert!(
        Path::new(&directory).join("launchpad_escrow.so").is_file(),
        "refund tests require the actual compiled SBF program"
    );
    let mut test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    test.prefer_bpf(true);
    test
}

fn campaign_address(creator: Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"campaign_v2", creator.as_ref(), &id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

fn receipt_address(campaign: Pubkey, wallet: Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"participant_v2", campaign.as_ref(), wallet.as_ref()],
        &PROGRAM_ID,
    )
}

fn vault_address(campaign: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault_v2", campaign.as_ref()], &PROGRAM_ID).0
}

fn instruction(name: &str, accounts: Vec<AccountMeta>, args: &[u8]) -> Instruction {
    let mut data = Sha256::digest(format!("global:{name}").as_bytes())[..8].to_vec();
    data.extend_from_slice(args);
    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

fn finalize(caller: Pubkey, campaign: Pubkey) -> Instruction {
    instruction(
        "finalize_failure_v2",
        vec![
            AccountMeta::new_readonly(caller, true),
            AccountMeta::new(campaign, false),
        ],
        &[],
    )
}

fn claim(wallet: Pubkey, campaign: Pubkey) -> Instruction {
    instruction(
        "claim_refund_v2",
        vec![
            AccountMeta::new(wallet, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new(receipt_address(campaign, wallet).0, false),
            AccountMeta::new(vault_address(campaign), false),
            AccountMeta::new_readonly(system_id(), false),
        ],
        &[],
    )
}

// The System Program's transfer ABI: u32 instruction index 2, then u64 lamports.
fn donate(wallet: Pubkey, vault: Pubkey, amount: u64) -> Instruction {
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: system_id(),
        accounts: vec![
            AccountMeta::new(wallet, true),
            AccountMeta::new(vault, false),
        ],
        data,
    }
}

async fn process_at(
    context: &mut ProgramTestContext,
    now: i64,
    instruction: Instruction,
    extra_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let current = context.banks_client.get_sysvar::<Clock>().await?;
    context.warp_to_slot(current.slot + 1).unwrap();
    let mut clock = context.banks_client.get_sysvar::<Clock>().await?;
    clock.unix_timestamp = now;
    context.set_sysvar(&clock);
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(extra_signers);
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &signers,
        context.last_blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

async fn snapshot(context: &mut ProgramTestContext, keys: &[Pubkey]) -> Vec<Option<Account>> {
    let mut values = Vec::new();
    for key in keys {
        values.push(context.banks_client.get_account(*key).await.unwrap());
    }
    values
}

async fn reject_atomically(
    context: &mut ProgramTestContext,
    now: i64,
    instruction: Instruction,
    signers: &[&Keypair],
    expected_code: Option<u32>,
    watched: &[Pubkey],
) -> BanksClientError {
    let before = snapshot(context, watched).await;
    let error = process_at(context, now, instruction, signers)
        .await
        .expect_err("instruction must be rejected");
    if let Some(expected) = expected_code {
        match &error {
            BanksClientError::TransactionError(TransactionError::InstructionError(
                _,
                InstructionError::Custom(actual),
            )) => assert_eq!(*actual, expected, "{error:?}"),
            _ => panic!("expected custom error {expected}, got {error:?}"),
        }
    }
    assert_eq!(
        snapshot(context, watched).await,
        before,
        "rejected instruction must preserve campaign, receipt, vault and recipient; fees have a separate payer"
    );
    error
}

struct SeededCampaign {
    address: Pubkey,
    vault: Pubkey,
    state: CampaignV2,
}

#[allow(clippy::too_many_arguments)]
fn seed_campaign(
    test: &mut ProgramTest,
    id: u64,
    status: CampaignStatus,
    count: u8,
    target: u8,
    total: u64,
    vault_balance: u64,
) -> SeededCampaign {
    let creator = Pubkey::new_unique();
    let (address, bump) = campaign_address(creator, id);
    let state = CampaignV2 {
        creator,
        campaign_id: id,
        started_at: START,
        ends_at: DEADLINE,
        participant_count: count,
        total_lamports: total,
        status,
        contribution_usd_cents: 1_000,
        target_usd_cents: 1_000 * u64::from(target),
        target_participants: target,
        duration_minutes: 10,
        bump,
    };
    let vault = vault_address(address);
    test.add_account(address, program_account(&state));
    test.add_account(vault, system_account(vault_balance));
    SeededCampaign {
        address,
        vault,
        state,
    }
}

fn seed_receipt(test: &mut ProgramTest, campaign: Pubkey, wallet: Pubkey, amount: u64) -> Pubkey {
    let (address, bump) = receipt_address(campaign, wallet);
    test.add_account(
        address,
        program_account(&ParticipantV2 {
            campaign,
            wallet,
            amount_lamports: amount,
            price: 20_000_000_000,
            confidence: 100_000,
            exponent: -8,
            publish_time: START,
            quote_expires_at: START + 20,
            joined_at: START + 1,
            bump,
        }),
    );
    address
}

async fn state(context: &mut ProgramTestContext, campaign: Pubkey) -> CampaignV2 {
    let account = context
        .banks_client
        .get_account(campaign)
        .await
        .unwrap()
        .unwrap();
    CampaignV2::try_deserialize(&mut account.data.as_slice()).unwrap()
}

async fn assert_closed(context: &mut ProgramTestContext, receipt: Pubkey) {
    let account = context.banks_client.get_account(receipt).await.unwrap();
    assert!(account
        .map(|a| a.lamports == 0 && a.data.is_empty())
        .unwrap_or(true));
}

struct Quote {
    address: Pubkey,
    price: i64,
    confidence: u64,
    exponent: i32,
    publish_time: i64,
}

fn load_price(test: &mut ProgramTest) -> Quote {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-client/fixtures");
    let metadata: Value =
        serde_json::from_slice(&fs::read(fixtures.join("addresses.json")).unwrap())
            .expect("generate fixtures with the existing test runner");
    let dump: Value =
        serde_json::from_slice(&fs::read(fixtures.join("accounts/valid.json")).unwrap()).unwrap();
    let quote = &metadata["valid"];
    let address = dump["pubkey"].as_str().unwrap().parse().unwrap();
    test.add_account_with_base64_data(
        address,
        dump["account"]["lamports"].as_u64().unwrap(),
        dump["account"]["owner"].as_str().unwrap().parse().unwrap(),
        dump["account"]["data"][0].as_str().unwrap(),
    );
    Quote {
        address,
        price: quote["price"].as_str().unwrap().parse().unwrap(),
        confidence: quote["confidence"].as_str().unwrap().parse().unwrap(),
        exponent: quote["exponent"].as_i64().unwrap().try_into().unwrap(),
        publish_time: quote["publishTime"].as_str().unwrap().parse().unwrap(),
    }
}

fn contribution(wallet: Pubkey, campaign: Pubkey, quote: &Quote, amount: u64) -> Instruction {
    let mut args = quote.price.to_le_bytes().to_vec();
    args.extend_from_slice(&quote.confidence.to_le_bytes());
    args.extend_from_slice(&quote.exponent.to_le_bytes());
    args.extend_from_slice(&quote.publish_time.to_le_bytes());
    args.extend_from_slice(&(quote.publish_time + 20).to_le_bytes());
    args.extend_from_slice(&amount.to_le_bytes());
    instruction(
        "contribute_v2",
        vec![
            AccountMeta::new(wallet, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new(receipt_address(campaign, wallet).0, false),
            AccountMeta::new(vault_address(campaign), false),
            AccountMeta::new_readonly(quote.address, false),
            AccountMeta::new_readonly(system_id(), false),
        ],
        &args,
    )
}

#[tokio::test]
async fn real_sbf_contribution_finalizes_and_refunds_exactly_at_deadline() {
    let mut test = sbf_test();
    let wallet = Keypair::new();
    test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
    let quote = load_price(&mut test);
    let amount = calculate_required_lamports(1_000, quote.price, quote.exponent).unwrap();
    let mut context = test.start_with_context().await;
    let caller = context.payer.pubkey();
    let campaign_id = 301u64;
    let campaign = campaign_address(caller, campaign_id).0;
    let receipt = receipt_address(campaign, wallet.pubkey()).0;
    let vault = vault_address(campaign);
    let mut args = campaign_id.to_le_bytes().to_vec();
    CampaignParameters {
        contribution_usd_cents: 1_000,
        target_participants: 2,
        duration: CampaignDuration::Minutes(10),
    }
    .serialize(&mut args)
    .unwrap();
    process_at(
        &mut context,
        quote.publish_time,
        instruction(
            "start_campaign_v2",
            vec![
                AccountMeta::new(caller, true),
                AccountMeta::new(campaign, false),
                AccountMeta::new_readonly(system_id(), false),
            ],
            &args,
        ),
        &[],
    )
    .await
    .unwrap();
    process_at(
        &mut context,
        quote.publish_time + 1,
        contribution(wallet.pubkey(), campaign, &quote, amount),
        &[&wallet],
    )
    .await
    .unwrap();
    let deadline = state(&mut context, campaign).await.ends_at;
    let recorded = context
        .banks_client
        .get_account(receipt)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        ParticipantV2::try_deserialize(&mut recorded.data.as_slice())
            .unwrap()
            .amount_lamports,
        amount
    );
    let watched = [campaign, receipt, vault, wallet.pubkey()];
    reject_atomically(
        &mut context,
        deadline - 1,
        finalize(caller, campaign),
        &[],
        Some(EscrowError::CampaignV2NotRefundable.into()),
        &watched,
    )
    .await;
    reject_atomically(
        &mut context,
        deadline - 1,
        claim(wallet.pubkey(), campaign),
        &[&wallet],
        Some(EscrowError::CampaignV2NotRefundable.into()),
        &watched,
    )
    .await;
    reject_atomically(
        &mut context,
        deadline,
        claim(wallet.pubkey(), campaign),
        &[&wallet],
        Some(EscrowError::CampaignV2NotRefundable.into()),
        &watched,
    )
    .await;
    process_at(&mut context, deadline, finalize(caller, campaign), &[])
        .await
        .unwrap();
    assert!(state(&mut context, campaign).await.status == CampaignStatus::Failed);
    reject_atomically(
        &mut context,
        deadline,
        finalize(caller, campaign),
        &[],
        Some(EscrowError::CampaignNotOpen.into()),
        &watched,
    )
    .await;
    let wallet_before = context
        .banks_client
        .get_balance(wallet.pubkey())
        .await
        .unwrap();
    let vault_before = context.banks_client.get_balance(vault).await.unwrap();
    process_at(
        &mut context,
        deadline,
        claim(wallet.pubkey(), campaign),
        &[&wallet],
    )
    .await
    .unwrap();
    assert_eq!(
        context
            .banks_client
            .get_balance(wallet.pubkey())
            .await
            .unwrap()
            - wallet_before,
        amount + recorded.lamports,
        "exact contribution plus separately returned receipt rent; test payer pays fees"
    );
    assert_eq!(
        vault_before - context.banks_client.get_balance(vault).await.unwrap(),
        amount
    );
    assert_closed(&mut context, receipt).await;
    let after = state(&mut context, campaign).await;
    assert_eq!(after.total_lamports, 0);
    assert_eq!(after.participant_count, 1);
    assert!(after.status == CampaignStatus::Failed);
    reject_atomically(
        &mut context,
        deadline + 1,
        claim(wallet.pubkey(), campaign),
        &[&wallet],
        Some(ErrorCode::AccountNotInitialized as u32),
        &watched,
    )
    .await;
    reject_atomically(
        &mut context,
        deadline + 1,
        contribution(wallet.pubkey(), campaign, &quote, amount),
        &[&wallet],
        Some(EscrowError::CampaignNotOpen.into()),
        &watched,
    )
    .await;
}

#[tokio::test]
async fn different_participants_get_only_their_receipts_and_donations_remain() {
    let mut test = sbf_test();
    let wallets = [Keypair::new(), Keypair::new()];
    let amounts = [DEPOSIT, 80_000_000];
    let total = amounts.iter().sum();
    let campaign = seed_campaign(&mut test, 302, CampaignStatus::Open, 2, 3, total, total);
    let receipts: Vec<_> = wallets
        .iter()
        .zip(amounts)
        .map(|(wallet, amount)| {
            test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
            seed_receipt(&mut test, campaign.address, wallet.pubkey(), amount)
        })
        .collect();
    let donor = Keypair::new();
    test.add_account(donor.pubkey(), system_account(WALLET_BALANCE));
    let mut context = test.start_with_context().await;
    let caller = context.payer.pubkey();
    let donation = 7_000_000;
    process_at(
        &mut context,
        DEADLINE - 1,
        donate(donor.pubkey(), campaign.vault, donation),
        &[&donor],
    )
    .await
    .unwrap();
    assert_eq!(
        state(&mut context, campaign.address).await.total_lamports,
        total
    );
    // Finalization is permissionless and is valid after, not just exactly at, the deadline.
    process_at(
        &mut context,
        DEADLINE + 1,
        finalize(caller, campaign.address),
        &[],
    )
    .await
    .unwrap();
    let mut remaining = total;
    for ((wallet, amount), receipt) in wallets.iter().zip(amounts).zip(receipts) {
        let rent = context
            .banks_client
            .get_account(receipt)
            .await
            .unwrap()
            .unwrap()
            .lamports;
        let before = context
            .banks_client
            .get_balance(wallet.pubkey())
            .await
            .unwrap();
        process_at(
            &mut context,
            DEADLINE + 1,
            claim(wallet.pubkey(), campaign.address),
            &[wallet],
        )
        .await
        .unwrap();
        assert_eq!(
            context
                .banks_client
                .get_balance(wallet.pubkey())
                .await
                .unwrap()
                - before,
            amount + rent
        );
        remaining -= amount;
        let after = state(&mut context, campaign.address).await;
        assert_eq!(after.total_lamports, remaining);
        assert_eq!(after.participant_count, 2);
        assert!(after.status == CampaignStatus::Failed);
        assert_eq!(
            context
                .banks_client
                .get_balance(campaign.vault)
                .await
                .unwrap(),
            remaining + donation
        );
        assert_closed(&mut context, receipt).await;
    }
}

#[tokio::test]
async fn reached_targets_and_successful_campaigns_have_no_refund_exit() {
    let mut test = sbf_test();
    let wallet = Keypair::new();
    test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
    let cases: Vec<_> = [
        (CampaignStatus::Open, 2, 2),
        (CampaignStatus::Successful, 2, 2),
        (CampaignStatus::Successful, 100, 100),
        (CampaignStatus::Failed, 2, 2),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (status, count, target))| {
        let campaign = seed_campaign(
            &mut test,
            310 + index as u64,
            status,
            count,
            target,
            DEPOSIT,
            DEPOSIT,
        );
        let receipt = seed_receipt(&mut test, campaign.address, wallet.pubkey(), DEPOSIT);
        (campaign, receipt)
    })
    .collect();
    let mut context = test.start_with_context().await;
    let caller = context.payer.pubkey();
    for (campaign, receipt) in cases {
        let watched = [campaign.address, receipt, campaign.vault, wallet.pubkey()];
        let expected = if campaign.state.status == CampaignStatus::Open {
            EscrowError::CampaignV2NotRefundable
        } else {
            EscrowError::CampaignNotOpen
        };
        reject_atomically(
            &mut context,
            DEADLINE + 1,
            finalize(caller, campaign.address),
            &[],
            Some(expected.into()),
            &watched,
        )
        .await;
        reject_atomically(
            &mut context,
            DEADLINE + 1,
            claim(wallet.pubkey(), campaign.address),
            &[&wallet],
            Some(EscrowError::CampaignV2NotRefundable.into()),
            &watched,
        )
        .await;
    }
}

#[tokio::test]
async fn failed_status_does_not_bypass_deadline_or_saved_parameter_validation() {
    let mut test = sbf_test();
    let wallet = Keypair::new();
    test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
    let valid = seed_campaign(
        &mut test,
        320,
        CampaignStatus::Failed,
        1,
        2,
        DEPOSIT,
        DEPOSIT,
    );
    let valid_receipt = seed_receipt(&mut test, valid.address, wallet.pubkey(), DEPOSIT);
    let mut invalid = Vec::new();
    for index in 0..5 {
        let mut campaign = seed_campaign(
            &mut test,
            321 + index,
            CampaignStatus::Failed,
            1,
            2,
            DEPOSIT,
            DEPOSIT,
        );
        let error = match index {
            0 => {
                campaign.state.target_participants = 1;
                EscrowError::InvalidCampaignParticipantTarget
            }
            1 => {
                campaign.state.target_participants = 101;
                EscrowError::InvalidCampaignParticipantTarget
            }
            2 => {
                campaign.state.duration_minutes = 0;
                EscrowError::InvalidCampaignDuration
            }
            3 => {
                campaign.state.ends_at += 1;
                EscrowError::InvalidV2CampaignDeadline
            }
            _ => {
                campaign.state.started_at = i64::MAX;
                EscrowError::CampaignDeadlineOverflow
            }
        };
        test.add_account(campaign.address, program_account(&campaign.state));
        let receipt = seed_receipt(&mut test, campaign.address, wallet.pubkey(), DEPOSIT);
        invalid.push((campaign, receipt, error));
    }
    let mut context = test.start_with_context().await;
    reject_atomically(
        &mut context,
        DEADLINE - 1,
        claim(wallet.pubkey(), valid.address),
        &[&wallet],
        Some(EscrowError::CampaignV2NotRefundable.into()),
        &[valid.address, valid_receipt, valid.vault, wallet.pubkey()],
    )
    .await;
    for (campaign, receipt, error) in invalid {
        reject_atomically(
            &mut context,
            DEADLINE + 1,
            claim(wallet.pubkey(), campaign.address),
            &[&wallet],
            Some(error.into()),
            &[campaign.address, receipt, campaign.vault, wallet.pubkey()],
        )
        .await;
    }
    process_at(
        &mut context,
        DEADLINE,
        claim(wallet.pubkey(), valid.address),
        &[&wallet],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn wrong_wallet_receipt_and_vault_including_v1_are_rejected_atomically() {
    let mut test = sbf_test();
    let wallet = Keypair::new();
    let outsider = Keypair::new();
    for key in [wallet.pubkey(), outsider.pubkey()] {
        test.add_account(key, system_account(WALLET_BALANCE));
    }
    let campaign = seed_campaign(
        &mut test,
        330,
        CampaignStatus::Failed,
        1,
        2,
        DEPOSIT,
        DEPOSIT,
    );
    let other = seed_campaign(
        &mut test,
        331,
        CampaignStatus::Failed,
        1,
        2,
        DEPOSIT,
        DEPOSIT,
    );
    let receipt = seed_receipt(&mut test, campaign.address, wallet.pubkey(), DEPOSIT);
    let other_receipt = seed_receipt(&mut test, other.address, wallet.pubkey(), DEPOSIT);
    let v1_vault =
        Pubkey::find_program_address(&[b"vault", campaign.address.as_ref()], &PROGRAM_ID).0;
    let arbitrary_vault = Pubkey::new_unique();
    for vault in [v1_vault, arbitrary_vault] {
        test.add_account(vault, system_account(DEPOSIT));
    }
    let mut context = test.start_with_context().await;
    let watched = [
        campaign.address,
        other.address,
        receipt,
        other_receipt,
        campaign.vault,
        other.vault,
        v1_vault,
        arbitrary_vault,
        wallet.pubkey(),
        outsider.pubkey(),
    ];
    for wrong_vault in [other.vault, v1_vault, arbitrary_vault] {
        let mut ix = claim(wallet.pubkey(), campaign.address);
        ix.accounts[3].pubkey = wrong_vault;
        reject_atomically(
            &mut context,
            DEADLINE,
            ix,
            &[&wallet],
            Some(ErrorCode::ConstraintSeeds as u32),
            &watched,
        )
        .await;
    }
    let mut wrong_wallet = claim(outsider.pubkey(), campaign.address);
    wrong_wallet.accounts[2].pubkey = receipt;
    reject_atomically(
        &mut context,
        DEADLINE,
        wrong_wallet,
        &[&outsider],
        Some(ErrorCode::ConstraintSeeds as u32),
        &watched,
    )
    .await;
    let mut wrong_receipt = claim(wallet.pubkey(), campaign.address);
    wrong_receipt.accounts[2].pubkey = other_receipt;
    reject_atomically(
        &mut context,
        DEADLINE,
        wrong_receipt,
        &[&wallet],
        Some(ErrorCode::ConstraintSeeds as u32),
        &watched,
    )
    .await;
    let mut unsigned = claim(wallet.pubkey(), campaign.address);
    unsigned.accounts[0].is_signer = false;
    reject_atomically(
        &mut context,
        DEADLINE,
        unsigned,
        &[],
        Some(ErrorCode::AccountNotSigner as u32),
        &watched,
    )
    .await;
}

#[tokio::test]
async fn invalid_vault_owner_and_data_cannot_authorize_a_refund() {
    let mut test = sbf_test();
    let wallet = Keypair::new();
    test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
    let mut cases = Vec::new();
    for index in 0..2 {
        let campaign = seed_campaign(
            &mut test,
            340 + index,
            CampaignStatus::Failed,
            1,
            2,
            DEPOSIT,
            DEPOSIT,
        );
        let mut vault = system_account(DEPOSIT);
        let error = if index == 0 {
            vault.owner = PROGRAM_ID;
            EscrowError::InvalidVaultOwner
        } else {
            vault.data = vec![1];
            EscrowError::InvalidV2VaultData
        };
        test.add_account(campaign.vault, vault);
        let receipt = seed_receipt(&mut test, campaign.address, wallet.pubkey(), DEPOSIT);
        cases.push((campaign, receipt, error));
    }
    let mut context = test.start_with_context().await;
    for (campaign, receipt, error) in cases {
        reject_atomically(
            &mut context,
            DEADLINE,
            claim(wallet.pubkey(), campaign.address),
            &[&wallet],
            Some(error.into()),
            &[campaign.address, receipt, campaign.vault, wallet.pubkey()],
        )
        .await;
    }
}

#[tokio::test]
async fn insufficient_vault_underflow_and_zero_receipt_preserve_every_account() {
    let mut test = sbf_test();
    let wallet = Keypair::new();
    test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
    let mut cases = Vec::new();
    for (index, (total, balance, amount, error)) in [
        (
            DEPOSIT,
            DEPOSIT - 1,
            DEPOSIT,
            EscrowError::InsufficientV2VaultFunds,
        ),
        (
            DEPOSIT - 1,
            DEPOSIT,
            DEPOSIT,
            EscrowError::ArithmeticOverflow,
        ),
        (DEPOSIT, DEPOSIT, 0, EscrowError::InvalidRefundAmount),
    ]
    .into_iter()
    .enumerate()
    {
        let campaign = seed_campaign(
            &mut test,
            350 + index as u64,
            CampaignStatus::Failed,
            1,
            2,
            total,
            balance,
        );
        let receipt = seed_receipt(&mut test, campaign.address, wallet.pubkey(), amount);
        cases.push((campaign, receipt, error));
    }
    let mut context = test.start_with_context().await;
    for (campaign, receipt, error) in cases {
        reject_atomically(
            &mut context,
            DEADLINE,
            claim(wallet.pubkey(), campaign.address),
            &[&wallet],
            Some(error.into()),
            &[campaign.address, receipt, campaign.vault, wallet.pubkey()],
        )
        .await;
    }
}

#[tokio::test]
async fn rent_dust_runtime_failure_also_rolls_back_transfer_and_receipt_closure() {
    // A residual System account balance below rent exemption cannot be swept to
    // the participant: that would exceed the receipt. Preserve all state if the
    // runtime rejects this transition; a separate top-up can restore rent exemption.
    let mut test = sbf_test();
    let wallet = Keypair::new();
    test.add_account(wallet.pubkey(), system_account(WALLET_BALANCE));
    let campaign = seed_campaign(
        &mut test,
        360,
        CampaignStatus::Failed,
        1,
        2,
        DEPOSIT,
        DEPOSIT + 1,
    );
    let receipt = seed_receipt(&mut test, campaign.address, wallet.pubkey(), DEPOSIT);
    let mut context = test.start_with_context().await;
    let error = reject_atomically(
        &mut context,
        DEADLINE,
        claim(wallet.pubkey(), campaign.address),
        &[&wallet],
        None,
        &[campaign.address, receipt, campaign.vault, wallet.pubkey()],
    )
    .await;
    assert!(
        matches!(
            error,
            BanksClientError::TransactionError(TransactionError::InsufficientFundsForRent { .. })
        ),
        "{error:?}"
    );
    let donor = context.payer.pubkey();
    let rent_minimum = Rent::default().minimum_balance(0);
    process_at(
        &mut context,
        DEADLINE + 1,
        donate(donor, campaign.vault, rent_minimum),
        &[],
    )
    .await
    .unwrap();
    process_at(
        &mut context,
        DEADLINE + 1,
        claim(wallet.pubkey(), campaign.address),
        &[&wallet],
    )
    .await
    .unwrap();
    assert_eq!(
        context
            .banks_client
            .get_balance(campaign.vault)
            .await
            .unwrap(),
        rent_minimum + 1
    );
    assert_eq!(
        state(&mut context, campaign.address).await.total_lamports,
        0
    );
    assert_closed(&mut context, receipt).await;
}
