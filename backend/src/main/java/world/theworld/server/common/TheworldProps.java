package world.theworld.server.common;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * application.yml의 {@code theworld.*} (BACKEND-CONTRACT §2.5). 환경변수로 덮어쓴다 — 키 이름은 yml에 있다.
 * llm/trip 패키지가 쓸 값(ollama·models·trip·search·nominatim)도 여기 미리 둔다 — 다음 단계가 그대로 주입받게.
 */
@ConfigurationProperties("theworld")
public record TheworldProps(
  @DefaultValue Cors cors,
  @DefaultValue Ollama ollama,
  @DefaultValue Models models,
  @DefaultValue Trip trip,
  @DefaultValue Search search,
  @DefaultValue Nominatim nominatim,
  @DefaultValue Docs docs
) {
  /** 허용 origin — 쉼표로 여러 개. 개발은 Vite 프록시라 same-origin이고 이건 직접 붙을 때용. */
  public record Cors(@DefaultValue("http://localhost:5173") String origins) {}
  /** Ollama 주소와 기본 타임아웃(reply·sketch). */
  public record Ollama(@DefaultValue("http://localhost:11434") String url, @DefaultValue("25000") long timeoutMs) {}
  /** 모델 단계(docs/CONTRACT.md GET /api/models). */
  public record Models(@DefaultValue("qwen3.5:9b") String small, @DefaultValue("qwen3.8:27b") String good) {}
  /** 여행 파이프라인(ADR-0009) — 비어 있으면 tier 모델, 데드라인 100초, 스니펫 예산 22k. */
  public record Trip(@DefaultValue("") String model, @DefaultValue("90000") long modelTimeoutMs, @DefaultValue("100000") long deadlineMs, @DefaultValue("22000") int snippetsMaxChars) {}
  /** Ollama 웹 검색 키 — 비어 있으면 /api/trip/plan은 503. */
  public record Search(@DefaultValue("") String apiKey) {}
  /** Nominatim 지오코딩 — 전역 1.1초 간격. */
  public record Nominatim(@DefaultValue("https://nominatim.openstreetmap.org") String url, @DefaultValue("") String contact, @DefaultValue("1100") long minGapMs) {}
  /** 문서 본문 상한(바이트) — /api/me/docs/* 4 MB (BACKEND-CONTRACT §2.2). */
  public record Docs(@DefaultValue("4194304") long maxBytes) {}
}
