"""Source-backed control vectors for the TrendWatcher unit-economics model."""
from decimal import Decimal

from app.trendwatcher_econ import (
    TrendWatcherAssumptions,
    TrendWatcherDrivers,
    compute_credit_topup,
    compute_trendwatcher,
)


D = Decimal


def test_credit_topup_buys_whole_non_expiring_packs():
    result = compute_credit_topup(
        monthly_demand_credits=71_480,
        starting_balance_credits=0,
        pack_credits=25_000,
        pack_price_usd=D("47"),
    )

    assert result.shortfall_credits == 71_480
    assert result.packs_to_buy == 3
    assert result.next_topup_cash_usd == D("141")
    assert result.ending_balance_credits == 3_520


def test_credit_topup_uses_existing_balance_before_buying():
    result = compute_credit_topup(
        monthly_demand_credits=7_148,
        starting_balance_credits=10_000,
        pack_credits=25_000,
        pack_price_usd=D("47"),
    )

    assert result.shortfall_credits == 0
    assert result.packs_to_buy == 0
    assert result.next_topup_cash_usd == 0
    assert result.ending_balance_credits == 2_852


def test_instagram_daily_conservative_control_vector():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(),
        drivers=TrendWatcherDrivers(
            instagram_accounts=30,
            instagram_refreshes_per_month=30,
            instagram_credits_per_refresh=4,
        ),
    )

    assert result.instagram_credits == 3600
    assert result.instagram_cost_usd == D("6.768")


def test_instagram_and_tiktok_share_allowance_but_allowance_is_not_cost():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(provider_allowance_usd=D("10")),
        drivers=TrendWatcherDrivers(
            instagram_accounts=30,
            instagram_refreshes_per_month=30,
            instagram_credits_per_refresh=4,
            tiktok_accounts=30,
            tiktok_refreshes_per_month=30,
            tiktok_credits_per_refresh=3,
        ),
    )

    assert result.tiktok_credits == 2700
    assert result.tiktok_cost_usd == D("5.076")
    assert result.scrapecreators_credits == 6300
    assert result.data_provider_cost_usd == D("11.844")
    assert result.allowance_demand_usd == D("11.844")
    assert result.allowance_used_usd == D("10")
    assert result.allowance_remaining_usd == 0
    assert result.allowance_overage_usd == D("1.844")
    assert result.allowance_max_credits == 5319


def test_instagram_mixed_scrapecreators_paths_control_vector():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(),
        drivers=TrendWatcherDrivers(
            instagram_accounts=30,
            instagram_refreshes_per_month=30,
            instagram_credits_per_refresh=4,
            instagram_radar_runs=30,
            instagram_transcripts=100,
            instagram_published_videos=100,
            outcome_checks_per_video=4,
        ),
    )

    assert result.instagram_refresh_credits == 3600
    assert result.instagram_radar_credits == 450
    assert result.transcript_credits == 100
    assert result.outcome_credits == 400
    assert result.instagram_credits == 4550
    assert result.instagram_cost_usd == D("8.554")


def test_byo_provider_keys_zero_provider_cogs_only():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(),
        drivers=TrendWatcherDrivers(
            instagram_accounts=30,
            instagram_refreshes_per_month=30,
            instagram_credits_per_refresh=4,
        ),
        byo_provider_keys=True,
    )

    assert result.data_provider_cost_usd == D("6.768")
    assert result.provider_cogs_usd == 0


def test_apify_instagram_is_result_priced_and_radar_is_unsupported():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(
            instagram_source="apify",
            apify_instagram_price_per_1000=D("2.60"),
            apify_actor_start_usd=D("0.001"),
        ),
        drivers=TrendWatcherDrivers(
            instagram_accounts=30,
            instagram_refreshes_per_month=30,
            instagram_results_per_refresh=13,
            manual_instagram_full_collections=1,
            instagram_full_collection_results=31,
            instagram_radar_runs=30,
            instagram_transcripts=100,
            instagram_published_videos=100,
            outcome_checks_per_video=4,
        ),
    )

    assert result.apify_instagram_results == 11731
    assert result.apify_actor_runs == 1802
    assert result.apify_instagram_cost_usd == D("32.3026")
    assert result.unsupported_instagram_radar_runs == 30
    # Transcript and own-video metrics still use ScrapeCreators in current code.
    assert result.instagram_credits == 500
    assert result.instagram_cost_usd == D("0.940")
    assert result.data_provider_cost_usd == D("33.2426")


def test_tiktok_manual_discovery_transcripts_and_outcomes_are_requests():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(),
        drivers=TrendWatcherDrivers(
            manual_tiktok_full_collections=2,
            tiktok_discovery_runs=10,
            tiktok_transcripts=20,
            tiktok_published_videos=5,
            outcome_checks_per_video=4,
        ),
    )

    assert result.tiktok_refresh_credits == 6
    assert result.tiktok_discovery_credits == 390
    assert result.tiktok_transcript_credits == 20
    assert result.tiktok_outcome_credits == 20
    assert result.tiktok_credits == 436
    assert result.tiktok_cost_usd == D("0.81968")


def test_youtube_is_reported_as_non_monetary_quota():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(),
        drivers=TrendWatcherDrivers(
            youtube_channels=10,
            youtube_refreshes_per_month=30,
            manual_youtube_full_collections=2,
            youtube_radar_queries=10,
            youtube_published_videos=5,
            outcome_checks_per_video=4,
        ),
    )

    assert result.youtube_search_calls == 10
    assert result.youtube_general_quota_units == 636
    # Current TrendWatcher still meters the pre-2026 search weight as 100 + videos.list 1.
    assert result.youtube_internal_meter_units == 1636
    assert result.youtube_cost_usd is None
    assert result.data_provider_cost_usd == 0


def test_llm_uses_explicit_provider_token_assumptions():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(
            llm_provider="openrouter/google-gemini-2.5-flash",
            llm_input_usd_per_million=D("0.30"),
            llm_output_usd_per_million=D("2.50"),
        ),
        drivers=TrendWatcherDrivers(
            llm_calls=100,
            llm_input_tokens_per_call=2000,
            llm_output_tokens_per_call=500,
        ),
    )

    assert result.llm_input_tokens == 200_000
    assert result.llm_output_tokens == 50_000
    assert result.llm_cost_usd == D("0.185")
    assert result.provider_cost_usd == D("0.185")
    # LLM does not consume the shared scraping allowance.
    assert result.allowance_used_usd == 0


def test_llm_calls_follow_real_workflow_paths_and_retry_buffer():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(
            llm_input_usd_per_million=D("0.30"),
            llm_output_usd_per_million=D("2.50"),
            llm_retry_overhead_pct=D("10"),
        ),
        drivers=TrendWatcherDrivers(
            llm_annotated_videos=100,          # one annotation call per new video
            llm_similarity_videos=81,          # ceil(81 / 40) analyzer chunks
            llm_profile_rebuilds=1,            # profile + performance analysis
            llm_idea_candidates=5,             # source analysis + idea generation
            llm_manual_calls=2,
            llm_input_tokens_per_call=2000,
            llm_output_tokens_per_call=500,
        ),
    )

    assert result.llm_annotation_calls == 100
    assert result.llm_similarity_calls == 3
    assert result.llm_profile_calls == 2
    assert result.llm_idea_calls == 10
    assert result.llm_manual_calls == 2
    assert result.llm_base_calls == 117
    assert result.llm_billed_calls == 129  # ceil(117 * 1.10)
    assert result.llm_input_tokens == 258_000
    assert result.llm_output_tokens == 64_500
    assert result.llm_cost_usd == D("0.23865")


def test_llm_legacy_direct_calls_remain_backward_compatible():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(),
        drivers=TrendWatcherDrivers(
            llm_calls=7,
            llm_input_tokens_per_call=100,
            llm_output_tokens_per_call=20,
        ),
    )

    assert result.llm_base_calls == 7
    assert result.llm_billed_calls == 7


def test_llm_platform_fee_is_explicit_and_separate_from_inference():
    result = compute_trendwatcher(
        assumptions=TrendWatcherAssumptions(
            llm_platform_fee_pct=D("5.5"),
        ),
        drivers=TrendWatcherDrivers(
            llm_calls=100,
            llm_input_tokens_per_call=2000,
            llm_output_tokens_per_call=500,
        ),
    )

    assert result.llm_inference_cost_usd == D("0.185")
    assert result.llm_platform_fee_usd == D("0.010175")
    assert result.llm_cost_usd == D("0.195175")
