package world.theworld.server.trip;

import world.theworld.server.common.ApiException;

/** 검색 키가 없다 — 서버는 503으로 돌려준다 (프론트는 "잘 안 됐어"). 요청 시점에 판단한다, 기동 시가 아니라. */
public class NoApiKeyException extends ApiException {
  public NoApiKeyException() { super(503, "OLLAMA_API_KEY not set — web search unavailable"); }
}
