package world.theworld.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import world.theworld.server.auth.UserIdAuthFilter;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.media.Media;
import world.theworld.server.media.MediaRepository;
import world.theworld.server.media.MediaService;

/**
 * 미디어 저장소 (CONTRACT §2.5, ADR-0024): 클라이언트 id · 멱등 · 소유자/친구/공개 글 권한 · 60 KB · 타입.
 * 본문이 JSON이 아니라 ApiTest.call을 안 쓰고 요청을 직접 짓는다.
 */
class MediaApiTest extends ApiTest {
  @Autowired TheworldProps props;
  @Autowired MediaService service;
  @Autowired MediaRepository rows;

  static String newId() { return UUID.randomUUID().toString().replace("-", ""); }

  static byte[] webp(int n) {
    byte[] b = new byte[n];
    // RIFF....WEBP 머리 — 서버는 해석하지 않지만 그럴듯하게
    byte[] head = "RIFF\0\0\0\0WEBP".getBytes(StandardCharsets.US_ASCII);
    System.arraycopy(head, 0, b, 0, Math.min(head.length, n));
    for (int i = head.length; i < n; i++) b[i] = (byte) (i * 31);
    return b;
  }

  MvcResult upload(Session s, String id, String kind, String contentType, byte[] body) throws Exception {
    MockHttpServletRequestBuilder b = put("/api/media/" + id + (kind == null ? "" : "?kind=" + kind)).header(UserIdAuthFilter.HEADER, s.userId());
    if (contentType != null) b.contentType(contentType);
    if (body != null) b.content(body);
    return mvc.perform(b).andReturn();
  }

  MvcResult download(Session s, String id) throws Exception {
    return mvc.perform(get("/api/media/" + id).header(UserIdAuthFilter.HEADER, s.userId())).andReturn();
  }

  @Test
  void uploadIsIdempotentPerOwner() throws Exception {
    Session a = newUser();
    Session b = newUser();
    String id = newId();
    byte[] body = webp(1234);

    MvcResult first = upload(a, id, "shot", "image/webp", body);
    assertThat(first.getResponse().getStatus()).isEqualTo(201);
    JsonNode m = json(first);
    assertThat(m.get("id").asText()).isEqualTo(id);
    assertThat(m.get("ownerId").asText()).isEqualTo(a.userId());
    assertThat(m.get("kind").asText()).isEqualTo("shot");
    assertThat(m.get("mime").asText()).isEqualTo("image/webp");
    assertThat(m.get("bytes").asLong()).isEqualTo(1234);
    assertThat(m.get("createdAt").asLong()).isPositive();
    assertThat(Files.readAllBytes(Path.of(props.media().dir()).resolve(id))).isEqualTo(body);

    // 같은 소유자 — 바이트는 버리고 기존 행(200). kind가 달라도 처음 것이 남는다
    MvcResult again = upload(a, id, "sketch", "image/png", webp(99));
    assertThat(again.getResponse().getStatus()).isEqualTo(200);
    assertThat(json(again).get("kind").asText()).isEqualTo("shot");
    assertThat(json(again).get("bytes").asLong()).isEqualTo(1234);
    assertThat(Files.readAllBytes(Path.of(props.media().dir()).resolve(id))).isEqualTo(body);

    // 다른 소유자 — 403
    MvcResult other = upload(b, id, "shot", "image/webp", webp(10));
    assertThat(other.getResponse().getStatus()).isEqualTo(403);
    assertThat(json(other).get("error").asText()).isEqualTo("not yours");
  }

  @Test
  void uploadValidation() throws Exception {
    Session a = newUser();
    // id 모양
    MvcResult badId = upload(a, "not-hex", "shot", "image/webp", webp(10));
    assertThat(badId.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(badId).get("error").asText()).isEqualTo("id must be 32 hex chars");
    assertThat(upload(a, newId().toUpperCase(), "shot", "image/webp", webp(10)).getResponse().getStatus()).isEqualTo(400);
    // kind
    MvcResult badKind = upload(a, newId(), "photo", "image/webp", webp(10));
    assertThat(badKind.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(badKind).get("error").asText()).isEqualTo("kind must be shot|sketch|npc");
    assertThat(json(upload(a, newId(), null, "image/webp", webp(10))).get("error").asText()).isEqualTo("kind required");
    // 타입 — 415가 아니라 400
    MvcResult badType = upload(a, newId(), "shot", "image/jpeg", webp(10));
    assertThat(badType.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(badType).get("error").asText()).isEqualTo("unsupported image type");
    assertThat(upload(a, newId(), "shot", "application/json", "{}".getBytes(StandardCharsets.UTF_8)).getResponse().getStatus()).isEqualTo(400);
    assertThat(upload(a, newId(), "shot", null, webp(10)).getResponse().getStatus()).isEqualTo(400);
    // 파라미터가 붙어도 type/subtype만 본다
    assertThat(upload(a, newId(), "npc", "image/png;v=1", webp(10)).getResponse().getStatus()).isEqualTo(201);
    // 빈 본문
    MvcResult empty = upload(a, newId(), "shot", "image/webp", new byte[0]);
    assertThat(empty.getResponse().getStatus()).isEqualTo(400);
    assertThat(json(empty).get("error").asText()).isEqualTo("body required");
    // 60 KB 초과 — 필터가 읽기 전에 413
    MvcResult big = upload(a, newId(), "shot", "image/webp", webp(60 * 1024 + 1));
    assertThat(big.getResponse().getStatus()).isEqualTo(413);
    assertThat(json(big).get("error").asText()).isEqualTo("body too large");
    // 정확히 60 KB는 된다
    assertThat(upload(a, newId(), "shot", "image/webp", webp(60 * 1024)).getResponse().getStatus()).isEqualTo(201);
  }

  @Test
  void getNeedsOwnerOrFriend() throws Exception {
    Session owner = newUser();
    Session friend = newUser();
    Session stranger = newUser();
    String id = newId();
    byte[] body = webp(777);
    assertThat(upload(owner, id, "shot", "image/png", body).getResponse().getStatus()).isEqualTo(201);

    // 소유자 — 바이트 그대로, 저장된 타입, 사적 캐시 1년
    MvcResult mine = download(owner, id);
    assertThat(mine.getResponse().getStatus()).isEqualTo(200);
    assertThat(mine.getResponse().getContentType()).isEqualTo("image/png");
    assertThat(mine.getResponse().getHeader("Cache-Control")).isEqualTo("private, max-age=31536000");
    assertThat(mine.getResponse().getContentAsByteArray()).isEqualTo(body);

    // 남 — 403
    MvcResult forbidden = download(stranger, id);
    assertThat(forbidden.getResponse().getStatus()).isEqualTo(403);
    assertThat(json(forbidden).get("error").asText()).isEqualTo("not allowed");
    assertThat(download(friend, id).getResponse().getStatus()).isEqualTo(403);

    // 친구가 되면 200 — 어느 쪽이 맺었든
    assertThat(call(HttpMethod.POST, "/api/friends", friend, Map.of("otherId", owner.userId())).andReturn().getResponse().getStatus()).isEqualTo(200);
    MvcResult asFriend = download(friend, id);
    assertThat(asFriend.getResponse().getStatus()).isEqualTo(200);
    assertThat(asFriend.getResponse().getContentAsByteArray()).isEqualTo(body);

    // 모르는 id 404, 모양이 틀린 id 400
    assertThat(download(owner, newId()).getResponse().getStatus()).isEqualTo(404);
    assertThat(download(owner, "nope").getResponse().getStatus()).isEqualTo(400);

    // 행은 있는데 파일이 없으면 404 (지워진 디스크)
    Files.deleteIfExists(Path.of(props.media().dir()).resolve(id));
    assertThat(download(owner, id).getResponse().getStatus()).isEqualTo(404);
  }

  /**
   * 같은 새 id를 두 소유자가 동시에 올리면 — 행은 PK로 한쪽만 남고, 파일은 그 행의 바이트여야 한다. 행을 먼저 넣고(flush) 파일을 쓰므로 진 쪽은
   * 파일에 손대지 못한다. 어느 쪽이 이기든 상관없고, 진 쪽은 PK 위반(컨트롤러가 다시 불러 403으로 바꾸는 것)이다.
   */
  @Test
  void concurrentUploadKeepsWinnerBytes() throws Exception {
    Session a = newUser();
    Session b = newUser();
    byte[] bodyA = webp(300); bodyA[bodyA.length - 1] = 'A';
    byte[] bodyB = webp(200); bodyB[bodyB.length - 1] = 'B';
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      for (int round = 0; round < 10; round++) {
        String id = newId();
        CyclicBarrier go = new CyclicBarrier(2);
        List<Future<Throwable>> results = new ArrayList<>();
        for (Session s : List.of(a, b)) {
          byte[] body = s == a ? bodyA : bodyB;
          results.add(pool.submit(() -> {
            try { go.await(); service.put(s.userId(), id, "shot", "image/webp", body); return null; } catch (Throwable e) { return e; }
          }));
        }
        int failed = 0;
        for (Future<Throwable> f : results) {
          Throwable e = f.get(10, TimeUnit.SECONDS);
          if (e != null) { assertThat(e).as("round " + round).isInstanceOf(DataIntegrityViolationException.class); failed++; }
        }
        assertThat(failed).as("round " + round).isLessThanOrEqualTo(1);
        Media row = rows.findById(id).orElseThrow();
        byte[] expected = row.getOwnerId().equals(a.userId()) ? bodyA : bodyB;
        assertThat(Files.readAllBytes(Path.of(props.media().dir()).resolve(id))).as("round " + round + " owner " + row.getOwnerId()).isEqualTo(expected);
        assertThat(row.getBytes()).isEqualTo(expected.length);
      }
    } finally {
      pool.shutdownNow();
    }
  }
}
