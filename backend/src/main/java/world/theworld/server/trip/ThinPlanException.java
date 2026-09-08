package world.theworld.server.trip;

import world.theworld.server.common.ApiException;

/** 얇은 팩 — 장소 6개 미만·호텔 없음·허브 없음. 서버는 422로 돌려준다 (docs/CONTRACT.md). */
public class ThinPlanException extends ApiException {
  public ThinPlanException(String message) { super(422, message); }
}
