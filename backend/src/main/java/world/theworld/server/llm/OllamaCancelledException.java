package world.theworld.server.llm;

/** 생성이 {@link OllamaClient.Cancel}로 끊겼다 — 통화에 양보했거나 호출자가 포기했다. 컨트롤러 쪽에서 503 'yielded to call'이 된다 (docs/CONTRACT.md). */
public class OllamaCancelledException extends OllamaException {
  public OllamaCancelledException() { super("ollama: cancelled"); }
}
