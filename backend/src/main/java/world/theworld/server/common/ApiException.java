package world.theworld.server.common;

/**
 * 계약이 정한 오류 한 줄 — 본문은 항상 {@code { "error": string }} (BACKEND-CONTRACT §0, docs/CONTRACT.md).
 * 400 검증 · 401 인증 · 403 금지 · 404 없음 · 409 충돌 · 413 본문 초과 · 422 얇은 팩 · 502 외부 실패 · 503 키 없음.
 */
public class ApiException extends RuntimeException {
  private final int status;

  public ApiException(int status, String message) {
    super(message);
    this.status = status;
  }

  public int status() { return status; }

  public static ApiException badRequest(String message) { return new ApiException(400, message); }
  public static ApiException unauthorized() { return new ApiException(401, "unauthorized"); }
  public static ApiException forbidden(String message) { return new ApiException(403, message); }
  public static ApiException notFound() { return new ApiException(404, "not found"); }
  public static ApiException notFound(String message) { return new ApiException(404, message); }
  public static ApiException tooLarge() { return new ApiException(413, "body too large"); }
}
