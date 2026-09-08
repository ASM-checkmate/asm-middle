package world.theworld.server.llm;

import java.util.List;
import java.util.Map;
import world.theworld.server.llm.LlmDtos.Agent;

/**
 * 하루 계획 계약의 JSON 모양과 상수 (옛 Node 백엔드 contract.ts·plan.ts(커밋 2808024)·docs/CONTRACT.md "POST /api/plan/options", ADR-0010).
 * 프런트 sim/types.ts의 Category·BlockId **복사** — 필드명은 sim/llm.ts planRequestOf와 글자 그대로. agent는 답장과 같은 {@link Agent}를 쓴다.
 * 블록마다 "무엇을 할지" 카드 3장을 모델이 짓는다. 장소는 프론트가 보낸 카탈로그의 id만, 범주는 정해졌으면 그 안에서.
 */
public final class PlanDtos {
  private PlanDtos() {}

  /** 모델이 고를 수 있는 범주 — 잠·여행은 규칙이 맡는다. */
  public static final List<String> PLAN_CATEGORIES = List.of("meal", "play", "exercise", "study", "work", "rest");
  /** 지어 달라 할 수 있는 블록 — 수면은 없다. */
  public static final List<String> PLAN_BLOCKS = List.of("morning", "am", "lunch", "pm", "evening", "night");
  /** 카탈로그에 올 수 있는 장소 유형 — 여행지 유형에 집·친구 집·일터·학교를 더한 것 (server.ts validatePlan). */
  public static final List<String> PLAN_PLACE_TYPES = List.of(
    "cafe", "restaurant", "park", "gym", "library", "cinema", "mall", "river", "beach", "museum", "arcade", "bar",
    "station", "airport", "port", "temple", "market", "hotel", "stadium", "mountain", "island",
    "home", "friend_home", "office", "school");
  /** 카드 제목의 최대 길이 ("레이어드에서 커피 한 잔"). 프론트 카드 한 줄. */
  public static final int MAX_TITLE = 24;
  /** 이유의 최대 길이 ("지난주에 갔던 곳, 창가 자리 좋았음"). */
  public static final int MAX_REASON = 30;
  /** 한 블록에 낼 카드 수. */
  public static final int OPTIONS_PER_BLOCK = 3;
  /** 요청 크기 상한 — 장소 120·블록 6 (server.ts validatePlan). 넘는 건 거부하지 않고 자른다. */
  public static final int MAX_PLACES = 120;
  public static final int MAX_BLOCKS = 6;

  public static final Map<String, String> BLOCK_KO = Map.of(
    "sleep", "수면(00–07)", "morning", "아침(07–09)", "am", "오전(09–12)", "lunch", "점심(12–14)", "pm", "오후(14–18)", "evening", "저녁(18–20)", "night", "밤(20–24)");
  public static final Map<String, String> CATEGORY_KO = Map.of("meal", "식사", "play", "놀기", "exercise", "운동", "study", "공부", "work", "일", "rest", "쉬기");
  public static final Map<String, String> TYPE_KO = Map.ofEntries(
    Map.entry("home", "집"), Map.entry("friend_home", "친구 집"), Map.entry("cafe", "카페"), Map.entry("restaurant", "식당"), Map.entry("park", "공원"),
    Map.entry("gym", "헬스장"), Map.entry("school", "학교"), Map.entry("library", "도서관"), Map.entry("cinema", "영화관"), Map.entry("mall", "쇼핑몰"),
    Map.entry("river", "강변"), Map.entry("beach", "해변"), Map.entry("museum", "박물관·명소"), Map.entry("arcade", "오락실"), Map.entry("bar", "술집"),
    Map.entry("office", "일터"), Map.entry("station", "역"), Map.entry("airport", "공항"), Map.entry("port", "항구"), Map.entry("temple", "절·신사"),
    Map.entry("market", "시장·거리"), Map.entry("hotel", "호텔"), Map.entry("stadium", "경기장"), Map.entry("mountain", "산"), Map.entry("island", "섬"));
  /** 범주마다 말이 되는 장소 유형. 밥을 헬스장에서 먹지 않게 — 여기 없는 조합은 카드에서 뺀다. */
  public static final Map<String, List<String>> TYPES_FOR = Map.of(
    "meal", List.of("restaurant", "cafe", "market", "home", "friend_home", "hotel", "bar"),
    "play", List.of("cafe", "park", "river", "beach", "museum", "arcade", "bar", "mall", "cinema", "market", "temple", "stadium", "mountain", "island", "friend_home", "home"),
    "exercise", List.of("gym", "park", "river", "mountain", "beach", "stadium", "home"),
    "study", List.of("library", "cafe", "home", "school", "museum"),
    "work", List.of("office", "cafe", "home", "library"),
    "rest", List.of("home", "cafe", "park", "river", "beach", "hotel", "friend_home", "temple", "library"));
  public static final Map<String, String> TYPE_EMOJI = Map.ofEntries(
    Map.entry("home", "🏠"), Map.entry("friend_home", "🏡"), Map.entry("cafe", "☕"), Map.entry("restaurant", "🍽️"), Map.entry("park", "🌳"),
    Map.entry("gym", "🏋️"), Map.entry("school", "🎓"), Map.entry("library", "📚"), Map.entry("cinema", "🎬"), Map.entry("mall", "🛍️"),
    Map.entry("river", "🌊"), Map.entry("beach", "🏖️"), Map.entry("museum", "🏛️"), Map.entry("arcade", "🕹️"), Map.entry("bar", "🍻"),
    Map.entry("office", "💼"), Map.entry("station", "🚄"), Map.entry("airport", "✈️"), Map.entry("port", "⛴️"), Map.entry("temple", "⛩️"),
    Map.entry("market", "🧺"), Map.entry("hotel", "🏨"), Map.entry("stadium", "🏟️"), Map.entry("mountain", "⛰️"), Map.entry("island", "🏝️"));

  /** 그 도시에서 갈 수 있는 장소 하나 (프론트 Place의 일부). */
  public record PlanPlace(String id, String name, String type, String area) {}
  /**
   * 계획을 지어 달라는 블록 하나. category는 null이면 모델이 고른다. avoid는 오늘 다른 블록에 이미 잡힌 장소 id,
   * previous는 "다른 제안 보기"에서 방금 보여 준 카드 제목들 — 요청에 없었으면 null.
   */
  public record PlanBlockRequest(String id, String category, String from, List<String> avoid, List<String> previous) {}
  /** "2026-09-08", "화요일" */
  public record PlanDay(String dateKey, String weekday) {}
  /** 지금 있는 도시 — 카탈로그는 이 도시의 장소들. home은 집이 있는 도시인가. */
  public record PlanCity(String key, String nameKo, boolean home) {}
  /** money는 원 단위 그대로, fatigue·mood는 0..100. */
  public record PlanStatus(long money, int fatigue, int mood) {}
  /** 검증·정규화를 거친 요청. worry는 null일 수 있다. */
  public record PlanRequest(String tier, Agent agent, PlanDay day, PlanCity city, PlanStatus status, String worry, List<String> visited, List<PlanPlace> places, List<PlanBlockRequest> blocks) {}

  public record PlanOption(String placeId, String title, String reason, String emoji) {}
  public record PlanBlock(String id, String category, List<PlanOption> options) {}
  /** 요청한 블록 중 제대로 지어진 것만. 빠진 블록은 프론트가 규칙으로 채운다. */
  public record PlanResponse(List<PlanBlock> blocks, String model, long ms) {}
}
