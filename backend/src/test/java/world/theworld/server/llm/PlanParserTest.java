package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.PlanDtos.PlanBlock;
import world.theworld.server.llm.PlanDtos.PlanOption;
import world.theworld.server.llm.PlanDtos.PlanRequest;

/** 옛 Node 백엔드 scripts/plan.test.mjs(커밋 2808024) '파서' 8개 이관 + 상한·중복 블록. */
class PlanParserTest {
  private final PlanRequest req = PlanFixtures.planReq();

  /** plan.test.mjs:44-58 — 범주에 안 맞는 유형·카탈로그 밖·정해진 범주와 다른 범주·중복·긴 글·이모지 아닌 것·요청에 없는 블록. */
  private static final String RAW = "{\"blocks\":["
    + "{\"id\":\"am\",\"category\":\"study\",\"options\":["
    + "{\"placeId\":\"mapo-central-library\",\"title\":\"마포중앙도서관에서 책 읽기\",\"reason\":\"조용한 자리 좋아함\",\"emoji\":\"📚\"},"
    + "{\"placeId\":\"layered-yeonnam\",\"title\":\"레이어드에서 스케치\",\"reason\":\"창가 자리\",\"emoji\":\"☕️\"},"
    + "{\"placeId\":\"the-climb-yeonnam\",\"title\":\"클라이밍\",\"reason\":\"공부 범주에 헬스장은 안 맞음\",\"emoji\":\"🧗\"},"
    + "{\"placeId\":\"nope\",\"title\":\"없는 곳\",\"reason\":\"\",\"emoji\":\"❓\"}]},"
    + "{\"id\":\"lunch\",\"category\":\"play\",\"options\":["
    + "{\"placeId\":\"tuktuk-noodle\",\"title\":\"툭툭누들에서 팟타이\",\"reason\":\"매운 건 빼고\",\"emoji\":\"🍜\"},"
    + "{\"placeId\":\"tuktuk-noodle\",\"title\":\"또 툭툭\",\"reason\":\"중복\",\"emoji\":\"🍜\"},"
    + "{\"placeId\":\"home\",\"title\":\"집에서 " + "가".repeat(40) + "\",\"reason\":\"" + "나".repeat(50) + "\",\"emoji\":\"x\"}]},"
    + "{\"id\":\"pm\",\"category\":\"rest\",\"options\":[{\"placeId\":\"home\",\"title\":\"집\",\"reason\":\"\",\"emoji\":\"🏠\"}]}"
    + "]}";

  private static String block(String id, String category, String options) {
    return "{\"blocks\":[{\"id\":\"" + id + "\",\"category\":\"" + category + "\",\"options\":[" + options + "]}]}";
  }

  private static String card(String placeId, String title, String reason, String emoji) {
    return "{\"placeId\":\"" + placeId + "\",\"title\":\"" + title + "\",\"reason\":\"" + reason + "\",\"emoji\":\"" + emoji + "\"}";
  }

  @Test
  void onlyAskedBlocksSurvive() {
    List<PlanBlock> out = PlanParser.parse(RAW, req);
    assertThat(out).extracting(PlanBlock::id).containsExactly("am", "lunch");
  }

  @Test
  void amDropsWrongTypeAndUnknownPlace() {
    PlanBlock am = PlanParser.parse(RAW, req).get(0);
    assertThat(am.category()).isEqualTo("study");
    assertThat(am.options()).hasSize(2);
    assertThat(am.options()).extracting(PlanOption::placeId).containsExactly("mapo-central-library", "layered-yeonnam");
  }

  @Test
  void lunchFixedCategoryDedupCutAndTypeEmoji() {
    PlanBlock lunch = PlanParser.parse(RAW, req).get(1);
    assertThat(lunch.category()).isEqualTo("meal");
    assertThat(lunch.options()).hasSize(2);
    PlanOption home = lunch.options().get(1);
    assertThat(home.placeId()).isEqualTo("home");
    assertThat(home.title()).hasSize(PlanDtos.MAX_TITLE);
    assertThat(home.reason()).hasSize(PlanDtos.MAX_REASON);
    assertThat(home.emoji()).isEqualTo("🏠");
  }

  @Test
  void oneEmojiWithVariationSelector() {
    assertThat(PlanParser.parse(RAW, req).get(0).options().get(1).emoji()).isEqualTo("☕️");
    // 이모지 뒤에 글이 붙어 있으면 이모지만, ZWJ로 이은 것은 통째로, 둘이면 첫 것만
    List<PlanBlock> out = PlanParser.parse(block("lunch", "meal", card("home", "집밥", "", "🍚 밥") + "," + card("tuktuk-noodle", "팟타이", "", "👨‍🍳👩") ), req);
    assertThat(out.get(0).options().get(0).emoji()).isEqualTo("🍚");
    assertThat(out.get(0).options().get(1).emoji()).isEqualTo("👨‍🍳");
  }

  @Test
  void fewerThanTwoCardsDropsBlock() {
    assertThat(PlanParser.parse(block("am", "study", card("home", "집", "", "🏠")), req)).isEmpty();
  }

  @Test
  void unknownCategoryWhenNotFixedDropsBlock() {
    assertThat(PlanParser.parse(block("am", "sleep", ""), req)).isEmpty();
  }

  @Test
  void brokenJsonIsEmpty() {
    assertThat(PlanParser.parse("{", req)).isEmpty();
    assertThat(PlanParser.parse("{\"blocks\":\"x\"}", req)).isEmpty();
    assertThat(PlanParser.parse("", req)).isEmpty();
    assertThat(PlanParser.parse("null", req)).isEmpty();
    assertThat(PlanParser.parse("[1]", req)).isEmpty();
  }

  @Test
  void emptyReasonIsFilled() {
    List<PlanBlock> out = PlanParser.parse(block("lunch", "meal", card("home", "집밥", "", "🍚") + "," + card("tuktuk-noodle", "팟타이", "", "🍜")), req);
    assertThat(out.get(0).options().get(0).reason()).isEqualTo("왠지 오늘은 여기");
  }

  @Test
  void atMostThreeCardsAndWhitespaceCollapsed() {
    String four = card("home", "  집에서\\n  밥 ", " 편함\\t", "🍚") + "," + card("tuktuk-noodle", "팟타이", "", "🍜") + "," + card("layered-yeonnam", "레이어드", "", "☕") + "," + card("gyeongui-line-forest", "숲길", "", "🌳");
    List<PlanBlock> out = PlanParser.parse(block("lunch", "meal", four), req);
    assertThat(out.get(0).options()).hasSize(3);
    assertThat(out.get(0).options().get(0).title()).isEqualTo("집에서 밥");
    assertThat(out.get(0).options().get(0).reason()).isEqualTo("편함");
  }

  @Test
  void duplicateBlockAndEmptyTitleAndJunkEntries() {
    String twoAm = "{\"blocks\":[null,1,\"x\","
      + "{\"id\":\"am\",\"category\":\"study\",\"options\":[null," + card("home", "", "이유", "🏠") + "," + card("home", "집", "", "🏠") + "," + card("layered-yeonnam", "레이어드", "", "☕") + "]},"
      + "{\"id\":\"am\",\"category\":\"work\",\"options\":[" + card("home", "집", "", "🏠") + "," + card("wework-hongdae", "위워크", "", "💼") + "]}]}";
    List<PlanBlock> out = PlanParser.parse(twoAm, req);
    assertThat(out).hasSize(1);
    assertThat(out.get(0).category()).isEqualTo("study");   // 두 번째 am은 버린다
    assertThat(out.get(0).options()).extracting(PlanOption::placeId).containsExactly("home", "layered-yeonnam");   // 제목 없는 카드는 뺀다
  }
}
