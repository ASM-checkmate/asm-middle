package world.theworld.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.LookRequest;

/** POST /api/character/look 검증 문자열 (docs/CONTRACT.md). */
class LookValidatorTest {
  private static final ObjectMapper OM = new ObjectMapper();

  private static void bad(String body, String error) throws Exception {
    assertThatThrownBy(() -> LookValidator.validate(OM.readTree(body))).isInstanceOf(ApiException.class).hasMessage(error);
  }

  @Test
  void rejectsBadTier() throws Exception {
    bad("{}", "tier must be small|good");
    bad("{\"tier\":\"x\",\"photo\":\"data:image/jpeg;base64,AAAA\"}", "tier must be small|good");
    bad("[1]", "body must be an object");
    assertThatThrownBy(() -> LookValidator.validate(null)).isInstanceOf(ApiException.class).hasMessage("body must be an object");
  }

  @Test
  void rejectsBadPhoto() throws Exception {
    bad("{\"tier\":\"good\"}", "photo must be an image dataURL");
    bad("{\"tier\":\"good\",\"photo\":\"data:image/gif;base64,AAAA\"}", "photo must be an image dataURL");
    bad("{\"tier\":\"good\",\"photo\":\"data:image/jpeg;base64,AA A\"}", "photo must be an image dataURL");
    bad("{\"tier\":\"good\",\"photo\":\"https://example.com/a.jpg\"}", "photo must be an image dataURL");
  }

  @Test
  void ok() throws Exception {
    LookRequest r = LookValidator.validate(OM.readTree("{\"tier\":\"good\",\"photo\":\"data:image/webp;base64,AAAA\"}"));
    assertThat(r).isEqualTo(new LookRequest("good", "data:image/webp;base64,AAAA"));
  }
}
