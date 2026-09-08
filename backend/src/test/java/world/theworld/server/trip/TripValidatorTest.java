package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import world.theworld.server.trip.TripAssembler.Assembled;
import world.theworld.server.trip.TripDtos.CityInfo;
import world.theworld.server.trip.TripDtos.Hubs;
import world.theworld.server.trip.TripDtos.TripPlace;

/** trip.test.mjs '검증' 5개 이관. */
class TripValidatorTest {
  private final Assembled a = TripAssembler.assemble(TripFixtures.draft2(), TripFixtures.geo(), TripFixtures.CENTRE);
  private final CityInfo city = a.city();
  private final List<TripPlace> places = a.places();

  private static CityInfo with(CityInfo c, String country, Hubs hubs) {
    return new CityInfo(c.key(), c.nameKo(), c.nameEn(), country, c.tz(), c.stayNights(), hubs);
  }

  @Test
  void thickPackPasses() {
    assertThatCode(() -> TripValidator.validate(city, places)).doesNotThrowAnyException();
  }

  @Test
  void noHotelIsThin() {
    assertThatThrownBy(() -> TripValidator.validate(city, places.stream().filter(p -> !p.type().equals("hotel")).toList()))
      .isInstanceOf(ThinPlanException.class).hasMessage("no hotel for kyoto").satisfies(e -> org.assertj.core.api.Assertions.assertThat(((ThinPlanException) e).status()).isEqualTo(422));
  }

  @Test
  void fewerThanSixIsThin() {
    assertThatThrownBy(() -> TripValidator.validate(city, places.subList(0, 5))).isInstanceOf(ThinPlanException.class).hasMessageStartingWith("only ");
  }

  @Test
  void abroadWithoutAirportIsThin() {
    assertThatThrownBy(() -> TripValidator.validate(with(city, city.country(), new Hubs(city.hubs().station(), null, null, null, null)), places))
      .isInstanceOf(ThinPlanException.class).hasMessage("no hub for kyoto");
  }

  @Test
  void domesticStationIsEnough() {
    assertThatCode(() -> TripValidator.validate(with(city, "KR", new Hubs(city.hubs().station(), null, null, null, null)), places)).doesNotThrowAnyException();
    assertThatThrownBy(() -> TripValidator.validate(with(city, "KR", new Hubs(null, null, null, null, null)), places)).isInstanceOf(ThinPlanException.class);
  }
}
