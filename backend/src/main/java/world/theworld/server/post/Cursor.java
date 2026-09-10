package world.theworld.server.post;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import world.theworld.server.common.ApiException;

/**
 * 불투명 커서 (§2.5) — {@code <section>:<offset>}를 base64url로. section은 피드의 'f'(친구 글)·'r'(추천), 글 격자의 'u'.
 * 클라이언트는 열어 보지 않고 그대로 되돌려 준다. 모양이 틀리면 400 'cursor invalid'.
 */
record Cursor(char section, long offset) {
  static final char FRIENDS = 'f';
  static final char RECOMMENDED = 'r';
  static final char USER = 'u';

  String encode() {
    return Base64.getUrlEncoder().withoutPadding().encodeToString((section + ":" + offset).getBytes(StandardCharsets.UTF_8));
  }

  /** null이면 그 구간의 처음. allowed에 없는 구간이면 400. */
  static Cursor decode(String raw, char first, String allowed) {
    if (raw == null || raw.isEmpty()) return new Cursor(first, 0);
    try {
      String s = new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8);
      if (s.length() < 3 || s.charAt(1) != ':' || allowed.indexOf(s.charAt(0)) < 0) throw ApiException.badRequest("cursor invalid");
      long offset = Long.parseLong(s.substring(2));
      // JPA setFirstResult가 int라 그 위는 500으로 새지 않게 여기서 400 (offset이 그만큼 커질 표는 없다)
      if (offset < 0 || offset > Integer.MAX_VALUE) throw ApiException.badRequest("cursor invalid");
      return new Cursor(s.charAt(0), offset);
    } catch (IllegalArgumentException e) {   // base64·숫자 모양
      throw ApiException.badRequest("cursor invalid");
    }
  }
}
