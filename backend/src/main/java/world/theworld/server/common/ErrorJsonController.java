package world.theworld.server.common;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 디스패처 밖(필터·컨테이너)에서 난 오류도 {@code { "error": string }}으로 — Boot 기본 /error 본문 대신 (BACKEND-CONTRACT §0).
 * 컨트롤러 안의 예외는 {@link GlobalExceptionHandler}가 먼저 받는다.
 */
@RestController
public class ErrorJsonController implements ErrorController {
  @RequestMapping("/error")
  public ResponseEntity<Map<String, Object>> error(HttpServletRequest req) {
    Object code = req.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
    int status = code instanceof Integer i ? i : 500;
    String message = switch (status) {
      case 400 -> "bad request";
      case 401 -> "unauthorized";
      case 403 -> "forbidden";
      case 404 -> "not found";
      case 405 -> "method not allowed";
      case 413 -> "body too large";
      default -> "internal error";
    };
    return ResponseEntity.status(status).body(Map.of("error", message));
  }
}
