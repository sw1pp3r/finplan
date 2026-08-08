"""Pure operational-driver model for TrendWatcher provider economics.

The calculator mirrors the bounded request paths in the TrendWatcher codebase.
It deliberately keeps provider allowance separate from COGS.
"""
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING


@dataclass(frozen=True)
class TrendWatcherAssumptions:
    instagram_source: str = "scrapecreators"
    scrapecreators_price_per_1000: Decimal = Decimal("1.88")
    apify_instagram_price_per_1000: Decimal = Decimal("2.60")
    apify_actor_start_usd: Decimal = Decimal("0.001")
    provider_allowance_usd: Decimal = Decimal("10")
    llm_provider: str = "openrouter/google-gemini-2.5-flash"
    llm_input_usd_per_million: Decimal = Decimal("0.30")
    llm_output_usd_per_million: Decimal = Decimal("2.50")
    # Explicit editable reserve for retries/fallback attempts. Zero means that
    # only the workflow calls below are billed; no hidden universal markup.
    llm_retry_overhead_pct: Decimal = Decimal("0")
    # Credit-purchase/platform allocation is separate from model inference.
    # Keep zero until the owner confirms the provider/top-up policy.
    llm_platform_fee_pct: Decimal = Decimal("0")


@dataclass(frozen=True)
class TrendWatcherDrivers:
    instagram_accounts: int = 0
    instagram_refreshes_per_month: int = 0
    instagram_credits_per_refresh: int = 0
    instagram_results_per_refresh: int = 13
    manual_instagram_full_collections: int = 0
    instagram_full_collection_results: int = 31
    tiktok_accounts: int = 0
    tiktok_refreshes_per_month: int = 0
    tiktok_credits_per_refresh: int = 0
    manual_tiktok_full_collections: int = 0
    tiktok_discovery_runs: int = 0
    tiktok_credits_per_discovery_run: int = 39
    tiktok_transcripts: int = 0
    tiktok_published_videos: int = 0
    youtube_channels: int = 0
    youtube_refreshes_per_month: int = 0
    manual_youtube_full_collections: int = 0
    youtube_radar_queries: int = 0
    youtube_published_videos: int = 0
    llm_calls: int = 0
    llm_input_tokens_per_call: int = 0
    llm_output_tokens_per_call: int = 0
    llm_annotated_videos: int = 0
    llm_similarity_videos: int = 0
    llm_profile_rebuilds: int = 0
    llm_idea_candidates: int = 0
    llm_manual_calls: int = 0
    instagram_radar_runs: int = 0
    instagram_credits_per_radar_run: int = 15
    instagram_transcripts: int = 0
    instagram_published_videos: int = 0
    outcome_checks_per_video: int = 4


@dataclass(frozen=True)
class CreditTopUpResult:
    monthly_demand_credits: int
    starting_balance_credits: int
    shortfall_credits: int
    pack_credits: int
    pack_price_usd: Decimal
    packs_to_buy: int
    next_topup_cash_usd: Decimal
    ending_balance_credits: int


def compute_credit_topup(
    *, monthly_demand_credits: int, starting_balance_credits: int,
    pack_credits: int, pack_price_usd: Decimal,
) -> CreditTopUpResult:
    if min(monthly_demand_credits, starting_balance_credits) < 0:
        raise ValueError("credit demand and balance must be non-negative")
    if pack_credits <= 0 or pack_price_usd <= 0:
        raise ValueError("pack credits and price must be positive")
    shortfall = max(0, monthly_demand_credits - starting_balance_credits)
    packs = 0 if shortfall == 0 else int(
        (Decimal(shortfall) / Decimal(pack_credits)).to_integral_value(
            rounding=ROUND_CEILING
        )
    )
    ending = starting_balance_credits + packs * pack_credits - monthly_demand_credits
    return CreditTopUpResult(
        monthly_demand_credits=monthly_demand_credits,
        starting_balance_credits=starting_balance_credits,
        shortfall_credits=shortfall,
        pack_credits=pack_credits,
        pack_price_usd=pack_price_usd,
        packs_to_buy=packs,
        next_topup_cash_usd=pack_price_usd * packs,
        ending_balance_credits=ending,
    )


@dataclass(frozen=True)
class TrendWatcherResult:
    instagram_refresh_credits: int
    instagram_radar_credits: int
    transcript_credits: int
    outcome_credits: int
    instagram_credits: int
    instagram_cost_usd: Decimal
    apify_instagram_results: int
    apify_actor_runs: int
    apify_instagram_cost_usd: Decimal
    unsupported_instagram_radar_runs: int
    tiktok_refresh_credits: int
    tiktok_discovery_credits: int
    tiktok_transcript_credits: int
    tiktok_outcome_credits: int
    tiktok_credits: int
    tiktok_cost_usd: Decimal
    scrapecreators_credits: int
    data_provider_cost_usd: Decimal
    llm_annotation_calls: int
    llm_similarity_calls: int
    llm_profile_calls: int
    llm_idea_calls: int
    llm_manual_calls: int
    llm_base_calls: int
    llm_billed_calls: int
    llm_input_tokens: int
    llm_output_tokens: int
    llm_inference_cost_usd: Decimal
    llm_platform_fee_usd: Decimal
    llm_cost_usd: Decimal
    provider_cost_usd: Decimal
    provider_cogs_usd: Decimal
    allowance_demand_usd: Decimal
    allowance_used_usd: Decimal
    allowance_remaining_usd: Decimal
    allowance_overage_usd: Decimal
    allowance_max_credits: int
    youtube_search_calls: int
    youtube_general_quota_units: int
    youtube_internal_meter_units: int
    youtube_cost_usd: None


def compute_trendwatcher(
    *, assumptions: TrendWatcherAssumptions, drivers: TrendWatcherDrivers,
    byo_provider_keys: bool = False,
) -> TrendWatcherResult:
    uses_apify_instagram = assumptions.instagram_source == "apify"
    instagram_refresh_credits = 0 if uses_apify_instagram else (
        drivers.instagram_accounts
        * drivers.instagram_refreshes_per_month
        * drivers.instagram_credits_per_refresh
        + drivers.manual_instagram_full_collections * 4
    )
    instagram_radar_credits = (
        0 if uses_apify_instagram else (
            drivers.instagram_radar_runs * drivers.instagram_credits_per_radar_run
        )
    )
    transcript_credits = drivers.instagram_transcripts
    outcome_credits = (
        drivers.instagram_published_videos * drivers.outcome_checks_per_video
    )
    instagram_credits = (
        instagram_refresh_credits
        + instagram_radar_credits
        + transcript_credits
        + outcome_credits
    )
    instagram_cost = (
        Decimal(instagram_credits)
        * assumptions.scrapecreators_price_per_1000
        / Decimal("1000")
    )
    apify_results = 0
    if uses_apify_instagram:
        apify_results = (
            drivers.instagram_accounts
            * drivers.instagram_refreshes_per_month
            * drivers.instagram_results_per_refresh
            + drivers.manual_instagram_full_collections
            * drivers.instagram_full_collection_results
        )
    apify_actor_runs = 0
    if uses_apify_instagram:
        account_runs = (
            drivers.instagram_accounts * drivers.instagram_refreshes_per_month
            + drivers.manual_instagram_full_collections
        )
        apify_actor_runs = account_runs * 2  # reels actor + profile actor
    apify_cost = (
        Decimal(apify_results)
        * assumptions.apify_instagram_price_per_1000
        / Decimal("1000")
        + Decimal(apify_actor_runs) * assumptions.apify_actor_start_usd
    )
    tiktok_refresh_credits = (
        drivers.tiktok_accounts
        * drivers.tiktok_refreshes_per_month
        * drivers.tiktok_credits_per_refresh
        + drivers.manual_tiktok_full_collections * 3
    )
    tiktok_discovery_credits = (
        drivers.tiktok_discovery_runs * drivers.tiktok_credits_per_discovery_run
    )
    tiktok_transcript_credits = drivers.tiktok_transcripts
    tiktok_outcome_credits = (
        drivers.tiktok_published_videos * drivers.outcome_checks_per_video
    )
    tiktok_credits = (
        tiktok_refresh_credits
        + tiktok_discovery_credits
        + tiktok_transcript_credits
        + tiktok_outcome_credits
    )
    tiktok_cost = (
        Decimal(tiktok_credits)
        * assumptions.scrapecreators_price_per_1000
        / Decimal("1000")
    )
    scrapecreators_credits = instagram_credits + tiktok_credits
    data_provider_cost = instagram_cost + apify_cost + tiktok_cost
    llm_annotation_calls = drivers.llm_annotated_videos
    llm_similarity_calls = int(
        (Decimal(drivers.llm_similarity_videos) / Decimal("40")).to_integral_value(
            rounding=ROUND_CEILING
        )
    ) if drivers.llm_similarity_videos else 0
    # build_profile = profile prompt + performance analysis; generate_ideas =
    # source analysis + adapted idea/storyboard prompt in the current app.
    llm_profile_calls = drivers.llm_profile_rebuilds * 2
    llm_idea_calls = drivers.llm_idea_candidates * 2
    llm_manual_calls = drivers.llm_manual_calls
    workflow_calls = (
        llm_annotation_calls + llm_similarity_calls + llm_profile_calls
        + llm_idea_calls + llm_manual_calls
    )
    # Existing customized v2 rows have only llm_calls. Preserve their economics
    # until the owner enters workflow drivers or a guarded preset upgrade runs.
    llm_base_calls = workflow_calls if workflow_calls else drivers.llm_calls
    llm_billed_calls = int((
        Decimal(llm_base_calls)
        * (Decimal("1") + assumptions.llm_retry_overhead_pct / Decimal("100"))
    ).to_integral_value(rounding=ROUND_CEILING))
    llm_input_tokens = llm_billed_calls * drivers.llm_input_tokens_per_call
    llm_output_tokens = llm_billed_calls * drivers.llm_output_tokens_per_call
    llm_inference_cost = (
        Decimal(llm_input_tokens) * assumptions.llm_input_usd_per_million
        + Decimal(llm_output_tokens) * assumptions.llm_output_usd_per_million
    ) / Decimal("1000000")
    llm_platform_fee = (
        llm_inference_cost * assumptions.llm_platform_fee_pct / Decimal("100")
    )
    llm_cost = llm_inference_cost + llm_platform_fee
    provider_cost = data_provider_cost + llm_cost
    allowance = assumptions.provider_allowance_usd
    remaining = max(Decimal("0"), allowance - data_provider_cost)
    overage = max(Decimal("0"), data_provider_cost - allowance)
    max_credits = int(
        allowance * Decimal("1000") / assumptions.scrapecreators_price_per_1000
    )
    youtube_refresh_units = (
        drivers.youtube_channels * drivers.youtube_refreshes_per_month * 2
    )
    youtube_manual_units = drivers.manual_youtube_full_collections * 3
    youtube_outcome_units = (
        drivers.youtube_published_videos * drivers.outcome_checks_per_video
    )
    youtube_general_units = (
        youtube_refresh_units
        + youtube_manual_units
        + drivers.youtube_radar_queries  # videos.list after each search.list
        + youtube_outcome_units
    )
    youtube_internal_units = (
        youtube_refresh_units
        + youtube_manual_units
        + drivers.youtube_radar_queries * 101
        + youtube_outcome_units
    )
    return TrendWatcherResult(
        instagram_refresh_credits=instagram_refresh_credits,
        instagram_radar_credits=instagram_radar_credits,
        transcript_credits=transcript_credits,
        outcome_credits=outcome_credits,
        instagram_credits=instagram_credits,
        instagram_cost_usd=instagram_cost,
        apify_instagram_results=apify_results,
        apify_actor_runs=apify_actor_runs,
        apify_instagram_cost_usd=apify_cost,
        unsupported_instagram_radar_runs=(
            drivers.instagram_radar_runs if uses_apify_instagram else 0
        ),
        tiktok_refresh_credits=tiktok_refresh_credits,
        tiktok_discovery_credits=tiktok_discovery_credits,
        tiktok_transcript_credits=tiktok_transcript_credits,
        tiktok_outcome_credits=tiktok_outcome_credits,
        tiktok_credits=tiktok_credits,
        tiktok_cost_usd=tiktok_cost,
        scrapecreators_credits=scrapecreators_credits,
        data_provider_cost_usd=data_provider_cost,
        llm_annotation_calls=llm_annotation_calls,
        llm_similarity_calls=llm_similarity_calls,
        llm_profile_calls=llm_profile_calls,
        llm_idea_calls=llm_idea_calls,
        llm_manual_calls=llm_manual_calls,
        llm_base_calls=llm_base_calls,
        llm_billed_calls=llm_billed_calls,
        llm_input_tokens=llm_input_tokens,
        llm_output_tokens=llm_output_tokens,
        llm_inference_cost_usd=llm_inference_cost,
        llm_platform_fee_usd=llm_platform_fee,
        llm_cost_usd=llm_cost,
        provider_cost_usd=provider_cost,
        provider_cogs_usd=Decimal("0") if byo_provider_keys else provider_cost,
        allowance_demand_usd=data_provider_cost,
        allowance_used_usd=min(allowance, data_provider_cost),
        allowance_remaining_usd=remaining,
        allowance_overage_usd=overage,
        allowance_max_credits=max_credits,
        youtube_search_calls=drivers.youtube_radar_queries,
        youtube_general_quota_units=youtube_general_units,
        youtube_internal_meter_units=youtube_internal_units,
        youtube_cost_usd=None,
    )
