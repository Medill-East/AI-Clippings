export function isVerificationUrl(url) {
  return /captcha|verify|security/i.test(new URL(url).pathname);
}

export function isWeChatVerificationRedirect(current, requested) {
  return requested.hostname === "mp.weixin.qq.com" && current.origin === requested.origin &&
    isVerificationUrl(current);
}

export function matchesWeChatArticle(current, requested) {
  if (current.origin !== requested.origin || current.pathname !== requested.pathname) {
    return false;
  }
  if (requested.pathname !== "/s") {
    return current.pathname.startsWith("/s/");
  }
  return ["__biz", "mid", "idx", "sn"].every((key) => {
    const value = requested.searchParams.get(key);
    return value !== null && current.searchParams.get(key) === value;
  });
}

export function assertClipSource(sourceUrl, expectedUrls) {
  if (isVerificationUrl(sourceUrl)) {
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
