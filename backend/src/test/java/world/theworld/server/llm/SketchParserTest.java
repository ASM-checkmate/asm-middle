package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.llm.LlmDtos.SketchParsed;

/** 옛 Node 백엔드 scripts/sketch.test.mjs(커밋 0298e8d) '파서' 8개 이관. */
class SketchParserTest {
  private static final List<String> IDS = List.of("a", "b", "c");

  @Test
  void normal() {
    assertThat(SketchParser.parse("{\"seen\":\"컵\",\"optionId\":\"a\",\"category\":\"play\"}", IDS)).isEqualTo(new SketchParsed("a", "컵", "play"));
  }

  @Test
  void unknownCategoryIsNull() {
    assertThat(SketchParser.parse("{\"seen\":\"컵\",\"optionId\":null,\"category\":\"snack\"}", IDS).category()).isNull();
  }

  @Test
  void categoryOnly() {
    SketchParsed p = SketchParser.parse("{\"seen\":\"피자\",\"optionId\":null,\"category\":\"meal\"}", IDS);
    assertThat(p.category()).isEqualTo("meal");
    assertThat(p.optionId()).isNull();
  }

  @Test
  void unknownIdIsNull() {
    assertThat(SketchParser.parse("{\"seen\":\"컵\",\"optionId\":\"zzz\"}", IDS).optionId()).isNull();
  }

  @Test
  void nullIsNull() {
    assertThat(SketchParser.parse("{\"seen\":\"모르겠음\",\"optionId\":null}", IDS).optionId()).isNull();
  }

  @Test
  void seenIsCut() {
    assertThat(SketchParser.parse("{\"seen\":\"" + "가".repeat(40) + "\",\"optionId\":\"b\"}", IDS).seen()).hasSize(SketchPrompt.MAX_SEEN);
  }

  @Test
  void brokenJson() {
    assertThat(SketchParser.parse("컵", IDS)).isEqualTo(new SketchParsed(null, "", null));
  }
}
