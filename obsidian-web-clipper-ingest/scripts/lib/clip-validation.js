export function assertClipSource(sourceUrl, expectedUrls) {
  if (/captcha|verify|security/i.test(new URL(sourceUrl).pathname)) {
    throw new Error("Verification page is not article content");
  }
  const normalize = (value) => {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  };
  if (!expectedUrls.map(normalize).includes(normalize(sourceUrl))) {
    throw new Error("Clip target source does not match requested page; refusing to save stale extension state");
  }
}
