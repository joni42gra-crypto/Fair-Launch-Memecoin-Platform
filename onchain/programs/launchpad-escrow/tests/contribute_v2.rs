use {
    anchor_lang::{AccountDeserialize, AccountSerialize, AnchorSerialize},
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
    std::{fs, path::Path, str::FromStr},
};

const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";
const CONTRIBUTOR_LAMPORTS: u64 = 5_000_000_000;
const MIN_CONTRIBUTION_USD_CENTS: u64 = 1_000;
const MAX_CONTRIBUTION_USD_CENTS: u64 = 10_000;
const TEST_QUOTE_TTL_SECONDS: i64 = 20;

#[derive(Clone, Copy)]
struct PriceQuote {
    price: i64,
    confidence: u64,
    exponent: i32,
    publish_time: i64,
}

#[derive(Clone, Copy)]
struct PriceFixture {
    address: Pubkey,
    quote: PriceQuote,
}

fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: Vec::new(),
        owner: Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(),
        executable: false,
        rent_epoch: 0,
    }
}

fn anchor_instruction(
    instruction_name: &str,
    accounts: Vec<AccountMeta>,
    args: &[u8],
) -> Instruction {
    let discriminator = Sha256::digest(format!("global:{instruction_name}").as_bytes());
    let mut data = discriminator[..8].to_vec();
    data.extend_from_slice(args);
    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

fn campaign_v2_address(creator: Pubkey, campaign_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"campaign_v2", creator.as_ref(), &campaign_id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

fn participant_v2_address(campaign: Pubkey, wallet: Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"participant_v2", campaign.as_ref(), wallet.as_ref()],
        &PROGRAM_ID,
    )
}

fn vault_v2_address(campaign: Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault_v2", campaign.as_ref()], &PROGRAM_ID)
}

fn start_campaign_v2_instruction(
    creator: Pubkey,
    campaign_id: u64,
    parameters: CampaignParameters,
) -> Instruction {
    let mut args = campaign_id.to_le_bytes().to_vec();
    parameters
        .serialize(&mut args)
        .expect("serialize CampaignParameters");
    let (campaign, _) = campaign_v2_address(creator, campaign_id);
    anchor_instruction(
        "start_campaign_v2",
        vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(), false),
        ],
        &args,
    )
}

fn contribute_v2_instruction(
    contributor: Pubkey,
    campaign: Pubkey,
    price_update: Pubkey,
    quote: PriceQuote,
    quote_expires_at: i64,
    expected_lamports: u64,
) -> Instruction {
    let (participant, _) = participant_v2_address(campaign, contributor);
    let (vault, _) = vault_v2_address(campaign);
    let mut args = Vec::with_capacity(44);
    args.extend_from_slice(&quote.price.to_le_bytes());
    args.extend_from_slice(&quote.confidence.to_le_bytes());
    args.extend_from_slice(&quote.exponent.to_le_bytes());
    args.extend_from_slice(&quote.publish_time.to_le_bytes());
    args.extend_from_slice(&quote_expires_at.to_le_bytes());
    args.extend_from_slice(&expected_lamports.to_le_bytes());
    anchor_instruction(
        "contribute_v2",
        vec![
            AccountMeta::new(contributor, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new(participant, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(price_update, false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(), false),
        ],
        &args,
    )
}

async fn process_at(
    context: &mut ProgramTestContext,
    unix_timestamp: i64,
    instruction: Instruction,
    additional_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let current_clock = context.banks_client.get_sysvar::<Clock>().await?;
    context
        .warp_to_slot(current_clock.slot + 1)
        .expect("advance slot for a unique blockhash");

    let mut clock = context.banks_client.get_sysvar::<Clock>().await?;
    clock.unix_timestamp = unix_timestamp;
    context.set_sysvar(&clock);

    let mut signers = vec![&context.payer];
    signers.extend_from_slice(additional_signers);
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &signers,
        context.last_blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

fn add_price_fixture(
    program_test: &mut ProgramTest,
    metadata: &Value,
    key: &str,
    file_name: &str,
) -> PriceFixture {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-client/fixtures/accounts")
        .join(format!("{file_name}.json"));
    let fixture: Value = serde_json::from_slice(
        &fs::read(&fixture_path)
            .unwrap_or_else(|error| panic!("read {}: {error}", fixture_path.display())),
    )
    .expect("parse generated Pyth fixture");
    let address = fixture["pubkey"]
        .as_str()
        .expect("fixture public key")
        .parse::<Pubkey>()
        .expect("valid fixture public key");
    let account = &fixture["account"];
    let owner = account["owner"]
        .as_str()
        .expect("fixture owner")
        .parse::<Pubkey>()
        .expect("valid fixture owner");
    let lamports = account["lamports"].as_u64().expect("fixture lamports");
    let data = account["data"][0]
        .as_str()
        .expect("fixture base64 account data");
    program_test.add_account_with_base64_data(address, lamports, owner, data);

    let quote = &metadata[key];
    PriceFixture {
        address,
        quote: PriceQuote {
            price: quote["price"]
                .as_str()
                .expect("fixture price")
                .parse()
                .expect("integer fixture price"),
            confidence: quote["confidence"]
                .as_str()
                .expect("fixture confidence")
                .parse()
                .expect("integer fixture confidence"),
            exponent: quote["exponent"]
                .as_i64()
                .expect("fixture exponent")
                .try_into()
                .expect("i32 fixture exponent"),
            publish_time: quote["publishTime"]
                .as_str()
                .expect("fixture publish time")
                .parse()
                .expect("integer fixture publish time"),
        },
    }
}

fn load_fixture_metadata() -> Value {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-client/fixtures/addresses.json");
    serde_json::from_slice(
        &fs::read(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display())),
    )
    .expect("parse generated Pyth fixture metadata")
}

async fn create_campaign(
    context: &mut ProgramTestContext,
    creator: &Keypair,
    campaign_id: u64,
    contribution_usd_cents: u64,
    target_participants: u8,
    unix_timestamp: i64,
) -> Pubkey {
    let (campaign, _) = campaign_v2_address(creator.pubkey(), campaign_id);
    let parameters = CampaignParameters {
        contribution_usd_cents,
        target_participants,
        duration: CampaignDuration::Minutes(10),
    };
    process_at(
        context,
        unix_timestamp,
        start_campaign_v2_instruction(creator.pubkey(), campaign_id, parameters),
        &[creator],
    )
    .await
    .expect("start valid V2 campaign");
    campaign
}

async fn campaign_state(context: &mut ProgramTestContext, campaign: Pubkey) -> CampaignV2 {
    let account = context
        .banks_client
        .get_account(campaign)
        .await
        .expect("read campaign account")
        .expect("campaign exists");
    let mut data: &[u8] = &account.data;
    CampaignV2::try_deserialize(&mut data).expect("deserialize CampaignV2")
}

async fn participant_state(
    context: &mut ProgramTestContext,
    campaign: Pubkey,
    wallet: Pubkey,
) -> Option<ParticipantV2> {
    let (address, _) = participant_v2_address(campaign, wallet);
    let account = context
        .banks_client
        .get_account(address)
        .await
        .expect("read participant account");
    account.map(|account| {
        let mut data: &[u8] = &account.data;
        ParticipantV2::try_deserialize(&mut data).expect("deserialize ParticipantV2")
    })
}

fn assert_anchor_error(result: Result<(), BanksClientError>, expected_code: u32, label: &str) {
    match result {
        Err(BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(actual_code),
        ))) => assert_eq!(
            actual_code, expected_code,
            "{label}: expected Anchor error code {expected_code}, got {actual_code}"
        ),
        Err(error) => panic!("{label}: expected Anchor custom error, got {error:?}"),
        Ok(()) => panic!("{label}: instruction unexpectedly succeeded"),
    }
}

fn error_code(error: EscrowError) -> u32 {
    error.into()
}

async fn assert_failed_attempt_is_atomic(
    context: &mut ProgramTestContext,
    now: i64,
    campaign: Pubkey,
    contributor: &Keypair,
    price_update: Pubkey,
    quote: PriceQuote,
    quote_expires_at: i64,
    expected_lamports: u64,
    expected_error_code: Option<u32>,
    label: &str,
) {
    let (participant, _) = participant_v2_address(campaign, contributor.pubkey());
    let (vault, _) = vault_v2_address(campaign);
    let campaign_before = context
        .banks_client
        .get_account(campaign)
        .await
        .expect("read campaign before rejected transaction")
        .expect("campaign exists");
    let contributor_before = context
        .banks_client
        .get_balance(contributor.pubkey())
        .await
        .expect("read contributor balance before rejected transaction");
    let vault_before = context
        .banks_client
        .get_balance(vault)
        .await
        .expect("read vault before rejected transaction");
    assert!(
        context
            .banks_client
            .get_account(participant)
            .await
            .expect("read participant before rejected transaction")
            .is_none(),
        "{label}: no receipt should exist before the attempt"
    );

    let result = process_at(
        context,
        now,
        contribute_v2_instruction(
            contributor.pubkey(),
            campaign,
            price_update,
            quote,
            quote_expires_at,
            expected_lamports,
        ),
        &[contributor],
    )
    .await;

    if let Some(error_code) = expected_error_code {
        assert_anchor_error(result, error_code, label);
    } else {
        assert!(result.is_err(), "{label}: transaction must fail");
    }

    let campaign_after = context
        .banks_client
        .get_account(campaign)
        .await
        .expect("read campaign after rejected transaction")
        .expect("campaign remains");
    assert_eq!(
        campaign_after.data, campaign_before.data,
        "{label}: rejected transaction must not change campaign data"
    );
    assert_eq!(
        context
            .banks_client
            .get_balance(contributor.pubkey())
            .await
            .expect("read contributor balance after rejected transaction"),
        contributor_before,
        "{label}: rejected transaction must not charge contributor"
    );
    assert_eq!(
        context
            .banks_client
            .get_balance(vault)
            .await
            .expect("read vault after rejected transaction"),
        vault_before,
        "{label}: rejected transaction must not move funds"
    );
    assert!(
        context
            .banks_client
            .get_account(participant)
            .await
            .expect("read participant after rejected transaction")
            .is_none(),
        "{label}: rejected transaction must not leave a receipt"
    );
}

#[tokio::test]
async fn v2_contribution_uses_saved_usd_amount_and_transitions_at_exact_target() {
    let metadata = load_fixture_metadata();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    let valid = add_price_fixture(&mut program_test, &metadata, "valid", "valid");

    let creator = Keypair::new();
    let first_wallet = Keypair::new();
    let second_wallet = Keypair::new();
    let later_wallet = Keypair::new();
    let max_wallet = Keypair::new();
    let capacity_wallets: Vec<Keypair> = (0..=100).map(|_| Keypair::new()).collect();
    for wallet in [
        &creator,
        &first_wallet,
        &second_wallet,
        &later_wallet,
        &max_wallet,
    ] {
        program_test.add_account(wallet.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));
    }
    for wallet in &capacity_wallets {
        program_test.add_account(wallet.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));
    }

    let mut context = program_test.start_with_context().await;
    let base_time = valid.quote.publish_time - 3;
    let expires_at = base_time + TEST_QUOTE_TTL_SECONDS;
    let ten_dollar_campaign = create_campaign(
        &mut context,
        &creator,
        501,
        MIN_CONTRIBUTION_USD_CENTS,
        2,
        base_time,
    )
    .await;
    let hundred_dollar_campaign = create_campaign(
        &mut context,
        &creator,
        502,
        MAX_CONTRIBUTION_USD_CENTS,
        2,
        base_time,
    )
    .await;
    let full_capacity_campaign = create_campaign(
        &mut context,
        &creator,
        503,
        MIN_CONTRIBUTION_USD_CENTS,
        100,
        base_time,
    )
    .await;
    let ten_dollar_amount = calculate_required_lamports(
        MIN_CONTRIBUTION_USD_CENTS,
        valid.quote.price,
        valid.quote.exponent,
    )
    .expect("calculate exact $10 contribution");
    let hundred_dollar_amount = calculate_required_lamports(
        MAX_CONTRIBUTION_USD_CENTS,
        valid.quote.price,
        valid.quote.exponent,
    )
    .expect("calculate exact $100 contribution");
    assert_eq!(ten_dollar_amount, 100_000_000);
    assert_eq!(hundred_dollar_amount, 1_000_000_000);

    let ten_dollar_vault = vault_v2_address(ten_dollar_campaign).0;
    process_at(
        &mut context,
        base_time + 1,
        contribute_v2_instruction(
            first_wallet.pubkey(),
            ten_dollar_campaign,
            valid.address,
            valid.quote,
            expires_at,
            ten_dollar_amount,
        ),
        &[&first_wallet],
    )
    .await
    .expect("first wallet contributes the saved $10 amount");
    assert_eq!(
        context
            .banks_client
            .get_balance(ten_dollar_vault)
            .await
            .unwrap(),
        ten_dollar_amount
    );
    let first_receipt = participant_state(&mut context, ten_dollar_campaign, first_wallet.pubkey())
        .await
        .expect("first contribution creates a V2 receipt");
    assert_eq!(first_receipt.amount_lamports, ten_dollar_amount);
    assert_eq!(first_receipt.price, valid.quote.price);
    assert_eq!(first_receipt.publish_time, valid.quote.publish_time);

    let state_after_one = campaign_state(&mut context, ten_dollar_campaign).await;
    assert_eq!(state_after_one.participant_count, 1);
    assert_eq!(state_after_one.total_lamports, ten_dollar_amount);
    assert!(state_after_one.status == CampaignStatus::Open);

    let first_wallet_before_duplicate = context
        .banks_client
        .get_balance(first_wallet.pubkey())
        .await
        .unwrap();
    let vault_before_duplicate = context
        .banks_client
        .get_balance(ten_dollar_vault)
        .await
        .unwrap();
    let duplicate_result = process_at(
        &mut context,
        base_time + 2,
        contribute_v2_instruction(
            first_wallet.pubkey(),
            ten_dollar_campaign,
            valid.address,
            valid.quote,
            expires_at,
            ten_dollar_amount,
        ),
        &[&first_wallet],
    )
    .await;
    assert!(
        duplicate_result.is_err(),
        "the participant PDA prevents a second contribution from the same wallet"
    );
    assert_eq!(
        context
            .banks_client
            .get_balance(first_wallet.pubkey())
            .await
            .unwrap(),
        first_wallet_before_duplicate
    );
    assert_eq!(
        context
            .banks_client
            .get_balance(ten_dollar_vault)
            .await
            .unwrap(),
        vault_before_duplicate
    );
    assert_eq!(
        campaign_state(&mut context, ten_dollar_campaign)
            .await
            .participant_count,
        1
    );

    process_at(
        &mut context,
        base_time + 2,
        contribute_v2_instruction(
            second_wallet.pubkey(),
            ten_dollar_campaign,
            valid.address,
            valid.quote,
            expires_at,
            ten_dollar_amount,
        ),
        &[&second_wallet],
    )
    .await
    .expect("a distinct wallet may use the same fresh Pyth update");
    let successful_campaign = campaign_state(&mut context, ten_dollar_campaign).await;
    assert_eq!(successful_campaign.participant_count, 2);
    assert_eq!(successful_campaign.total_lamports, ten_dollar_amount * 2);
    assert!(successful_campaign.status == CampaignStatus::Successful);

    assert_failed_attempt_is_atomic(
        &mut context,
        base_time + 3,
        ten_dollar_campaign,
        &later_wallet,
        valid.address,
        valid.quote,
        expires_at,
        ten_dollar_amount,
        Some(error_code(EscrowError::CampaignNotOpen)),
        "contribution after exact target",
    )
    .await;

    let hundred_dollar_vault = vault_v2_address(hundred_dollar_campaign).0;
    process_at(
        &mut context,
        base_time + 4,
        contribute_v2_instruction(
            max_wallet.pubkey(),
            hundred_dollar_campaign,
            valid.address,
            valid.quote,
            expires_at,
            hundred_dollar_amount,
        ),
        &[&max_wallet],
    )
    .await
    .expect("contribute the saved $100 campaign amount");
    assert_eq!(
        context
            .banks_client
            .get_balance(hundred_dollar_vault)
            .await
            .unwrap(),
        hundred_dollar_amount
    );
    let hundred_state = campaign_state(&mut context, hundred_dollar_campaign).await;
    assert_eq!(
        hundred_state.contribution_usd_cents,
        MAX_CONTRIBUTION_USD_CENTS
    );
    assert_eq!(hundred_state.participant_count, 1);
    assert_eq!(hundred_state.total_lamports, hundred_dollar_amount);
    assert!(hundred_state.status == CampaignStatus::Open);

    for (index, wallet) in capacity_wallets.iter().take(100).enumerate() {
        process_at(
            &mut context,
            base_time + 5,
            contribute_v2_instruction(
                wallet.pubkey(),
                full_capacity_campaign,
                valid.address,
                valid.quote,
                expires_at,
                ten_dollar_amount,
            ),
            &[wallet],
        )
        .await
        .unwrap_or_else(|error| panic!("capacity contribution {} failed: {error:?}", index + 1));
    }
    let full_state = campaign_state(&mut context, full_capacity_campaign).await;
    assert_eq!(full_state.participant_count, 100);
    assert_eq!(full_state.total_lamports, ten_dollar_amount * 100);
    assert!(full_state.status == CampaignStatus::Successful);
    assert_eq!(
        context
            .banks_client
            .get_balance(vault_v2_address(full_capacity_campaign).0)
            .await
            .unwrap(),
        ten_dollar_amount * 100
    );
    assert_failed_attempt_is_atomic(
        &mut context,
        base_time + 5,
        full_capacity_campaign,
        &capacity_wallets[100],
        valid.address,
        valid.quote,
        expires_at,
        ten_dollar_amount,
        Some(error_code(EscrowError::CampaignNotOpen)),
        "101st contribution after the 100-wallet target",
    )
    .await;
}

#[tokio::test]
async fn v2_contribution_rejects_invalid_oracle_and_quote_without_side_effects() {
    let metadata = load_fixture_metadata();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    let valid = add_price_fixture(&mut program_test, &metadata, "valid", "valid");
    let wrong_feed = add_price_fixture(&mut program_test, &metadata, "wrongFeed", "wrong-feed");
    let stale = add_price_fixture(&mut program_test, &metadata, "stale", "stale");
    let partial = add_price_fixture(&mut program_test, &metadata, "partial", "partial");
    let zero_price = add_price_fixture(&mut program_test, &metadata, "zeroPrice", "zero-price");
    let wide_confidence = add_price_fixture(
        &mut program_test,
        &metadata,
        "wideConfidence",
        "wide-confidence",
    );
    let future = add_price_fixture(
        &mut program_test,
        &metadata,
        "tooFarInFuture",
        "future-price",
    );
    let invalid_exponent = add_price_fixture(
        &mut program_test,
        &metadata,
        "invalidExponent",
        "invalid-exponent",
    );
    let wrong_owner = add_price_fixture(&mut program_test, &metadata, "wrongOwner", "wrong-owner");

    let creator = Keypair::new();
    let contributor = Keypair::new();
    program_test.add_account(creator.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));
    program_test.add_account(contributor.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));
    let mut context = program_test.start_with_context().await;

    let base_time = valid.quote.publish_time - 3;
    let campaign = create_campaign(
        &mut context,
        &creator,
        601,
        MIN_CONTRIBUTION_USD_CENTS,
        100,
        base_time,
    )
    .await;
    let now = base_time + 1;
    let quote_expires_at = now + TEST_QUOTE_TTL_SECONDS;
    let expected_amount = calculate_required_lamports(
        MIN_CONTRIBUTION_USD_CENTS,
        valid.quote.price,
        valid.quote.exponent,
    )
    .unwrap();

    let mut mismatched_quote = valid.quote;
    mismatched_quote.price += 1;
    let mut mismatched_confidence = valid.quote;
    mismatched_confidence.confidence += 1;
    let mut mismatched_exponent = valid.quote;
    mismatched_exponent.exponent += 1;
    let mut mismatched_publish_time = valid.quote;
    mismatched_publish_time.publish_time += 1;
    let cases = [
        (
            "wrong Pyth feed ID",
            wrong_feed,
            wrong_feed.quote,
            quote_expires_at,
            expected_amount,
            None,
        ),
        (
            "stale Pyth update",
            stale,
            stale.quote,
            quote_expires_at,
            expected_amount,
            None,
        ),
        (
            "partially verified Pyth update",
            partial,
            partial.quote,
            quote_expires_at,
            expected_amount,
            None,
        ),
        (
            "Pyth account with an untrusted owner",
            wrong_owner,
            wrong_owner.quote,
            quote_expires_at,
            expected_amount,
            None,
        ),
        (
            "non-positive Pyth price",
            zero_price,
            zero_price.quote,
            quote_expires_at,
            0,
            Some(error_code(EscrowError::InvalidPrice)),
        ),
        (
            "Pyth confidence wider than one percent",
            wide_confidence,
            wide_confidence.quote,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::PriceConfidenceTooWide)),
        ),
        (
            "Pyth exponent outside the supported range",
            invalid_exponent,
            invalid_exponent.quote,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::InvalidPrice)),
        ),
        (
            "Pyth publish time too far in the future",
            future,
            future.quote,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::InvalidPrice)),
        ),
        (
            "client quote does not match Pyth",
            valid,
            mismatched_quote,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::QuoteDoesNotMatchPyth)),
        ),
        (
            "client confidence does not match Pyth",
            valid,
            mismatched_confidence,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::QuoteDoesNotMatchPyth)),
        ),
        (
            "client exponent does not match Pyth",
            valid,
            mismatched_exponent,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::QuoteDoesNotMatchPyth)),
        ),
        (
            "client publish time does not match Pyth",
            valid,
            mismatched_publish_time,
            quote_expires_at,
            expected_amount,
            Some(error_code(EscrowError::QuoteDoesNotMatchPyth)),
        ),
        (
            "expired client quote",
            valid,
            valid.quote,
            now,
            expected_amount,
            Some(error_code(EscrowError::QuoteExpired)),
        ),
        (
            "client quote exceeds the allowed lifetime",
            valid,
            valid.quote,
            now + TEST_QUOTE_TTL_SECONDS + 1,
            expected_amount,
            Some(error_code(EscrowError::QuoteExpired)),
        ),
        (
            "client expected lamports do not match the saved USD amount",
            valid,
            valid.quote,
            quote_expires_at,
            expected_amount + 1,
            Some(error_code(EscrowError::IncorrectV2LamportAmount)),
        ),
        (
            "client expected lamports are below the on-chain calculation",
            valid,
            valid.quote,
            quote_expires_at,
            expected_amount - 1,
            Some(error_code(EscrowError::IncorrectV2LamportAmount)),
        ),
    ];
    for (label, fixture, quote, expires_at, amount, expected_error_code) in cases {
        assert_failed_attempt_is_atomic(
            &mut context,
            now,
            campaign,
            &contributor,
            fixture.address,
            quote,
            expires_at,
            amount,
            expected_error_code,
            label,
        )
        .await;
    }
}

#[tokio::test]
async fn v2_contribution_checks_deadline_and_rolls_back_insufficient_transfer() {
    let metadata = load_fixture_metadata();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    let valid = add_price_fixture(&mut program_test, &metadata, "valid", "valid");

    let creator = Keypair::new();
    let first_wallet = Keypair::new();
    let deadline_wallet = Keypair::new();
    let underfunded_wallet = Keypair::new();
    program_test.add_account(creator.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));
    program_test.add_account(first_wallet.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));
    program_test.add_account(
        deadline_wallet.pubkey(),
        system_account(CONTRIBUTOR_LAMPORTS),
    );
    let required_lamports = calculate_required_lamports(
        MIN_CONTRIBUTION_USD_CENTS,
        valid.quote.price,
        valid.quote.exponent,
    )
    .expect("calculate exact contribution");
    let receipt_rent = Rent::default().minimum_balance(ParticipantV2::SPACE);
    program_test.add_account(
        underfunded_wallet.pubkey(),
        system_account(receipt_rent + required_lamports - 1),
    );

    let mut context = program_test.start_with_context().await;
    let campaign_start = valid.quote.publish_time - 599;
    let deadline = valid.quote.publish_time + 1;
    let quote_expires_at = valid.quote.publish_time + TEST_QUOTE_TTL_SECONDS;
    let campaign = create_campaign(
        &mut context,
        &creator,
        701,
        MIN_CONTRIBUTION_USD_CENTS,
        2,
        campaign_start,
    )
    .await;

    assert_failed_attempt_is_atomic(
        &mut context,
        valid.quote.publish_time - 1,
        campaign,
        &underfunded_wallet,
        valid.address,
        valid.quote,
        quote_expires_at,
        required_lamports,
        None,
        "insufficient contributor balance during System Program transfer",
    )
    .await;

    process_at(
        &mut context,
        deadline - 1,
        contribute_v2_instruction(
            first_wallet.pubkey(),
            campaign,
            valid.address,
            valid.quote,
            quote_expires_at,
            required_lamports,
        ),
        &[&first_wallet],
    )
    .await
    .expect("contribution exactly one second before the deadline");

    assert_failed_attempt_is_atomic(
        &mut context,
        deadline,
        campaign,
        &deadline_wallet,
        valid.address,
        valid.quote,
        quote_expires_at,
        required_lamports,
        Some(error_code(EscrowError::CampaignExpired)),
        "contribution exactly at the deadline",
    )
    .await;
    assert_failed_attempt_is_atomic(
        &mut context,
        deadline + 1,
        campaign,
        &deadline_wallet,
        valid.address,
        valid.quote,
        quote_expires_at,
        required_lamports,
        Some(error_code(EscrowError::CampaignExpired)),
        "contribution after the deadline",
    )
    .await;
}

#[tokio::test]
async fn v2_contribution_rejects_invalid_saved_campaign_parameters_atomically() {
    let metadata = load_fixture_metadata();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    let valid = add_price_fixture(&mut program_test, &metadata, "valid", "valid");
    let contributor = Keypair::new();
    program_test.add_account(contributor.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));

    let campaign_start = valid.quote.publish_time - 3;
    let cases = [
        (
            add_campaign_with_parameters(
                &mut program_test,
                Keypair::new().pubkey(),
                901,
                0,
                0,
                MIN_CONTRIBUTION_USD_CENTS,
                101,
                campaign_start,
            ),
            EscrowError::InvalidCampaignParticipantTarget,
            "saved target of 101 participants",
        ),
        (
            add_campaign_with_parameters(
                &mut program_test,
                Keypair::new().pubkey(),
                902,
                0,
                0,
                MIN_CONTRIBUTION_USD_CENTS,
                u8::MAX,
                campaign_start,
            ),
            EscrowError::InvalidCampaignParticipantTarget,
            "saved target of 255 participants",
        ),
        (
            add_campaign_with_parameters(
                &mut program_test,
                Keypair::new().pubkey(),
                903,
                0,
                0,
                MIN_CONTRIBUTION_USD_CENTS - 1,
                2,
                campaign_start,
            ),
            EscrowError::InvalidCampaignContribution,
            "saved contribution of 999 cents",
        ),
        (
            add_campaign_with_parameters(
                &mut program_test,
                Keypair::new().pubkey(),
                904,
                0,
                0,
                MAX_CONTRIBUTION_USD_CENTS + 1,
                2,
                campaign_start,
            ),
            EscrowError::InvalidCampaignContribution,
            "saved contribution of 10,001 cents",
        ),
    ];

    let mut context = program_test.start_with_context().await;
    let now = campaign_start + 1;
    let quote_expires_at = now + TEST_QUOTE_TTL_SECONDS;
    let expected_amount = calculate_required_lamports(
        MIN_CONTRIBUTION_USD_CENTS,
        valid.quote.price,
        valid.quote.exponent,
    )
    .expect("calculate the valid contribution amount");

    for (campaign, expected_error, label) in cases {
        assert_failed_attempt_is_atomic(
            &mut context,
            now,
            campaign,
            &contributor,
            valid.address,
            valid.quote,
            quote_expires_at,
            expected_amount,
            Some(error_code(expected_error)),
            label,
        )
        .await;
    }
}

fn add_campaign_with_state(
    program_test: &mut ProgramTest,
    creator: Pubkey,
    campaign_id: u64,
    participant_count: u8,
    total_lamports: u64,
    unix_timestamp: i64,
) -> Pubkey {
    add_campaign_with_parameters(
        program_test,
        creator,
        campaign_id,
        participant_count,
        total_lamports,
        MIN_CONTRIBUTION_USD_CENTS,
        2,
        unix_timestamp,
    )
}

fn add_campaign_with_parameters(
    program_test: &mut ProgramTest,
    creator: Pubkey,
    campaign_id: u64,
    participant_count: u8,
    total_lamports: u64,
    contribution_usd_cents: u64,
    target_participants: u8,
    unix_timestamp: i64,
) -> Pubkey {
    let (address, bump) = campaign_v2_address(creator, campaign_id);
    let campaign = CampaignV2 {
        creator,
        campaign_id,
        started_at: unix_timestamp,
        ends_at: unix_timestamp + 600,
        participant_count,
        total_lamports,
        status: CampaignStatus::Open,
        contribution_usd_cents,
        target_usd_cents: contribution_usd_cents * u64::from(target_participants),
        target_participants,
        duration_minutes: 10,
        bump,
    };
    let mut data = Vec::new();
    campaign
        .try_serialize(&mut data)
        .expect("serialize preloaded CampaignV2 test state");
    program_test.add_account(
        address,
        Account {
            lamports: Rent::default().minimum_balance(CampaignV2::SPACE),
            data,
            owner: PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    address
}

#[tokio::test]
async fn v2_contribution_rejects_counter_and_lamport_overflow_atomically() {
    let metadata = load_fixture_metadata();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    let valid = add_price_fixture(&mut program_test, &metadata, "valid", "valid");
    let contributor = Keypair::new();
    program_test.add_account(contributor.pubkey(), system_account(CONTRIBUTOR_LAMPORTS));

    let base_time = valid.quote.publish_time - 3;
    let counter_overflow_campaign = add_campaign_with_state(
        &mut program_test,
        Keypair::new().pubkey(),
        801,
        u8::MAX,
        0,
        base_time,
    );
    let lamport_overflow_campaign = add_campaign_with_state(
        &mut program_test,
        Keypair::new().pubkey(),
        802,
        1,
        u64::MAX,
        base_time,
    );
    let mut context = program_test.start_with_context().await;
    let now = base_time + 1;
    let expires_at = now + TEST_QUOTE_TTL_SECONDS;
    let expected_amount = calculate_required_lamports(
        MIN_CONTRIBUTION_USD_CENTS,
        valid.quote.price,
        valid.quote.exponent,
    )
    .unwrap();

    assert_failed_attempt_is_atomic(
        &mut context,
        now,
        counter_overflow_campaign,
        &contributor,
        valid.address,
        valid.quote,
        expires_at,
        expected_amount,
        Some(error_code(EscrowError::ArithmeticOverflow)),
        "participant counter overflow",
    )
    .await;
    assert_failed_attempt_is_atomic(
        &mut context,
        now,
        lamport_overflow_campaign,
        &contributor,
        valid.address,
        valid.quote,
        expires_at,
        expected_amount,
        Some(error_code(EscrowError::ArithmeticOverflow)),
        "total lamports overflow",
    )
    .await;
}
