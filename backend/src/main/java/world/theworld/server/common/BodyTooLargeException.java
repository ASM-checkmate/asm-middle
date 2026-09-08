package world.theworld.server.common;

import java.io.IOException;

/**
 * 세는 입력 스트림이 한도를 넘었다 (BodyLimitFilter). Jackson이 본문을 읽는 중에 나면 HttpMessageNotReadableException의 원인이
 * 되고, GlobalExceptionHandler.unreadable이 계약의 413 {error:'body too large'}(BACKEND-CONTRACT §0)로 바꾼다.
 */
public class BodyTooLargeException extends IOException {
  public BodyTooLargeException(long limit) {
    super("body too large (limit " + limit + " bytes)");
  }
}
