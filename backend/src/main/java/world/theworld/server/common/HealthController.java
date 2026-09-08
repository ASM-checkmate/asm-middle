package world.theworld.server.common;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** GET /api/health → {ok:true} (docs/CONTRACT.md). 공개 경로 — 프런트가 30초마다 살아 있는지 묻는다(BACKEND-CONTRACT §3.3). */
@RestController
public class HealthController {
  @GetMapping("/api/health")
  public Map<String, Object> health() { return Map.of("ok", true); }
}
