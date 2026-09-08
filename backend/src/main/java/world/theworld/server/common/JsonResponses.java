package world.theworld.server.common;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** 필터에서 직접 쓰는 {@code { "error": … }} 응답 — 컨트롤러 밖이라 Jackson 대신 손으로 이스케이프한다. */
public final class JsonResponses {
  private JsonResponses() {}

  public static void write(HttpServletResponse res, int status, String error) throws IOException {
    res.setStatus(status);
    res.setContentType("application/json");
    res.setCharacterEncoding(StandardCharsets.UTF_8.name());
    res.getWriter().write("{\"error\":\"" + escape(error) + "\"}");
    res.getWriter().flush();
  }

  static String escape(String s) {
    StringBuilder b = new StringBuilder(s.length() + 8);
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
      }
    }
    return b.toString();
  }
}
