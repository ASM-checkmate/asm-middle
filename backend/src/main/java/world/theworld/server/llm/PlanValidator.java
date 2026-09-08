package world.theworld.server.llm;

import static world.theworld.server.llm.PlanDtos.MAX_BLOCKS;
import static world.theworld.server.llm.PlanDtos.MAX_PLACES;
import static world.theworld.server.llm.PlanDtos.PLAN_BLOCKS;
import static world.theworld.server.llm.PlanDtos.PLAN_CATEGORIES;
import static world.theworld.server.llm.PlanDtos.PLAN_PLACE_TYPES;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import world.theworld.server.common.ApiException;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.PlanDtos.PlanBlockRequest;
import world.theworld.server.llm.PlanDtos.PlanCity;
import world.theworld.server.llm.PlanDtos.PlanDay;
import world.theworld.server.llm.PlanDtos.PlanPlace;
import world.theworld.server.llm.PlanDtos.PlanRequest;
import world.theworld.server.llm.PlanDtos.PlanStatus;

/**
 * POST /api/plan/options 요청 검증·정규화 (옛 Node 백엔드 server.ts(커밋 2808024) validatePlan 그대로). 프론트가 카탈로그를 통째로 보내므로
 * 크기 상한(장소 120·블록 6·문자열 길이)을 넘는 건 거부하지 않고 자른다. 모르는 장소 유형·블록 id·범주는 조용히 빠지고, 남은 게 없을 때만 400.
 * 오류 문자열은 계약(docs/CONTRACT.md)에 고정.
 */
public final class PlanValidator {
  private PlanValidator() {}

  /** 문자열만 남기고 40자로 잘라 cap개까지 (validatePlan strs). */
  static List<String> strs(JsonNode v, int cap) {
    List<String> out = new ArrayList<>();
    if (v != null && v.isArray()) {
      for (JsonNode x : v) {
        if (!x.isTextual()) continue;
        out.add(Text.cut(x.asText(), 40));
        if (out.size() >= cap) break;
      }
    }
    return out;
  }

  /** finite 숫자면 반올림, 아니면 기본값 (validatePlan num — 여기서는 clamp하지 않는다, 돈이 지나간다). */
  static long num(JsonNode v, long fb) {
    if (v == null || !v.isNumber() || !Double.isFinite(v.doubleValue())) return fb;
    return Math.round(v.doubleValue());
  }

  /** 0..100 */
  static int clamp(long n) { return (int) Math.max(0, Math.min(100, n)); }

  /** 요청이 계약대로인지. 틀리면 400 한 줄. */
  public static PlanRequest validate(JsonNode b) {
    if (b == null || !b.isObject()) throw ApiException.badRequest("body must be an object");
    JsonNode tier = b.get("tier");
    if (!ReplyValidator.isText(tier) || !(tier.asText().equals("small") || tier.asText().equals("good"))) throw ApiException.badRequest("tier must be small|good");
    JsonNode a = b.get("agent");
    if (a == null || !a.isObject() || !ReplyValidator.isText(a.get("name"))) throw ApiException.badRequest("agent.name required");
    JsonNode day = b.get("day");
    if (day == null || !day.isObject() || !ReplyValidator.isText(day.get("dateKey")) || !ReplyValidator.isText(day.get("weekday"))) throw ApiException.badRequest("day.dateKey/weekday required");
    JsonNode city = b.get("city");
    if (city == null || !city.isObject() || !ReplyValidator.isText(city.get("key")) || !ReplyValidator.isText(city.get("nameKo"))) throw ApiException.badRequest("city.key/nameKo required");
    JsonNode st = b.get("status");   // 없어도 된다 — 기본값으로

    // 카탈로그: id·name·아는 유형이 있는 것만, 120개까지. 원본은 항목이 객체가 아니면(null) TypeError로 500이 났다 — 여기서는 건너뛴다
    List<PlanPlace> places = new ArrayList<>();
    JsonNode ps = b.get("places");
    if (ps != null && ps.isArray()) {
      for (JsonNode p : ps) {
        if (!p.isObject()) continue;
        JsonNode type = p.get("type");
        if (!ReplyValidator.isText(p.get("id")) || !ReplyValidator.isText(p.get("name")) || !ReplyValidator.isText(type) || !PLAN_PLACE_TYPES.contains(type.asText())) continue;
        JsonNode area = p.get("area");
        places.add(new PlanPlace(p.get("id").asText(), Text.cut(p.get("name").asText(), 40), type.asText(), ReplyValidator.isText(area) ? Text.cut(area.asText(), 20) : ""));
        if (places.size() >= MAX_PLACES) break;
      }
    }
    if (places.isEmpty()) throw ApiException.badRequest("places must be a non-empty array");
    Set<String> ids = new HashSet<>();
    for (PlanPlace p : places) ids.add(p.id());

    // 블록: 아는 id만, 6개까지. avoid는 카탈로그에 있는 id만, previous는 키가 배열일 때만(없으면 null)
    List<PlanBlockRequest> blocks = new ArrayList<>();
    JsonNode bs = b.get("blocks");
    if (bs != null && bs.isArray()) {
      for (JsonNode x : bs) {
        if (!x.isObject()) continue;
        JsonNode id = x.get("id");
        if (!ReplyValidator.isText(id) || !PLAN_BLOCKS.contains(id.asText())) continue;
        JsonNode cat = x.get("category");
        JsonNode from = x.get("from");
        JsonNode prev = x.get("previous");
        List<String> avoid = strs(x.get("avoid"), 12).stream().filter(ids::contains).toList();
        blocks.add(new PlanBlockRequest(id.asText(),
          ReplyValidator.isText(cat) && PLAN_CATEGORIES.contains(cat.asText()) ? cat.asText() : null,
          ReplyValidator.isText(from) ? Text.cut(from.asText(), 40) : "",
          avoid,
          prev != null && prev.isArray() ? strs(prev, 6) : null));
        if (blocks.size() >= MAX_BLOCKS) break;
      }
    }
    if (blocks.isEmpty()) throw ApiException.badRequest("blocks must have 1-6 known block ids");

    JsonNode worry = b.get("worry");
    JsonNode home = city.get("home");
    return new PlanRequest(
      tier.asText(),
      new Agent(Text.cut(a.get("name").asText(), 20), strs(a.get("traits"), 12), strs(a.get("likes"), 12), strs(a.get("dislikes"), 12)),
      new PlanDay(Text.cut(day.get("dateKey").asText(), 10), Text.cut(day.get("weekday").asText(), 4)),
      new PlanCity(Text.cut(city.get("key").asText(), 40), Text.cut(city.get("nameKo").asText(), 20), home != null && home.isBoolean() && home.booleanValue()),
      new PlanStatus(num(st == null ? null : st.get("money"), 0), clamp(num(st == null ? null : st.get("fatigue"), 30)), clamp(num(st == null ? null : st.get("mood"), 60))),
      ReplyValidator.isText(worry) && LlmDtos.WORRY_KEYS.contains(worry.asText()) ? worry.asText() : null,
      strs(b.get("visited"), 10),
      places,
      blocks);
  }
}
