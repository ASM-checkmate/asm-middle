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

  /**
   * 조사 고르기 — 마지막 글자가 한글 음절이면 받침 유무로 (받침 있음 → {@code with}, 없음 → {@code without}), 한글이 아니면(영문·숫자) 어느 쪽인지
   * 알 수 없어 "이(가)"처럼 둘을 붙여 쓴다.
   *
   * @param word 앞말 (이름 등)
   * @param with 받침 있을 때의 조사 ("이", "을")
   * @param without 받침 없을 때의 조사 ("가", "를")
   * @return 앞말 + 조사
   */
  public static String josa(String word, String with, String without) {
    if (word.isEmpty()) return word + with + "(" + without + ")";
    char c = word.charAt(word.length() - 1);
    if (c < 0xAC00 || c > 0xD7A3) return word + with + "(" + without + ")";
    return word + (((c - 0xAC00) % 28) != 0 ? with : without);
  }

  /**
   * 사람 이름 부르기 — 받침 있는 이름엔 "이"를 붙인다 (하늘 → 하늘이, 유리 → 유리, Amy → Amy). 그 뒤에 {@link #josa}를 이으면
   * "하늘이가"·"하늘이를"·"유리가"가 된다 — 프런트 sim/agentPosts.ts의 iga·hante와 같은 규칙이라, 모델이 보는 최근 대화의 이름꼴과 맞는다.
   *
   * @param name 이름
   * @return 받침 있는 한글 이름이면 이름 + "이", 아니면 그대로
   */
  public static String calling(String name) {
    if (name.isEmpty()) return name;
    char c = name.charAt(name.length() - 1);
    return c >= 0xAC00 && c <= 0xD7A3 && ((c - 0xAC00) % 28) != 0 ? name + "이" : name;
  }

  /** `.slice(0, n)` — UTF-16 단위. 서로게이트 쌍 한가운데는 자르지 않는다 (깨진 문자 대신 한 단위 덜 — JSON에 반쪽 서로게이트가 실리지 않게). */
  public static String cut(String s, int n) {
    if (s.length() <= n) return s;
    int end = n;
    if (end > 0 && Character.isHighSurrogate(s.charAt(end - 1))) end--;
    return s.substring(0, end);
  }
}
