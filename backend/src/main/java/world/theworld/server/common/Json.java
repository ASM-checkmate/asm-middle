package world.theworld.server.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * JSON 문자열 컬럼(likes_json·traits_json·home_json·place_json·companions_json, BACKEND-CONTRACT §1) 읽고 쓰기.
 * 스프링의 ObjectMapper 하나를 같이 쓴다 — 체크 예외는 IllegalStateException으로(우리가 쓴 것만 읽으니 깨질 리 없다).
 */
@Component
public class Json {
  private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};
  private final ObjectMapper om;

  public Json(ObjectMapper om) { this.om = om; }

  public ObjectMapper mapper() { return om; }

  public String write(Object value) {
    try { return om.writeValueAsString(value); }
    catch (JsonProcessingException e) { throw new IllegalStateException("json write", e); }
  }

  public <T> T read(String json, Class<T> type) {
    try { return om.readValue(json, type); }
    catch (JsonProcessingException e) { throw new IllegalStateException("json read", e); }
  }

  public List<String> readStrings(String json) {
    try { return om.readValue(json, STRINGS); }
    catch (JsonProcessingException e) { throw new IllegalStateException("json read", e); }
  }

  /** 저장된 문서 본문이 JSON인지 (아니면 null). GET/409 응답에 raw로 실어 보내기 전 방어. */
  public JsonNode tryTree(String json) {
    try { return om.readTree(json); }
    catch (JsonProcessingException e) { return null; }
  }
}
