package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 사진 → 겉모습 프롬프트·스키마: enum 이름이 전부 프롬프트와 스키마에 있고, 신원을 묻지 않는다. */
class LookPromptTest {
  /** 머리 모양·안경·수염·상의는 프롬프트가 이름을 붙여 설명한다. 피부·머리 색의 값은 스키마만 안다 (LookPrompt 주석의 실측). */
  @Test
  void namesTheDescribedOptions() {
    String p = LookPrompt.build();
    for (List<String> names : List.of(LlmDtos.LOOK_HAIR_STYLES, LlmDtos.LOOK_GLASSES, LlmDtos.LOOK_BEARDS, LlmDtos.LOOK_TOPS,
        LlmDtos.LOOK_FACES, LlmDtos.LOOK_EYES, LlmDtos.LOOK_BROWS, LlmDtos.LOOK_NOSES, LlmDtos.LOOK_MOUTHS, LlmDtos.LOOK_EARS, LlmDtos.LOOK_BUILDS)) {
      for (String n : names) assertThat(p).as(n).contains(n);
    }
    assertThat(p).contains("\"seen\"", "light", "dark");
    assertThat(p).doesNotContain("dark-brown");
  }

  @Test
  void neverAsksWhoItIs() {
    assertThat(LookPrompt.SYSTEM).contains("신원은 말하지 않는다");
    assertThat(LookPrompt.build()).contains("누구인지는 답하지 않는다");
  }

  @Test
  @SuppressWarnings("unchecked")
  void schemaRequiresAllFourteenWithEnums() {
    Map<String, Object> s = LookSchema.of();
    assertThat((List<String>) s.get("required")).containsExactly("skin", "hairColor", "hairStyle", "glasses", "beard", "top",
        "face", "eyes", "brows", "nose", "mouth", "ears", "build", "seen");
    Map<String, Object> props0 = (Map<String, Object>) s.get("properties");
    for (String k : LookSchema.REQUIRED) assertThat(props0).as(k).containsKey(k);
    assertThat(((Map<String, Object>) props0.get("build")).get("enum")).isEqualTo(LlmDtos.LOOK_BUILDS);
    Map<String, Object> props = (Map<String, Object>) s.get("properties");
    assertThat(((Map<String, Object>) props.get("hairStyle")).get("enum")).isEqualTo(LlmDtos.LOOK_HAIR_STYLES);
    assertThat(((Map<String, Object>) props.get("seen")).get("type")).isEqualTo("string");
    assertThat(((Map<String, Object>) props.get("top")).get("enum")).isEqualTo(LlmDtos.LOOK_TOPS);
  }
}
