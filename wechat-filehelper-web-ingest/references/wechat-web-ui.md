# WeChat Web UI Targets

CSS selectors and DOM anchors used by `scripts/lib/chat.js` to automate wx.qq.com.

**Important:** WeChat Web's DOM may change after WeChat updates. When selectors fail,
use `node scripts/scan-links.js --debug` to dump the current DOM snapshot, then update
this file and the `SEL` constants in `scripts/lib/chat.js`.

---

## Left Panel: Contact/Chat Search

| Element | Selector | Notes |
|---------|---------|-------|
| Search input | `input.search_input` | Top search box in left panel |
| Contact item | `.contact_item` | Each item in search results or chat list |
| Contact name | `.contact_item .nickname` | Display name text |

---

## Right Panel: Chat Message Area

| Element | Selector | Notes |
|---------|---------|-------|
| Chat scroll container | `#chatArea .content` | Main scrollable message list |
| Message wrapper | `.msg` | Each message bubble row |
| Timestamp divider | `.msg .time_tag` | Time labels shown between groups of messages |
| Plain text bubble | `.msg .content .plain` | Container for text message content |
| Text links | `.msg .content .plain a[href]` | Clickable links within text messages |

---

## Article Link Cards (share_card)

WeChat Web renders article link previews as rich cards inside message bubbles.

| Element | Selector | Notes |
|---------|---------|-------|
| Card container | `.msg .content .app_msg_ext_info` | Outer container for app/article share cards |
| Card anchor | `a[href]` (within card) | The main link; href = article URL |
| Card title | `.app_msg_ext_info .title` | Article headline text |

---

## Video Channel Cards (视频号 — skip these)

Video channel posts render as a special card type without a direct article URL.

| Element | Selector | Notes |
|---------|---------|-------|
| Channel indicator | `.channel_icon` | Icon or badge identifying a 视频号 card |
| Class hint | class contains `channel` | Any card container with "channel" in its class |

These cards are detected and skipped during extraction.

---

## Known Selector Variants

Some builds of WeChat Web use slightly different class names:

| Alternative selector | Used when |
|---------------------|----------|
| `#msgList` | Older chat panel container |
| `.chat_bd` | Another common chat panel class |
| `.msg_createtime` | Alternative timestamp class |
| `.js_message_plain` | Alternative plain text class |
| `.js_wx_tap_highlight` | Alternative share card class |

The `SEL` object in `chat.js` includes both primary and fallback selectors using comma-separated Playwright locators.

---

## Session / Login

| Element | Selector | Notes |
|---------|---------|-------|
| QR code | `#header .qrcode` or `img[src*='qrcode']` | Present when not logged in |
| Nav bar (logged in) | `#navBar` | Appears once login completes |
| Chat list (logged in) | `.chat_list` | Alternative logged-in indicator |

---

## Update Log

| Date | Change |
|------|--------|
| 2026-03-28 | Initial selectors, based on wx.qq.com structure |
