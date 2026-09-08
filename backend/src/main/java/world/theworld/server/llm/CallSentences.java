package world.theworld.server.llm;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 스트리밍 텍스트에서 완성된 문장을 떼어 내고 통화 말투로 다듬는다 (옛 Node 백엔드 call.ts(커밋 2808024) splitSentences·tidy 그대로). 순수 함수.
 * 정규식은 Node의 것을 글자 그대로 옮기되 {@code \s}는 JS처럼 유니코드 공백까지 보게 UNICODE_CHARACTER_CLASS로 둔다.
 */
public final class CallSentences {
  private CallSentences() {}

  /** 완성된 문장들(다듬은 것)과 아직 안 끝난 꼬리. */
  public record Split(List<String> sentences, String rest) {}

  /** 마침표·물음표·느낌표(뒤따르는 닫는 따옴표·괄호까지)나 줄바꿈에서 자른다. 말줄임표(…)는 문장 끝이 아니다 — "어… 그랬구나."를 한 호흡으로 읽어야 자연스럽다. */
  private static final Pattern SENTENCE = Pattern.compile("[^.!?\\n]*[.!?]+[\"'」)]*|[^\\n]*\\n");
  private static final Pattern LEADING_WS = Pattern.compile("^\\s+", Pattern.UNICODE_CHARACTER_CLASS);
  /** "모모: " */
  private static final Pattern LABEL = Pattern.compile("^[A-Za-z가-힣]{1,10}\\s*:\\s*", Pattern.UNICODE_CHARACTER_CLASS);
  private static final Pattern QUOTES = Pattern.compile("^[\"'「]+|[\"'」]+$");
  /** (웃음) [지문] *행동* */
  private static final Pattern STAGE = Pattern.compile("\\([^)]*\\)|\\[[^\\]]*\\]|\\*[^*]*\\*");
  /** Node의 {@code \p{Extended_Pictographic}} — 변형 선택자(U+FE0F)·ZWJ(U+200D)는 Node도 남긴다. */
  private static final Pattern EMOJI = Pattern.compile("\\p{IsExtended_Pictographic}");
  /** 한자·중국어가 새어 나온다 ("집沙发上에서") — TTS가 중국어로 읽는다. */
  private static final Pattern CJK = Pattern.compile("[\\u3400-\\u9fff\\uf900-\\ufaff]");
  /** 자른 끝의 토막 난 낱말·쉼표. */
  private static final Pattern DANGLING = Pattern.compile("[,\\s]+\\S*$", Pattern.UNICODE_CHARACTER_CLASS);

  /**
   * 스트리밍 텍스트에서 완성된 문장을 떼어 낸다.
   *
   * @param buf 지금까지 받은 텍스트
   * @return 완성된 문장들(다듬은 것)과 남은 꼬리(앞 공백은 뗀 것)
   */
  public static Split split(String buf) {
    List<String> sentences = new ArrayList<>();
    String rest = buf;
    for (;;) {
      Matcher m = SENTENCE.matcher(rest);
      if (!m.lookingAt()) break;   // Node: re.exec(rest)가 index 0에서 맞아야 한다 — 어느 짝이든 한 글자 이상이라 끝난다
      String s = tidy(m.group());
      if (!s.isEmpty()) sentences.add(s);
      rest = rest.substring(m.end());
    }
    return new Split(sentences, LEADING_WS.matcher(rest).replaceFirst(""));
  }

  /** 문장 하나를 통화 말투로 다듬는다 — 이름표·따옴표·이모지·지문·한자를 걷어 내고 길이를 자른다. */
  public static String tidy(String s) {
    String t = Text.collapse(s);
    t = LABEL.matcher(t).replaceFirst("");
    t = QUOTES.matcher(t).replaceAll("");
    t = STAGE.matcher(t).replaceAll("").strip();
    t = EMOJI.matcher(t).replaceAll("");
    t = Text.collapse(CJK.matcher(t).replaceAll(""));
    if (t.length() > CallDtos.MAX_SENTENCE) t = DANGLING.matcher(Text.cut(t, CallDtos.MAX_SENTENCE)).replaceFirst("") + "…";
    return t;
  }
}
