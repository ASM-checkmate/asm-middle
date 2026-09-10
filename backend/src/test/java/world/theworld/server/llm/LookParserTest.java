package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmDtos.Look;
import world.theworld.server.llm.LlmDtos.LookParsed;

/** 사진 → 겉모습 파서: 정상값은 그대로, 빠지거나 enum 밖이면 기본값, seen은 한 줄 60자. */
class LookParserTest {
  @Test
  void normal() {
    LookParsed p = LookParser.parse("{\"skin\":\"dark\",\"hairColor\":\"black\",\"hairStyle\":\"short\",\"glasses\":\"none\",\"beard\":\"none\",\"top\":\"night\","
        + "\"face\":\"long\",\"eyes\":\"dot\",\"brows\":\"thick\",\"nose\":\"small\",\"mouth\":\"wide\",\"ears\":\"out\",\"build\":\"slim\",\"seen\":\"짙은 정장의 남성\"}");
    assertThat(p.look()).isEqualTo(new Look("dark", "black", "short", "none", "none", "night", "long", "dot", "thick", "small", "wide", "out", "slim"));
    assertThat(p.seen()).isEqualTo("짙은 정장의 남성");
  }

  @Test
  void invalidEnumFallsBackToDefault() {
    LookParsed p = LookParser.parse("{\"skin\":\"olive\",\"hairColor\":\"black\",\"hairStyle\":\"mohawk\",\"glasses\":\"sun\",\"beard\":\"none\",\"top\":\"purple\",\"face\":\"oval\",\"eyes\":\"huge\",\"build\":\"wide\",\"seen\":\"x\"}");
    assertThat(p.look()).isEqualTo(new Look("fair", "black", "bowl", "none", "none", "coral", "round", "dot", "none", "none", "smile", "hidden", "wide"));
  }

  @Test
  void missingFieldsAreDefaults() {
    LookParsed p = LookParser.parse("{\"hairColor\":\"blond\"}");
    assertThat(p.look()).isEqualTo(new Look("fair", "blond", "bowl", "none", "none", "coral", "round", "dot", "none", "none", "smile", "hidden", "normal"));
    assertThat(p.seen()).isEmpty();
  }

  @Test
  void seenIsCollapsedAndCut() {
    String longSeen = "아주  긴\n설명 ".repeat(20);
    LookParsed p = LookParser.parse("{\"seen\":\"" + longSeen.replace("\n", "\\n") + "\"}");
    assertThat(p.seen()).doesNotContain("\n").doesNotContain("  ");
    assertThat(p.seen().length()).isLessThanOrEqualTo(LookPrompt.MAX_SEEN);
  }

  @Test
  void garbageIsAllDefaults() {
    assertThat(LookParser.parse("not json")).isEqualTo(new LookParsed(LlmDtos.LOOK_DEFAULT, ""));
    assertThat(LookParser.parse("[1,2]")).isEqualTo(new LookParsed(LlmDtos.LOOK_DEFAULT, ""));
    assertThat(LookParser.parse("null")).isEqualTo(new LookParsed(LlmDtos.LOOK_DEFAULT, ""));
  }
}
