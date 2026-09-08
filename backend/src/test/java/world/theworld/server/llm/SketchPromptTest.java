package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 옛 Node 백엔드 scripts/sketch.test.mjs(커밋 0298e8d) '프롬프트' 3개 + 스키마 항목 이관. */
class SketchPromptTest {
  @Test
  void optionsWithIds() {
    String p = SketchPrompt.build(LlmFixtures.sketchReq());
    assertThat(p).contains("id=\"a\"", "id=\"b\"", "id=\"c\"", "경의선숲길 산책");
    assertThat(p).contains("2. id=\"b\" — 경의선숲길 산책 (경의선숲길, park)");
  }

  @Test
  void saysNullWhenUnsure() {
    assertThat(SketchPrompt.build(LlmFixtures.sketchReq())).contains("null");
  }

  /** Node readSketch의 시스템 문장·buildSketchPrompt(sketch.test.mjs의 고정 요청)와 글자 단위로 같다. */
  @Test
  void exactlyTheNodePrompt() {
    assertThat(SketchPrompt.SYSTEM).isEqualTo(LlmFixtures.golden("sketch-system"));
    assertThat(SketchPrompt.build(LlmFixtures.sketchReq())).isEqualTo(LlmFixtures.golden("sketch-user"));
  }

  @Test
  @SuppressWarnings("unchecked")
  void schemaAllowsOnlyIdsAndNull() throws Exception {
    Map<String, Object> s = SketchSchema.of(List.of("a", "b"));
    Map<String, Object> props = (Map<String, Object>) s.get("properties");
    assertThat(((Map<String, Object>) props.get("optionId")).get("enum")).isEqualTo(Arrays.asList("a", "b", null));
    List<Object> cat = (List<Object>) ((Map<String, Object>) props.get("category")).get("enum");
    assertThat(cat).contains("meal").contains((Object) null);
    assertThat(LlmFixtures.OM.writeValueAsString(s)).contains("\"enum\":[\"a\",\"b\",null]");
  }
}
