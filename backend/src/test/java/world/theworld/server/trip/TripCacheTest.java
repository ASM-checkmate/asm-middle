package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import world.theworld.server.ApiTest;
import world.theworld.server.trip.TripAssembler.Assembled;
import world.theworld.server.trip.TripDtos.SearchHit;
import world.theworld.server.trip.TripDtos.TripPlanResponse;

/** trip_pack/trip_search 테이블 왕복 (BACKEND-CONTRACT §1) — H2 인메모리. 별칭 셋에 같은 팩, 덮어쓰기, 모양 검사. */
class TripCacheTest extends ApiTest {
  @Autowired TripCache cache;
  @Autowired TripPackRepository packs;

  @Test
  void packRoundTrip() {
    Assembled a = TripAssembler.assemble(TripFixtures.draft2(), TripFixtures.geo(), TripFixtures.CENTRE);
    TripPlanResponse plan = new TripPlanResponse(a.city(), a.places(), List.of("https://ex.com/kyoto"), false, "m", 1234);
    cache.writePack(List.of("교토", "kyoto"), plan);
    TripPlanResponse back = cache.readPack("kyoto");
    assertThat(back).isEqualTo(plan);
    assertThat(cache.readPack("교토").city().hubs().airport()).isEqualTo("kyoto-kansai-international-airport");
    assertThat(cache.readPack("교토").city().hubs().port()).isNull();
    assertThat(cache.readPack("nowhere")).isNull();
    assertThat(packs.findById("kyoto").get().getCityKey()).isEqualTo("kyoto");
    // 덮어쓰기
    TripPlanResponse v2 = new TripPlanResponse(a.city(), a.places(), List.of("https://ex.com/v2"), false, "m2", 1);
    cache.writePack(List.of("kyoto"), v2);
    assertThat(cache.readPack("kyoto").sources()).containsExactly("https://ex.com/v2");
    assertThat(cache.readPack("교토").sources()).containsExactly("https://ex.com/kyoto");
  }

  @Test
  void searchRoundTrip() {
    List<SearchHit> h = TripFixtures.hits();
    cache.writeSearch("교토", List.of(List.of(h.get(0)), List.of(), List.of(h.get(2))));
    assertThat(cache.readSearch("교토")).isEqualTo(List.of(List.of(h.get(0)), List.of(), List.of(h.get(2))));
    assertThat(cache.readSearch("파리")).isNull();
    cache.writeSearch("빈곳", List.of(List.of(), List.of(), List.of()));
    assertThat(cache.readSearch("빈곳")).as("전부 비었으면 없는 것").isNull();
  }
}
