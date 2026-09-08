package world.theworld.server.sync;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import world.theworld.server.common.ApiException;
import world.theworld.server.common.TheworldProps;
import world.theworld.server.sync.DocDtos.Conflict;
import world.theworld.server.sync.DocDtos.Conflicted;
import world.theworld.server.sync.DocDtos.DocMeta;
import world.theworld.server.sync.DocDtos.DocView;
import world.theworld.server.sync.DocDtos.DocsList;
import world.theworld.server.sync.DocDtos.PutOk;
import world.theworld.server.sync.DocDtos.PutOutcome;
import world.theworld.server.sync.DocDtos.PutRequest;
import world.theworld.server.sync.DocDtos.Saved;

/**
 * 문서 동기화 규칙 (BACKEND-CONTRACT §2.2).
 * - 이름은 world|memory|book|places, 그 밖은 404.
 * - 없으면 baseVersion 0일 때만 생성(아니면 409). 있으면 baseVersion == version일 때만 갱신(version+1), 아니면 409에 서버본을 실어 준다.
 * - force:true면 baseVersion을 무시하고 덮어쓴다(클라이언트 정책 '내 것이 최신').
 * - 본문 4 MB 초과 413 (필터가 Content-Length로 먼저, 여기서 실제 바이트로 한 번 더).
 */
@Service
public class DocsService {
  public static final Set<String> NAMES = Set.of("world", "memory", "book", "places");

  private final UserDocRepository docs;
  private final TheworldProps props;

  public DocsService(UserDocRepository docs, TheworldProps props) {
    this.docs = docs;
    this.props = props;
  }

  static void checkName(String name) {
    if (name == null || !NAMES.contains(name)) throw ApiException.notFound();
  }

  @Transactional(readOnly = true)
  public DocsList list(String userId) {
    Map<String, DocMeta> out = new LinkedHashMap<>();
    for (UserDoc d : docs.findAllOf(userId)) out.put(d.getName(), new DocMeta(d.getVersion(), d.getUpdatedAt(), d.getClientTs()));
    return new DocsList(out);
  }

  @Transactional(readOnly = true)
  public DocView get(String userId, String name) {
    checkName(name);
    UserDoc d = docs.findById(new UserDocId(userId, name)).orElseThrow(ApiException::notFound);
    return new DocView(d.getName(), d.getVersion(), d.getUpdatedAt(), d.getClientTs(), d.getBody());
  }

  @Transactional
  public PutOutcome put(String userId, String name, PutRequest req) {
    checkName(name);
    if (req == null) throw ApiException.badRequest("body required");
    JsonNode body = req.body();
    if (body == null || body.isMissingNode()) throw ApiException.badRequest("body required");
    if (req.baseVersion() == null) throw ApiException.badRequest("baseVersion required");
    if (req.clientTs() == null) throw ApiException.badRequest("clientTs required");
    boolean force = Boolean.TRUE.equals(req.force());
    String text = body.toString();
    if (text.getBytes(StandardCharsets.UTF_8).length > props.docs().maxBytes()) throw ApiException.tooLarge();

    long now = System.currentTimeMillis();
    UserDocId id = new UserDocId(userId, name);
    Optional<UserDoc> existing = docs.lockById(id);
    if (existing.isEmpty()) {
      if (!force && req.baseVersion() != 0) return new Conflicted(new Conflict("conflict", name, 0, null, null, null));
      UserDoc d = docs.save(new UserDoc(id, 1, req.clientTs(), now, text));
      return new Saved(new PutOk(name, d.getVersion(), d.getUpdatedAt()));
    }
    UserDoc d = existing.get();
    if (!force && req.baseVersion() != d.getVersion()) {
      return new Conflicted(new Conflict("conflict", name, d.getVersion(), d.getUpdatedAt(), d.getClientTs(), d.getBody()));
    }
    d.replace(req.clientTs(), now, text);
    return new Saved(new PutOk(name, d.getVersion(), d.getUpdatedAt()));
  }
}
