package world.theworld.server.common;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 모든 오류를 {@code { "error": string }} 한 모양으로 (BACKEND-CONTRACT §0).
 * Node 백엔드(옛 Node 백엔드 server.ts(커밋 0298e8d))의 관례를 그대로: JSON이 깨지면 400 'bad json: …', 모르는 경로 404, 처리 중 예외 500.
 * 500의 본문은 고정 문자열이다 — 예외 메시지(SQL·테이블·사용자 id)는 로그에만 남긴다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  private static ResponseEntity<Map<String, Object>> error(int status, String message) {
    return ResponseEntity.status(status).body(Map.of("error", message == null ? "error" : message));
  }

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<Map<String, Object>> api(ApiException e) {
    return error(e.status(), e.getMessage());
  }

  /** Bean Validation 실패 — 첫 필드 오류 한 줄만 돌려준다. */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> invalid(MethodArgumentNotValidException e) {
    FieldError f = e.getBindingResult().getFieldError();
    String detail = f == null ? e.getBindingResult().getAllErrors().stream().findFirst().map(o -> o.getDefaultMessage()).orElse("invalid")
      : f.getField() + " " + f.getDefaultMessage();
    return error(400, "bad json: " + detail);
  }

  /** JSON 파싱 실패(문법·타입 불일치) — 원인 메시지는 앞 200자만. 읽는 중 본문 상한을 넘었으면(chunked, BodyLimitFilter) 413. */
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
    Throwable root = e.getMostSpecificCause();
    if (root instanceof BodyTooLargeException) return error(413, "body too large");
    String msg = root == null || root.getMessage() == null ? "unreadable body" : root.getMessage();
    if (msg.length() > 200) msg = msg.substring(0, 200);
    return error(400, "bad json: " + msg);
  }

  @ExceptionHandler(MissingServletRequestParameterException.class)
  public ResponseEntity<Map<String, Object>> missingParam(MissingServletRequestParameterException e) {
    return error(400, e.getParameterName() + " required");
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<Map<String, Object>> badParam(MethodArgumentTypeMismatchException e) {
    return error(400, e.getName() + " must be a number");
  }

  @ExceptionHandler({ NoResourceFoundException.class, NoHandlerFoundException.class })
  public ResponseEntity<Map<String, Object>> notFound(Exception e) {
    return error(404, "not found");
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<Map<String, Object>> methodNotAllowed(HttpRequestMethodNotSupportedException e) {
    return error(405, "method not allowed");
  }

  @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<Map<String, Object>> mediaType(HttpMediaTypeNotSupportedException e) {
    return error(415, "content-type must be application/json");
  }

  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<Map<String, Object>> status(ResponseStatusException e) {
    HttpStatus s = HttpStatus.resolve(e.getStatusCode().value());
    return error(e.getStatusCode().value(), e.getReason() != null ? e.getReason() : (s != null ? s.getReasonPhrase().toLowerCase() : "error"));
  }

  /**
   * 유일 키 위반 — 같은 행을 두 요청이 동시에 만들었다(문서 첫 생성·친구 추가). 컨트롤러가 한 번 더 시도해 정상 응답으로
   * 바꾸고, 여기는 마지막 그물 — 계약의 충돌 코드 409로, DB 메시지는 내보내지 않는다.
   */
  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<Map<String, Object>> integrity(DataIntegrityViolationException e) {
    log.warn("integrity violation: {}", e.getMostSpecificCause().getMessage());
    return error(409, "conflict");
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> unexpected(Exception e) {
    log.error("unhandled", e);
    return error(500, "internal error");
  }
}
