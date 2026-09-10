import type { Post } from '../../sim/posts';
import { PhotoImg } from '../../photo/PhotoImg';

/** 글 격자 3열 (SNS_SPEC §6) — 첫 컷이 얼굴. 여러 장이면 오른쪽 위에 겹친 종이 표시 */
export function PostGrid({ posts, onOpen, emoji }: { posts: readonly Post[]; onOpen: (p: Post) => void; emoji?: string }) {
  return (
    <div className="sns-grid">
      {posts.map(p => (
        <button key={p.id} type="button" className="sns-cell" onClick={() => onOpen(p)} aria-label={p.caption || p.place}>
          <PhotoImg shotId={p.cuts[0].shotId}><span className="sns-cut-empty">{emoji ?? '🖼'}</span></PhotoImg>
          {p.cuts.length > 1 && <i className="sns-cell-n num" aria-hidden="true">{p.cuts.length}</i>}
        </button>
      ))}
    </div>
  );
}
