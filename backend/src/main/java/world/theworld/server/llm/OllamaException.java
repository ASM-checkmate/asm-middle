package world.theworld.server.llm;

/** Ollama 호출 실패 — 서버 오류·제한 시간·연결 거부·응답의 error 필드. 컨트롤러 쪽에서 502로 바뀐다 (docs/CONTRACT.md). */
public class OllamaException extends RuntimeException {
  public OllamaException(String message) { super(message); }
  public OllamaException(String message, Throwable cause) { super(message, cause); }
}
