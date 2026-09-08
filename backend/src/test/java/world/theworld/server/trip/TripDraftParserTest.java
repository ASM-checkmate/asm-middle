package world.theworld.server.trip;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import org.junit.jupiter.api.Test;
import world.theworld.server.trip.TripDtos.DraftPlace;
import world.theworld.server.trip.TripDtos.TripDraft;

/** trip.test.mjs '파서' 9개 이관 + 결함 3 회귀(프롬프트에 없는 src는 버림). */
class TripDraftParserTest {
  private final TripDraft draft = TripFixtures.draft();

  @Test
  void keyLowerCountryUpper() {
    assertThat(draft).isNotNull();
    assertThat(draft.key()).isEqualTo("kyoto");
    assertThat(draft.country()).isEqualTo("JP");
  }

  @Test
  void dropsDuplicateSecondHotelOutOfRangeSrcBadTypeHubType() {
    assertThat(draft.places()).hasSize(9);
    assertThat(draft.places().stream().filter(p -> p.type().equals("hotel")).count()).isEqualTo(1);
    assertThat(draft.places().stream().map(DraftPlace::nameEn)).doesNotContain("Made Up", "Bad Type", "Nishiki Ichiba", "Second Hotel");
    assertThat(draft.places().stream().map(DraftPlace::type)).doesNotContain("station");
  }

  @Test
  void hubsPortNull() {
    assertThat(draft.hubs().airport()).isNotNull();
    assertThat(draft.hubs().station()).isNotNull();
    assertThat(draft.hubs().port()).isNull();
  }

  @Test
  void hubNameParensStripped() {
    assertThat(draft.hubs().airport().nameEn()).isEqualTo("Kansai International Airport");
    assertThat(draft.hubs().station().lat()).isNaN();
  }

  @Test
  void badKeyFallsBackToSlugOfNameEn() throws Exception {
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("key", "\"교토!\""), 3).key()).isEqualTo("kyoto");
  }

  @Test
  void badTzIsNull() throws Exception {
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("tz", "\"Asia/Kyoto\""), 3)).isNull();
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("tz", "\"+09:00\""), 3)).as("오프셋은 IANA가 아니다 — 프런트 Intl과 같게").isNull();
  }

  @Test
  void badCountryIsNull() throws Exception {
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("country", "\"Japan\""), 3)).isNull();
  }

  @Test
  void brokenJsonIsNull() {
    assertThat(TripDraftParser.parse("{", 3)).isNull();
    assertThat(TripDraftParser.parse("[]", 3)).isNull();
  }

  @Test
  void slugify() {
    assertThat(TripDraftParser.slugify("Philosopher's Path")).isEqualTo("philosopher-s-path");
    assertThat(TripDraftParser.slugify("Kiyomizu-dera")).isEqualTo("kiyomizu-dera");
    assertThat(TripDraftParser.slugify("교토")).isEqualTo("");
    assertThat(TripDraftParser.slugify("Café Müller")).isEqualTo("cafe-muller");
  }

  @Test
  void srcMustBeInIncluded() {
    // 결함 3: hits.length가 3이라도 프롬프트에 2번이 빠졌으면 src=2인 장소는 버린다
    TripDraft d = TripDraftParser.parse(TripFixtures.DRAFT_JSON, Set.of(1, 3));
    assertThat(d.places().stream().map(DraftPlace::src)).doesNotContain(2, 9);
    assertThat(d.places()).hasSize(9);   // 원본 14개 중 src 2는 틀린 유형·허브 유형뿐이라 수는 같다
    TripDraft only1 = TripDraftParser.parse(TripFixtures.DRAFT_JSON, Set.of(1));
    assertThat(only1.places().stream().map(DraftPlace::src)).containsOnly(1);
    assertThat(only1.places()).hasSize(5);
    assertThat(TripDraftParser.parse(TripFixtures.DRAFT_JSON, Set.of()).places()).isEmpty();
  }

  @Test
  void stayNightsAndSubway() throws Exception {
    assertThat(draft.stayNights()).isEqualTo(2);
    assertThat(draft.hasSubway()).isTrue();
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("stayNights", "9"), 3).stayNights()).isEqualTo(5);
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("stayNights", "\"x\""), 3).stayNights()).isEqualTo(2);
    assertThat(TripDraftParser.parse(TripFixtures.draftWith("hasSubway", "\"true\""), 3).hasSubway()).isFalse();
    TripDraft kr = TripDraftParser.parse(TripFixtures.draftWith("country", "\"kr\"").replace("\"stayNights\":2", "\"stayNights\":null"), 3);
    assertThat(kr.stayNights()).isEqualTo(1);
  }
}
