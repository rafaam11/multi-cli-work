/**
 * 노션 링크에서 API가 쓰는 리소스 id를 뽑는다. 네트워크를 타지 않는 순수 함수다.
 *
 * 요즘 노션이 복사해주는 주소에는 제목 slug가 없다 (`app.notion.com/p/<32hex>?pvs=204`).
 * 남는 단서는 id뿐이라 제목은 API로만 알 수 있다.
 */
const NOTION_HOSTS = new Set(["notion.so", "www.notion.so", "notion.com", "www.notion.com", "app.notion.com"]);

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BARE_ID_PATTERN = /[0-9a-f]{32}/gi;

export interface NotionLinkTarget {
  /** 하이픈이 들어간 표준 UUID — 노션 API가 두 형식 모두 받지만 로그·테스트에서 한 형식으로 고정한다. */
  id: string;
}

function hyphenate(bare: string): string {
  return [bare.slice(0, 8), bare.slice(8, 12), bare.slice(12, 16), bare.slice(16, 20), bare.slice(20)].join("-");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // 잘못 인코딩된 경로는 그대로 훑는다 — id는 어차피 hex라 영향이 없다.
  }
}

function idFromSegment(segment: string): string | null {
  const uuid = segment.match(UUID_PATTERN);
  if (uuid) return uuid[0].toLowerCase();
  const bare = segment.match(BARE_ID_PATTERN);
  // 슬러그가 붙은 구형 주소(`DIGITRACK-<32hex>`)는 id가 맨 뒤에 온다.
  return bare ? hyphenate(bare[bare.length - 1].toLowerCase()) : null;
}

export function parseNotionLink(value: string): NotionLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!NOTION_HOSTS.has(host) && !host.endsWith(".notion.site")) return null;

  // 사이드 피크로 연 페이지는 경로가 부모를 가리키고 `p`가 실제로 보고 있는 페이지다.
  // 이걸 무시하면 엉뚱한 부모의 제목을 조용히 가져온다.
  const peeked = url.searchParams.get("p");
  if (peeked) {
    const id = idFromSegment(peeked);
    if (id) return { id };
  }

  // `v`는 데이터베이스 뷰 id다 — 대상이 아니므로 경로만 본다.
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  for (let at = segments.length - 1; at >= 0; at -= 1) {
    const id = idFromSegment(decodeSegment(segments[at]));
    if (id) return { id };
  }
  return null;
}
