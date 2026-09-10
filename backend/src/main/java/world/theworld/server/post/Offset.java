package world.theworld.server.post;

import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/**
 * "offset부터 size개" Pageable — 커서가 offset을 들고 다니므로(§2.5 cursor) 페이지 번호 × 크기로는 안 맞는다(limit이 요청마다 달라도 된다).
 * 정렬은 쿼리의 order by가 정하므로 여기선 unsorted.
 */
record Offset(long offset, int size) implements Pageable {
  static Offset of(long offset, int size) { return new Offset(offset, size); }

  @Override public int getPageNumber() { return (int) (offset / size); }
  @Override public int getPageSize() { return size; }
  @Override public long getOffset() { return offset; }
  @Override public Sort getSort() { return Sort.unsorted(); }
  @Override public Pageable next() { return new Offset(offset + size, size); }
  @Override public Pageable previousOrFirst() { return hasPrevious() ? new Offset(Math.max(0, offset - size), size) : first(); }
  @Override public Pageable first() { return new Offset(0, size); }
  @Override public Pageable withPage(int pageNumber) { return new Offset((long) pageNumber * size, size); }
  @Override public boolean hasPrevious() { return offset > 0; }
}
