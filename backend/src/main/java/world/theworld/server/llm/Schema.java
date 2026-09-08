package world.theworld.server.llm;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Ollama structured output에 넘길 JSON 스키마를 Map/List로 짓는다 (BACKEND-CONTRACT §2.4).
 * `type: ['string', null]`·`enum: [..., null]`의 null이 직렬화에서 살아남아야 하므로 List.of(NPE) 대신 Arrays.asList를 쓴다.
 */
public final class Schema {
  private Schema() {}

  /** 삽입 순서를 지키는 맵 — 키·값 번갈아. */
  public static Map<String, Object> of(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }

  /** `{ type: [type, null] }` */
  public static Map<String, Object> nullable(String type) {
    return of("type", Arrays.asList(type, null));
  }

  /** `[...values, null]` — enum에 null을 허용할 때. */
  public static List<Object> withNull(List<String> values) {
    List<Object> out = new java.util.ArrayList<>(values);
    out.add(null);
    return out;
  }
}
