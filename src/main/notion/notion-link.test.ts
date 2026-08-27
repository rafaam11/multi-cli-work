import { describe, expect, it } from "vitest";
import { parseNotionLink } from "./notion-link";

describe("노션 링크 파싱", () => {
  it("요즘 형식(slug 없는 /p/<32hex>)에서 id를 뽑는다", () => {
    expect(parseNotionLink("https://app.notion.com/p/44c1183735e08258ac3b017e876998a1?pvs=204")).toEqual({
      id: "44c11837-35e0-8258-ac3b-017e876998a1",
    });
  });

  it("데이터베이스 뷰 주소에서 뷰 id가 아니라 경로의 id를 뽑는다", () => {
    expect(
      parseNotionLink(
        "https://app.notion.com/p/digitrack/24e1183735e0807094e2c42ab2130f3f?v=24e1183735e0804cba55000cde3f6297",
      ),
    ).toEqual({ id: "24e11837-35e0-8070-94e2-c42ab2130f3f" });
  });

  it("슬러그가 붙은 구형 주소에서 뒤쪽 id를 뽑는다", () => {
    expect(parseNotionLink("https://app.notion.com/p/digitrack/DIGITRACK-0c0d64246fd24571b2040fc26bdedc63")).toEqual({
      id: "0c0d6424-6fd2-4571-b204-0fc26bdedc63",
    });
  });

  it("notion.so와 공개 notion.site 주소도 받는다", () => {
    expect(parseNotionLink("https://www.notion.so/476dc21ab5ad4823b09ed732375d1829")).toEqual({
      id: "476dc21a-b5ad-4823-b09e-d732375d1829",
    });
    expect(parseNotionLink("https://digitrack.notion.site/fcaf68311fc14852b32319800dccf018")).toEqual({
      id: "fcaf6831-1fc1-4852-b323-19800dccf018",
    });
  });

  it("하이픈이 들어간 id를 그대로 인정한다", () => {
    expect(parseNotionLink("https://app.notion.com/p/44c11837-35e0-8258-ac3b-017e876998a1")).toEqual({
      id: "44c11837-35e0-8258-ac3b-017e876998a1",
    });
  });

  it("사이드 피크 주소는 경로(부모)가 아니라 p 파라미터의 페이지를 가리킨다", () => {
    expect(
      parseNotionLink(
        "https://app.notion.com/p/digitrack/24e1183735e0807094e2c42ab2130f3f?p=0c0d64246fd24571b2040fc26bdedc63&pm=s",
      ),
    ).toEqual({ id: "0c0d6424-6fd2-4571-b204-0fc26bdedc63" });
  });

  it("노션이 아니거나 id가 없는 주소는 거절한다", () => {
    expect(parseNotionLink("https://example.com/p/44c1183735e08258ac3b017e876998a1")).toBeNull();
    expect(parseNotionLink("https://app.notion.com/my-integrations")).toBeNull();
    expect(parseNotionLink("notion.so/44c1183735e08258ac3b017e876998a1")).toBeNull();
    expect(parseNotionLink("")).toBeNull();
  });
});
