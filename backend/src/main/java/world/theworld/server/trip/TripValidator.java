package world.theworld.server.trip;

import java.util.List;
import world.theworld.server.trip.TripDtos.CityInfo;
import world.theworld.server.trip.TripDtos.TripPlace;

/** 팩이 하루를 굴릴 만큼 두꺼운지 (옛 Node 백엔드 trip.ts(커밋 0298e8d) validatePlan). 비허브 장소 6개 + 호텔 1개 + (해외: 공항 / 국내: 역이나 공항). */
public final class TripValidator {
  private TripValidator() {}

  /** 팩이 성립하려면 필요한 비허브 장소 수. */
  public static final int MIN_PLACES = 6;

  /** @throws ThinPlanException 부족한 것을 한 줄로 (422) */
  public static void validate(CityInfo city, List<TripPlace> places) {
    List<TripPlace> body = places.stream().filter(p -> !TripDtos.HUB_TYPES.contains(p.type())).toList();
    if (body.size() < MIN_PLACES) throw new ThinPlanException("only " + body.size() + " places for " + city.key() + " (need " + MIN_PLACES + ")");
    if (body.stream().noneMatch(p -> p.type().equals("hotel"))) throw new ThinPlanException("no hotel for " + city.key());
    boolean noHub = !city.country().equals("KR") ? city.hubs().airport() == null : (city.hubs().station() == null && city.hubs().airport() == null);
    if (noHub) throw new ThinPlanException("no hub for " + city.key());
  }
}
