package world.theworld.server.sync;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/** 문서 동기화 JSON 모양 (BACKEND-CONTRACT §2.2). 이름은 계약 그대로(camelCase). body는 저장된 JSON 문자열을 raw로 싣는다. */
public final class DocDtos {
  private DocDtos() {}

  public record DocMeta(long version, long updatedAt, long clientTs) {}
  public record DocsList(Map<String, DocMeta> docs) {}
  public record DocView(String name, long version, long updatedAt, long clientTs, @JsonRawValue String body) {}
  public record PutRequest(Long baseVersion, Long clientTs, JsonNode body, Boolean force) {}
  public record PutOk(String name, long version, long updatedAt) {}
  /** 409 — 서버본을 그대로 돌려줘 클라이언트가 결정한다. 서버에 문서가 없으면 version 0에 나머지는 null. */
  public record Conflict(String error, String name, long version, Long updatedAt, Long clientTs, @JsonRawValue String body) {}

  /** PUT 결과 — 200 또는 409. */
  public sealed interface PutOutcome permits Saved, Conflicted {}
  public record Saved(PutOk ok) implements PutOutcome {}
  public record Conflicted(Conflict conflict) implements PutOutcome {}
}
