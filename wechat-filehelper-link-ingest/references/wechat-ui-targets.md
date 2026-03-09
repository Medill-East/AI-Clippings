# WeChat UI Targets

Use this reference when the scan script needs to find stable UI Automation anchors on the current Windows WeChat client.

## Confirmed Targets On This Machine

- Main navigation toolbar:
  - `Name='瀵艰埅'`
  - `AutomationId='main_tabbar'`
  - `Class='mmui::MainTabBar'`
- Current chat title:
  - `AutomationId='content_view.top_content_view.title_h_view.left_v_view.left_content_v_view.left_ui_.big_title_line_h_view.current_chat_name_label'`
  - Example visible `Name='鏂囦欢浼犺緭鍔╂墜'`
- Chat page container:
  - `AutomationId='chat_message_page'`
  - `Class='mmui::ChatMessagePage'`
- Chat-record detail window:
  - Top-level `Class='mmui::RecordDetailWindow'`
  - Example visible `Name='無涘的聊天记录'`

## Selection Strategy

1. Prefer a top-level WeChat window whose descendants include `chat_message_page` or `main_tabbar`.
2. Read the current chat title from `current_chat_name_label`.
3. If the title is not `鏂囦欢浼犺緭鍔╂墜`, focus the window and try `Ctrl+F`, type `鏂囦欢浼犺緭鍔╂墜`, then press `Enter`.
4. Inside `chat_message_page`, enumerate descendant text/group/button elements with non-empty names and bounding rectangles.
5. Group elements by vertical position into message clusters. Parse URLs from cluster text first.
6. For clusters that look like share cards but have no URL, double-click the best clickable element in the cluster, then read the URL from the foreground browser-like window with:
   - WeChat article viewer menu `澶嶅埗閾炬帴`
   - fallback `浣跨敤榛樿娴忚鍣ㄦ墦寮€`
   - fallback `Ctrl+L`, `Ctrl+C`, clipboard read
7. For chat-record bundles whose first line starts with `聊天记录` and whose visible text includes `[链接]`:
   - Single-click the bubble `GetClickablePoint()` to open `mmui::RecordDetailWindow`
   - Enumerate `mmui::ChatBubbleItemView` items inside the detail window
   - Only keep items whose visible name starts with `[链接]`
   - Skip `视频号...` and any non-`[链接]` rows
   - Open a detail item by probing its inner text area with default ratios `x=[0.15,0.18,0.22]` and `y=[0.30,0.36,0.42]`
   - After each viewer switch, extract the real URL from the current WeChat article viewer

## Fallback Order

1. `mmui::MainWindow` main chat window
2. Any visible top-level window titled `寰俊` whose descendants expose `chat_message_page`
3. Focus foreground WeChat window and operate through keyboard only
4. Ask the user to open `鏂囦欢浼犺緭鍔╂墜` manually if search/navigation targets are missing

## Known Limits

- Newer WeChat builds can temporarily expose article views as `Chrome_WidgetWin_0`, which may hide the main chat UI tree until the user returns to the main conversation window.
- The article viewer top-right menu button is not exposed reliably through UI Automation on this machine. Menu access may require ratio-based click probing inside the viewer window.
- `RecordDetailWindow` does not expose the inner article preview as separate child controls on this machine. Child article opening therefore depends on fixed relative click points inside the detail-item bounds.
- Message timestamps are not guaranteed to be exposed for every bubble in UI Automation. The scanner therefore uses visible separator text when available and otherwise falls back to capture time for that cluster.
