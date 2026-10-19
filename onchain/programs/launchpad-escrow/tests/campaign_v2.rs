use {
    anchor_lang::{AccountDeserialize, AnchorSerialize},
    launchpad_escrow::{
        CampaignDuration, CampaignParameters, CampaignStatus, CampaignV2, ID as PROGRAM_ID,
    },
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_clock::Clock,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::str::FromStr,
};

const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";
const CREATOR_LAMPORTS: u64 = 5_000_000_000;
const TEST_TIME: i64 = 1_700_000_000;

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
    program_id: Pubkey,
    instruction_name: &str,
    accounts: Vec<AccountMeta>,
    args: &[u8],
) -> Instruction {
    let discriminator = Sha256::digest(format!("global:{instruction_name}").as_bytes());
    let mut data = discriminator[..8].to_vec();
    data.extend_from_slice(args);
    Instruction {
        program_id,
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

fn start_campaign_v2_instruction(
    creator: Pubkey,
    campaign_id: u64,
    parameters: CampaignParameters,
) -> Instruction {
    let mut args = campaign_id.to_le_bytes().to_vec();
    parameters
        .serialize(&mut args)
        .expect("serialize CampaignParameters instruction argument");
    let (campaign, _) = campaign_v2_address(creator, campaign_id);
    anchor_instruction(
        PROGRAM_ID,
        "start_campaign_v2",
        vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(campaign, false),
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

async fn campaign_v2_account(
    context: &mut ProgramTestContext,
    campaign_address: Pubkey,
) -> CampaignV2 {
    let account = context
        .banks_client
        .get_account(campaign_address)
        .await
        .expect("read V2 campaign account")
        .expect("V2 campaign account exists");
    let mut data: &[u8] = &account.data;
    CampaignV2::try_deserialize(&mut data).expect("deserialize V2 campaign account")
}

#[tokio::test]
async fn v2_creation_persists_minimum_and_maximum_settings_and_rejects_replay() {
    let creator = Keypair::new();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    program_test.add_account(creator.pubkey(), system_account(CREATOR_LAMPORTS));
    let mut context = program_test.start_with_context().await;

    let minimum_id = 101;
    let minimum_parameters = CampaignParameters {
        contribution_usd_cents: 1_000,
        target_participants: 2,
        duration: CampaignDuration::Minutes(10),
    };
    let (minimum_campaign_address, minimum_bump) =
        campaign_v2_address(creator.pubkey(), minimum_id);

    let v1_address = Pubkey::find_program_address(
        &[
            b"campaign",
            creator.pubkey().as_ref(),
            &minimum_id.to_le_bytes(),
        ],
        &PROGRAM_ID,
    )
    .0;
    assert_ne!(
        minimum_campaign_address, v1_address,
        "V2 uses a distinct PDA seed namespace"
    );

    process_at(
        &mut context,
        TEST_TIME,
        start_campaign_v2_instruction(creator.pubkey(), minimum_id, minimum_parameters),
        &[&creator],
    )
    .await
    .expect("create a campaign with minimum valid settings");

    let minimum = campaign_v2_account(&mut context, minimum_campaign_address).await;
    assert_eq!(minimum.creator, creator.pubkey());
    assert_eq!(minimum.campaign_id, minimum_id);
    assert_eq!(minimum.started_at, TEST_TIME);
    assert_eq!(minimum.ends_at, TEST_TIME + 10 * 60);
    assert_eq!(minimum.participant_count, 0);
    assert_eq!(minimum.total_lamports, 0);
    assert!(minimum.status == CampaignStatus::Open);
    assert_eq!(minimum.contribution_usd_cents, 1_000);
    assert_eq!(minimum.target_usd_cents, 2_000);
    assert_eq!(minimum.target_participants, 2);
    assert_eq!(minimum.duration_minutes, 10);
    assert_eq!(minimum.bump, minimum_bump);

    let duplicate = process_at(
        &mut context,
        TEST_TIME + 1,
        start_campaign_v2_instruction(creator.pubkey(), minimum_id, minimum_parameters),
        &[&creator],
    )
    .await;
    assert!(
        duplicate.is_err(),
        "the same V2 PDA cannot be initialized twice"
    );

    let maximum_id = 102;
    let maximum_parameters = CampaignParameters {
        contribution_usd_cents: 10_000,
        target_participants: 100,
        duration: CampaignDuration::Minutes(60),
    };
    let (maximum_campaign_address, maximum_bump) =
        campaign_v2_address(creator.pubkey(), maximum_id);
    process_at(
        &mut context,
        TEST_TIME + 2,
        start_campaign_v2_instruction(creator.pubkey(), maximum_id, maximum_parameters),
        &[&creator],
    )
    .await
    .expect("create a campaign with maximum valid settings");

    let maximum = campaign_v2_account(&mut context, maximum_campaign_address).await;
    assert_eq!(maximum.creator, creator.pubkey());
    assert_eq!(maximum.campaign_id, maximum_id);
    assert_eq!(maximum.started_at, TEST_TIME + 2);
    assert_eq!(maximum.ends_at, TEST_TIME + 2 + 60 * 60);
    assert_eq!(maximum.participant_count, 0);
    assert_eq!(maximum.total_lamports, 0);
    assert!(maximum.status == CampaignStatus::Open);
    assert_eq!(maximum.contribution_usd_cents, 10_000);
    assert_eq!(maximum.target_usd_cents, 1_000_000);
    assert_eq!(maximum.target_participants, 100);
    assert_eq!(maximum.duration_minutes, 60);
    assert_eq!(maximum.bump, maximum_bump);
}

#[tokio::test]
async fn v2_creation_rejects_invalid_settings_and_deadline_overflow() {
    let creator = Keypair::new();
    let mut program_test = ProgramTest::new("launchpad_escrow", PROGRAM_ID, None);
    program_test.add_account(creator.pubkey(), system_account(CREATOR_LAMPORTS));
    let mut context = program_test.start_with_context().await;

    let valid = CampaignParameters {
        contribution_usd_cents: 1_000,
        target_participants: 2,
        duration: CampaignDuration::Minutes(10),
    };
    let mut invalid_cases = Vec::new();

    let mut parameters = valid;
    parameters.contribution_usd_cents = 999;
    invalid_cases.push(("contribution below $10", parameters));

    parameters = valid;
    parameters.contribution_usd_cents = 10_001;
    invalid_cases.push(("contribution above $100", parameters));

    parameters = valid;
    parameters.target_participants = 1;
    invalid_cases.push(("target below 2 participants", parameters));

    parameters = valid;
    parameters.target_participants = 101;
    invalid_cases.push(("target above 100 participants", parameters));

    parameters = valid;
    parameters.duration = CampaignDuration::Minutes(9);
    invalid_cases.push(("duration below 10 minutes", parameters));

    parameters = valid;
    parameters.duration = CampaignDuration::Minutes(61);
    invalid_cases.push(("duration above 60 minutes", parameters));

    parameters = valid;
    parameters.duration = CampaignDuration::NoDeadline;
    invalid_cases.push(("no-deadline duration", parameters));

    for (index, (label, parameters)) in invalid_cases.into_iter().enumerate() {
        let campaign_id = 200 + index as u64;
        let (campaign_address, _) = campaign_v2_address(creator.pubkey(), campaign_id);
        let result = process_at(
            &mut context,
            TEST_TIME + index as i64,
            start_campaign_v2_instruction(creator.pubkey(), campaign_id, parameters),
            &[&creator],
        )
        .await;
        assert!(result.is_err(), "{label} must be rejected");
        assert!(
            context
                .banks_client
                .get_account(campaign_address)
                .await
                .expect("read rejected campaign account")
                .is_none(),
            "{label} must not leave an initialized account"
        );
    }

    let overflow_id = 300;
    let (overflow_campaign_address, _) = campaign_v2_address(creator.pubkey(), overflow_id);
    let overflow_result = process_at(
        &mut context,
        i64::MAX,
        start_campaign_v2_instruction(creator.pubkey(), overflow_id, valid),
        &[&creator],
    )
    .await;
    assert!(
        overflow_result.is_err(),
        "adding the finite duration to i64::MAX must fail"
    );
    assert!(
        context
            .banks_client
            .get_account(overflow_campaign_address)
            .await
            .expect("read overflowed campaign account")
            .is_none(),
        "deadline overflow must not leave an initialized account"
    );
}
