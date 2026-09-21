package world.theworld.server.photo;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import world.theworld.server.common.ApiException;
import world.theworld.server.media.MediaService;
import world.theworld.server.photo.GeminiImageClient.Image;
import world.theworld.server.photo.GeminiImageClient.Ref;
import world.theworld.server.photo.ShotGenDtos.Pic;
import world.theworld.server.photo.ShotGenDtos.Request;
import world.theworld.server.photo.ShotGenDtos.Response;

/**
 * 컷 화풍 생성 (ADR-0029 결정 6). 폰이 준 단순 합성본(자리·크기의 대략)과 캐릭터 원본을 Gemini에 보내 **배경 화풍으로 캐릭터를 다시 그린**
 * 한 장을 받고, 긴 변 640 JPEG로 줄여 새 media(kind shot, 소유자 = 요청자)로 넣는다. 폰은 돌아온 shotId로 샷과 앨범의 픽셀을 바꾼다.
 * 프롬프트 규칙(오너 2026-09-15): 정체성 문구(chibi 비율·새싹 머리·볼터치·옷 색) 고정, 합성본의 자리는 대략 — 어색한 부분(의자 위 자세,
 * 테이블 뒤로, 앞 물건에 가려짐)은 모델이 고친다. 실패하면 4xx/5xx — 폰은 단순 합성본을 그대로 둔다.
 */
@Service
public class ShotGenService {
  private static final Logger log = LoggerFactory.getLogger(ShotGenService.class);
  static final int LONG_EDGE = 640;
  static final float JPEG_QUALITY = 0.86f;
  /** base64 한 장 상한 (요청 전체는 BodyLimitFilter.SHOTGEN_MAX) */
  static final int PIC_MAX_B64 = 1_600_000;
  static final Set<String> PIC_MIMES = Set.of("image/webp", "image/png", "image/jpeg");
  static final Map<String, String> POSE_EN = Map.of(
    "idle", "standing relaxed", "sit", "sitting", "wave", "waving one hand", "happy", "cheering with both arms up",
    "eat", "eating with chopsticks", "read", "reading a book", "think", "thinking with a hand on the chin", "draw", "drawing in a sketchbook", "walk", "walking");

  private final GeminiImageClient gemini;
  private final MediaService media;

  public ShotGenService(GeminiImageClient gemini, MediaService media) {
    this.gemini = gemini;
    this.media = media;
  }

  public Response generate(String me, String shotId, Request req) {
    long t0 = System.currentTimeMillis();
    if (!gemini.enabled()) throw new GeminiException(503, "gemini api key not configured");
    if (req == null || req.me() == null || (req.composite() == null && req.background() == null)) throw ApiException.badRequest("me and background or composite required");
    boolean byText = req.background() != null && req.background().data() != null && req.mePos() != null;
    List<Ref> refs = new ArrayList<>();
    refs.add(pic(byText ? req.background() : req.composite(), byText ? "background" : "composite"));
    refs.add(pic(req.me(), "me"));
    boolean friend = req.friend() != null && req.friend().data() != null;
    if (friend) refs.add(pic(req.friend(), "friend"));
    String prompt = byText ? promptByText(req, friend) : prompt(req, friend);
    Image img = gemini.generate(refs, prompt, "2:3");
    byte[] jpeg = toJpeg(img);
    var stored = media.storeGenerated(me, "shot", MediaService.GENERATED_MIME, jpeg);
    long ms = System.currentTimeMillis() - t0;
    log.info("shot generated: {} → {} ({} B, {} ms, user {})", shotId, stored.id(), jpeg.length, ms, me);
    return new Response(stored.id(), stored.mime(), stored.bytes(), ms);
  }

  static Ref pic(Pic p, String name) {
    if (p == null || p.data() == null || p.data().isBlank()) throw ApiException.badRequest(name + " required");
    if (p.mime() == null || !PIC_MIMES.contains(p.mime())) throw ApiException.badRequest(name + ": unsupported image type");
    if (p.data().length() > PIC_MAX_B64) throw ApiException.tooLarge();
    try {
      return new Ref(p.mime(), Base64.getDecoder().decode(p.data()));
    } catch (IllegalArgumentException e) {
      throw ApiException.badRequest(name + ": bad base64");
    }
  }

  /** 시험(frontend/art/backdrops/test, 2026-09-15)에서 굳힌 문구 — b안(배경 화풍으로 다시 그리기) + 정체성 고정 + 자리는 대략 */
  static String prompt(Request r, boolean friend) {
    String mePose = POSE_EN.getOrDefault(r.mePose() == null ? "idle" : r.mePose(), "standing relaxed");
    String frPose = POSE_EN.getOrDefault(r.friendPose() == null ? "wave" : r.friendPose(), "waving one hand");
    boolean sit = Boolean.TRUE.equals(r.sit()) || "sit".equals(r.mePose());
    String where = (r.place() == null ? "this place" : r.place()) + (r.spot() == null || r.spot().isBlank() ? "" : " (" + r.spot() + ")");
    StringBuilder sb = new StringBuilder();
    sb.append("The first image is a painted background of ").append(where).append(" with ")
      .append(friend ? "two flat vector mascot characters" : "a flat vector mascot character")
      .append(" pasted on top only as rough PLACEHOLDERS for where they are and how big they are. ");
    if (friend) sb.append("The left/first one is the main character (second image), the other one is her friend (third image). ");
    else sb.append("The mascot is the main character (second image). ");
    sb.append("Repaint the scene so ").append(friend ? "both are" : "she is").append(" naturally ")
      .append(sit ? "SITTING at that spot (on the seat, bench or stool that is there)" : "standing at that spot")
      .append(", facing the camera. Main character: ").append(mePose).append(friend ? ". Friend: " + frPose : "").append(". ");
    sb.append("The placeholders are approximate — fix anything physically awkward (sitting properly on the seat, correct depth so a table or counter in front partly covers the lap, feet hidden by foreground objects, consistent scale, natural contact shadows), while keeping ")
      .append(friend ? "them" : "her").append(" at roughly the same spot and size. ");
    sb.append("Keep ").append(friend ? "both" : "her").append(" recognizable as the mascot reference: round head, bowl haircut with the little sprout on top, big dot eyes with white highlights, pink cheeks, tiny arms and feet, chibi proportions with a very big head, the same clothes and colors")
      .append(friend ? " (the friend keeps her own hair, scarf and shirt colors from the third image)" : "").append(". ");
    sb.append("Render ").append(friend ? "them" : "her").append(" in the same semi-realistic anime painting style as the background — soft painted shading, lighting and color grading that match the scene. ");
    sb.append("Keep the background exactly as it is. No text, no watermark, no signature.");
    return sb.toString();
  }

  /** 자리 하나를 글로: "feet at about 22% from the left and 84% down from the top, about half the frame width wide" */
  static String figureText(ShotGenDtos.Figure f) {
    int x = (int) Math.round(f.x() == null ? 50 : f.x()), y = (int) Math.round(f.y() == null ? 85 : f.y());
    int w = (int) Math.round((f.scale() == null ? 0.5 : f.scale()) * 100);
    return "feet touching the ground at about " + x + "% from the left edge and " + y + "% down from the top of the frame, about " + w + "% of the frame width wide";
  }

  /**
   * 배경 원본 + 캐릭터 + 자리(글) — 합성본 없이 (2026-09-15 A/B: 붙여넣은 티가 안 새고 테이블 뒤·벤치 위 배치가 더 자연스러웠다).
   * 첫 그림 = 배경, 둘째 = 나, 셋째 = 동행. 정체성·어색한 부분 고치기 규칙은 prompt()와 같다
   */
  static String promptByText(Request r, boolean friend) {
    String mePose = POSE_EN.getOrDefault(r.mePose() == null ? "idle" : r.mePose(), "standing relaxed");
    String frPose = POSE_EN.getOrDefault(r.friendPose() == null ? "wave" : r.friendPose(), "waving one hand");
    boolean sit = Boolean.TRUE.equals(r.sit()) || "sit".equals(r.mePose());
    String where = (r.place() == null ? "this place" : r.place()) + (r.spot() == null || r.spot().isBlank() ? "" : " (" + r.spot() + ")");
    StringBuilder sb = new StringBuilder();
    sb.append("The first image is a painted background of ").append(where).append(". The second image is a flat vector mascot character");
    if (friend) sb.append(", the third image is her friend");
    sb.append(". Paint ").append(friend ? "both of them" : "this character").append(" INTO the background, ")
      .append(sit ? "SITTING on the seat, bench or stool that is there" : "standing").append(", facing the camera. ");
    sb.append("Main character: ").append(figureText(r.mePos())).append("; ").append(mePose).append(". ");
    if (friend) sb.append("Friend: ").append(r.friendPos() != null ? figureText(r.friendPos()) : "right next to her").append("; ").append(frPose).append(". ");
    sb.append("The positions are approximate — fix anything physically awkward (sit properly on the seat, correct depth so a table or counter in front partly covers the lap, feet hidden by foreground objects, consistent scale, natural contact shadows). ");
    sb.append("Keep ").append(friend ? "both" : "her").append(" recognizable as the mascot reference: round head, bowl haircut with the little sprout on top, big dot eyes with white highlights, pink cheeks, tiny arms and feet, chibi proportions with a very big head, the same clothes and colors")
      .append(friend ? " (the friend keeps her own hair, scarf and shirt colors from the third image)" : "").append(". ");
    sb.append("Render ").append(friend ? "them" : "her").append(" in the same semi-realistic anime painting style as the background — soft painted shading, lighting and color grading that match the scene. ");
    sb.append("Keep the background exactly as it is. No text, no watermark, no signature.");
    return sb.toString();
  }

  /** 받은 그림(1K PNG/JPEG)을 긴 변 640 JPEG로 — 앨범이 300px, 글이 최대 폰 폭이라 충분하고 ~60~90 KB */
  static byte[] toJpeg(Image img) {
    try {
      BufferedImage src = ImageIO.read(new ByteArrayInputStream(img.bytes()));
      if (src == null) throw new GeminiException(502, "gemini: unreadable image");
      int w = src.getWidth(), h = src.getHeight();
      double k = Math.min(1.0, (double) LONG_EDGE / Math.max(w, h));
      int nw = Math.max(1, (int) Math.round(w * k)), nh = Math.max(1, (int) Math.round(h * k));
      BufferedImage out = new BufferedImage(nw, nh, BufferedImage.TYPE_INT_RGB);
      Graphics2D g = out.createGraphics();
      g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
      g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
      g.setColor(java.awt.Color.WHITE);
      g.fillRect(0, 0, nw, nh);
      g.drawImage(src, 0, 0, nw, nh, null);
      g.dispose();
      ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
      ImageWriteParam p = writer.getDefaultWriteParam();
      p.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
      p.setCompressionQuality(JPEG_QUALITY);
      ByteArrayOutputStream bos = new ByteArrayOutputStream();
      try (MemoryCacheImageOutputStream ios = new MemoryCacheImageOutputStream(bos)) {
        writer.setOutput(ios);
        writer.write(null, new IIOImage(out, null, null), p);
      } finally {
        writer.dispose();
      }
      return bos.toByteArray();
    } catch (IOException e) {
      throw new GeminiException(502, "gemini: image convert failed");
    }
  }
}
