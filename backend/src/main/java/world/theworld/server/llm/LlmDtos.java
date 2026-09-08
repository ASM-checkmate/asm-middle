package world.theworld.server.llm;

import java.util.List;

/**
 * LLM 계약의 JSON 모양 (옛 Node 백엔드 contract.ts(커밋 0298e8d)·docs/CONTRACT.md 그대로). 필드명은 프런트 sim/llm.ts와 글자 그대로.
 * 응답의 `string | null` 필드(text·worry·trip·optionId·category)는 null을 그대로 낸다 — NON_NULL을 쓰지 않는다.
 */
public final class LlmDtos {
  private LlmDtos() {}

  /** 무엇 때문에 지쳤는가 — 프런트 sim/types.ts의 WorryKey에서 'none'을 뺀 것. */
  public static final List<String> WORRY_KEYS = List.of("work", "people", "body", "money", "focus", "blue", "bored");
  /** 앱의 활동 범주(sleep 제외) — 그림이 어느 범주로 읽히는지. */
  public static final List<String> SKETCH_CATEGORIES = List.of("meal", "play", "exercise", "study", "work", "rest", "travel");

  // ── 답장 ──
  public record Agent(String name, List<String> traits, List<String> likes, List<String> dislikes) {}
  /** lateWhy·worry는 null일 수 있다. mood·fatigue는 0..100. */
  public record Situation(String where, String doing, String hhmm, String lateWhy, int mood, int fatigue, String worry) {}
  public record RecentMsg(String from, String text) {}
  /** 검증·정규화를 거친 요청. batch는 선택 — 같은 (user, batch)의 진행 중 호출을 새 호출이 취소한다 (§2.4). */
  public record ReplyRequest(String tier, Agent agent, Situation situation, List<RecentMsg> recent, List<String> texts, String batch) {}
  public record ReplyResponse(String text, String worry, boolean callMe, String trip, String model, long ms) {}
  /** 파서 결과 — 모델 출력에서 계약대로 다듬은 네 칸. */
  public record ReplyParsed(String text, String worry, boolean callMe, String trip) {}

  // ── 그림 읽기 ──
  public record SketchOption(String id, String title, String placeName, String placeType) {}
  public record SketchReadRequest(String tier, String sketch, String category, List<SketchOption> options) {}
  public record SketchReadResponse(String optionId, String seen, String category, String model, long ms) {}
  public record SketchParsed(String optionId, String seen, String category) {}

  // ── 모델 ──
  public record TierInfo(String model, boolean installed) {}
  public record Tiers(TierInfo small, TierInfo good) {}
  public record ModelsResponse(Tiers tiers, boolean ollama) {}
}
