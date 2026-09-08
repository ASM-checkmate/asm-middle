package world.theworld.server.social;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * §2.3 JSON 모양 — 필드명은 계약 타입(RemotePlace·RemoteAgent·PublishedActivity)과 글자 그대로.
 * TS의 `?` 필드(hairStyle·place·reachBy·ownerFriendId)는 없을 때 키 자체를 빼고(NON_NULL), `number|null`로 적힌 것(metAt·metPlaceId·now)은 null을 그대로 낸다.
 */
public final class SocialDtos {
  private SocialDtos() {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record RemotePlace(String id, String name, String type, double lng, double lat, String area, String city, String country, String emoji,
                            String reachBy, String ownerFriendId) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record RemoteAgent(String id, String name, String homePlaceId, String color, String emoji, List<String> likes, List<String> traits,
                            String hairStyle, RemotePlace home) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record PublishedActivityDto(String key, String agentId, String dayKey, String blockId, String placeId, RemotePlace place, String category,
                                     String title, String emoji, long arriveAt, long endAt, String tz, List<String> companions) {}

  // ── 요청 (관대하게 받기 위해 boxed 타입 — 빠진 필드를 400 한 줄로 알린다) ──
  public record PlaceIn(String id, String name, String type, Double lng, Double lat, String area, String city, String country, String emoji,
                        String reachBy, String ownerFriendId) {}
  public record AgentPut(String name, String color, String emoji, String hairStyle, List<String> likes, List<String> traits, PlaceIn home) {}
  public record ActivityIn(String key, String agentId, String dayKey, String blockId, String placeId, PlaceIn place, String category, String title,
                           String emoji, Long arriveAt, Long endAt, String tz, List<String> companions) {}
  public record SchedulePut(Long from, Long to, List<ActivityIn> activities) {}
  public record Slot(String key, String placeId, Long from, Long to) {}
  public record AgentsAtRequest(List<Slot> slots) {}
  public record FriendAdd(String otherId, Long metAt, String metPlaceId) {}

  // ── 응답 ──
  public record Count(int count) {}
  public record Hit(RemoteAgent agent, long overlapMs, PublishedActivityDto activity) {}
  public record Hits(Map<String, List<Hit>> hits) {}
  public record FriendEntry(RemoteAgent agent, Long metAt, String metPlaceId, PublishedActivityDto now) {}
  public record Friends(List<FriendEntry> friends) {}
  public record OkCreated(boolean ok, boolean created) {}
  public record Activities(List<PublishedActivityDto> activities) {}
}
