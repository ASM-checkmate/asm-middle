package world.theworld.server.llm;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import world.theworld.server.llm.LlmDtos.Agent;
import world.theworld.server.llm.LlmDtos.RecentMsg;
import world.theworld.server.llm.LlmDtos.ReplyRequest;
import world.theworld.server.llm.LlmDtos.Situation;

/**
 * 답장 프롬프트 (옛 Node 백엔드 reply.ts(커밋 0298e8d) 글자 그대로). 프론트의 sim/chat.ts `replyToAll`이 하던 "무슨 말을 할지"만 여기로 온다.
 * "언제 읽고 언제 답할지"는 여전히 프론트의 규칙이다 — 모델은 시계를 모른다.
 */
public final class ReplyPrompt {
  private ReplyPrompt() {}

  /** 답장의 최대 길이. 프론트 MAX_LEN(60)보다 조금 넉넉하게, 넘으면 자른다. */
  public static final int MAX_REPLY = 80;
  /** trip(도시 이름)의 최대 길이. */
  public static final int MAX_TRIP = 30;

  /** 모델에게 강제하는 응답 형식. */
  public static final Map<String, Object> REPLY_SCHEMA = Collections.unmodifiableMap(Schema.of(
    "type", "object",
    "properties", Schema.of(
      "text", Schema.nullable("string"),
      "worry", Schema.of("type", java.util.Arrays.asList("string", null), "enum", Schema.withNull(LlmDtos.WORRY_KEYS)),
      "callMe", Schema.of("type", "boolean"),
      "trip", Schema.nullable("string")),
    "required", List.of("text", "worry", "callMe", "trip")));

  static final Map<String, String> WORRY_KO = Map.of("work", "일", "people", "사람", "body", "몸", "money", "돈", "focus", "집중", "blue", "기분", "bored", "심심함");

  public record Prompt(String system, String user) {}

  private static String list(List<String> xs) {
    return xs.isEmpty() ? "딱히 없음" : String.join(", ", xs);
  }

  /**
   * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
   *
   * @param req 요청
   * @return system(누구이고 어떤 상황인가 + 규칙)과 user(최근 대화 + 이번 묶음)
   */
  public static Prompt build(ReplyRequest req) {
    Agent agent = req.agent();
    Situation s = req.situation();
    List<String> lines = new ArrayList<>();
    lines.add("너는 \"" + agent.name() + "\"이다. 사용자의 오랜 친구이고, 자기 하루를 사는 사람이다. 사용자가 방금 카톡으로 말을 걸었고 너는 답장을 친다.");
    lines.add("성격: " + list(agent.traits()) + ". 좋아하는 것: " + list(agent.likes()) + ". 싫어하는 것: " + list(agent.dislikes()) + ".");
    lines.add("지금 상황: " + s.hhmm() + ", " + s.where() + "에서 " + s.doing() + ". 기분 " + s.mood() + "/100, 피로 " + s.fatigue() + "/100.");
    lines.add(s.lateWhy() != null && !s.lateWhy().isEmpty() ? "아까는 " + s.lateWhy() + " 못 봤고 이제 봤다. 첫마디에 짧게 미안하다고 한다." : "");
    lines.add(s.worry() != null && !s.worry().isEmpty() ? "며칠 안에 사용자가 " + WORRY_KO.get(s.worry()) + " 때문에 힘들다고 했다. 기억하고 있다." : "");
    lines.add("");
    lines.add("규칙:");
    lines.add("- 한국어 반말, 카톡 말투. 한두 문장, 60자 안. 줄바꿈 없이. 이모지는 거의 안 쓴다. 존댓말·영어 금지.");
    lines.add("- 사용자가 여러 줄을 보냈으면 한 번에 읽고 한 줄로 답한다. 급한 것부터: 힘들다는 말 > 전화해 달라는 말 > 물음 > 나머지.");
    lines.add("- 위치와 하는 일은 위의 \"지금 상황\"만 사실이다. 지어내지 않는다. 모르는 얘기면 모른다고 한다.");
    lines.add("- 사용자가 지쳤다·힘들다·우울하다고 하면: 무슨 일인지 놀라서 묻고 \"이따가 전화할게\"라고 약속한다. worry에 갈래를 적는다 (work=일·공부, people=사람·관계, body=몸·피곤, money=돈, focus=집중, blue=그냥 우울, bored=심심).");
    lines.add("- 사용자가 전화해 달라고 하면 callMe=true. 지금 받을 수 있는 상황이면 \"지금 걸게\", 자느라·이동 중·조용한 곳·밥 먹는 중이면 \"끝나고 걸게\"라고 답한다. 힘들다는 말과 같이 왔으면 worry와 callMe를 둘 다 적는다.");
    lines.add("- 답하지 않는 게 자연스러우면 (추임새뿐이거나 이미 끝난 얘기) text를 null로 둔다.");
    lines.add("- 사용자가 어디로 여행 가자고 하면 (\"교토 가자\", \"파리 가고 싶다\") trip에 도시 이름만 한국어로 적는다 (\"교토\"). 답장은 \"오 좋다, 찾아볼게\" 정도로 짧게 — 아직 모르는 장소·일정을 지어내지 않는다. 도시가 없거나 여행 얘기가 아니면 trip은 null.");
    lines.add("- JSON으로만 답한다: {\"text\": string|null, \"worry\": string|null, \"callMe\": boolean, \"trip\": string|null}");
    String system = String.join("\n", lines.stream().filter(l -> !l.isEmpty()).toList());

    List<String> userLines = new ArrayList<>();
    if (!req.recent().isEmpty()) {
      userLines.add("[최근 대화]");
      for (RecentMsg m : req.recent()) userLines.add((m.from().equals("me") ? "사용자" : agent.name()) + ": " + m.text());
      userLines.add("");
    }
    userLines.add("[방금 온 말]");
    for (String t : req.texts()) userLines.add("사용자: " + t);
    return new Prompt(system, String.join("\n", userLines));
  }
}
