package world.theworld.server.trip;

import com.fasterxml.jackson.databind.JsonNode;
import java.text.Normalizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import world.theworld.server.common.ApiException;
import world.theworld.server.trip.TripDtos.TripPlanRequest;
import world.theworld.server.trip.TripDtos.TripPlanResponse;

/** POST /api/trip/plan (docs/CONTRACT.md, ADR-0009). 400 계약 위반, 422 얇은 팩, 502 검색·모델·지오코딩 실패, 503 키 없음. */
@RestController
public class TripController {
  private static final Logger log = LoggerFactory.getLogger(TripController.class);
  private final TripService service;

  public TripController(TripService service) { this.service = service; }

  /** 여행지 요청이 계약대로인지 (server.ts validateTrip). city는 NFC·trim 후 1~40자(UTF-16 단위, JS length와 같다). */
  static TripPlanRequest validate(JsonNode b) {
    if (b == null || !b.isObject()) throw ApiException.badRequest("body must be an object");
    JsonNode tier = b.get("tier");
    if (tier == null || !tier.isTextual() || !(tier.asText().equals("small") || tier.asText().equals("good"))) throw ApiException.badRequest("tier must be small|good");
    JsonNode c = b.get("city");
    String city = c != null && c.isTextual() ? Normalizer.normalize(c.asText(), Normalizer.Form.NFC).strip() : "";
    if (city.isEmpty() || city.length() > 40) throw ApiException.badRequest("city must be 1-40 chars");
    return new TripPlanRequest(tier.asText(), city);
  }

  @PostMapping("/api/trip/plan")
  public TripPlanResponse plan(@RequestBody(required = false) JsonNode body) {
    TripPlanRequest req = validate(body);
    try {
      TripPlanResponse out = service.plan(req);
      log.info("[trip] {} → {} {} places {}ms{}", req.city(), out.city().key(), out.places().size(), out.ms(), out.cached() ? " cached" : " " + out.model());
      return out;
    } catch (ApiException e) {
      log.warn("[trip] {} failed: {}", req.city(), e.getMessage());
      throw e;
    }
  }
}
