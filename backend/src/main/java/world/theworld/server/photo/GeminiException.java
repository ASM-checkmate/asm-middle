package world.theworld.server.photo;

import world.theworld.server.common.ApiException;

/** Gemini 호출 실패 — 키 없음(503)·응답 오류/그림 없음(502). GlobalExceptionHandler가 ApiException으로 그대로 낸다. */
public class GeminiException extends ApiException {
  public GeminiException(int status, String message) { super(status, message); }
}
