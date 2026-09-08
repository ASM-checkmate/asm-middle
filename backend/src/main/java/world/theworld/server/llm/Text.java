package world.theworld.server.llm;

import java.util.regex.Pattern;

/**
 * Node 원본(backend/src)이 쓰던 JS 문자열 규칙의 Java 대응 — `.replace(/\s+/g, ' ').trim()`·`.slice(0, n)`을 같은 뜻으로.
 * `\s`는 JS처럼 유니코드 공백(전각 공백·NBSP)까지 보게 UNICODE_CHARACTER_CLASS로 둔다. 길이는 JS `length`와 같은 UTF-16 단위.
 */
public final class Text {
  private Text() {}

  private static final Pattern WS = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);
  private static final Pattern NEWLINES = Pattern.compile("\\s*\\n+\\s*", Pattern.UNICODE_CHARACTER_CLASS);

  /** `.replace(/\s+/g, ' ').trim()` */
  public static String collapse(String s) {
    return WS.matcher(s).replaceAll(" ").strip();
  }

  /** JS의 replace(\s*\n+\s* → 한 칸) 후 trim — 줄바꿈(과 그 둘레 공백)만 한 칸으로 (reply.ts:76). */
  public static String oneLine(String s) {
    return NEWLINES.matcher(s).replaceAll(" ").strip();
  }

  /** `.slice(0, n)` — UTF-16 단위. 서로게이트 쌍 한가운데는 자르지 않는다 (깨진 문자 대신 한 단위 덜 — JSON에 반쪽 서로게이트가 실리지 않게). */
  public static String cut(String s, int n) {
    if (s.length() <= n) return s;
    int end = n;
    if (end > 0 && Character.isHighSurrogate(s.charAt(end - 1))) end--;
    return s.substring(0, end);
  }
}
