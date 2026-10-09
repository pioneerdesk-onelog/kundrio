import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "./sanitize";

describe("HTML-Bereinigung", () => {
  it("entfernt Skripte, Event-Handler, Formulare und iframes", () => {
    const r = sanitizeEmailHtml(`<p onclick="x()">Hallo<script>alert(1)</script></p><form action="https://evil"><input name=p></form><iframe src="https://evil"></iframe><a href="javascript:alert(1)">x</a>`);
    expect(r.html).not.toMatch(/script|onclick|<form|<input|<iframe|javascript:/i);
    expect(r.html).toContain("Hallo");
  });
  it("blockiert externe Bilder und entfernt Zählpixel", () => {
    const r = sanitizeEmailHtml(`<img src="https://cdn.example.org/logo.png" alt="Logo"><img src="https://track.example.org/p.gif" width="1" height="1">`);
    expect(r.blockedImages).toBe(1);
    expect(r.trackingPixels).toBe(1);
    expect(r.html).not.toContain("https://cdn.example.org");
    expect(r.html).not.toContain("track.example.org");
  });
  it("lädt Bilder nur auf Wunsch, ohne Referrer", () => {
    const r = sanitizeEmailHtml(`<img src="https://cdn.example.org/logo.png">`, { allowRemoteImages: true });
    expect(r.html).toContain("https://cdn.example.org/logo.png");
    expect(r.html).toContain('referrerpolicy="no-referrer"');
  });
  it("entfernt url() und expression() aus Inline-Styles, Links öffnen sicher", () => {
    const r = sanitizeEmailHtml(`<div style="color:red;background:url(https://t.example/x)">a</div><a href="https://example.org">b</a>`);
    expect(r.html).not.toContain("url(");
    expect(r.html).toMatch(/rel="noopener noreferrer nofollow"/);
  });
});
