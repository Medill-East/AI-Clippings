# WeChat macOS Accessibility Tree Reference

Run `node scripts/inspect-accessibility.js` to dump the current AX tree, then document findings here.

## How to Populate This File

1. Open WeChat and navigate to 文件传输助手
2. Run: `node scripts/inspect-accessibility.js --depth 8`
3. Examine the output in `local/runs/<timestamp>/ax-tree-dump.txt`
4. Document the key elements below

---

## Main Window Structure

*Run inspect-accessibility.js and document findings here.*

```
[AXWindow] title="WeChat"
  [AXGroup] ...
    ...
```

## Key Element Paths

| Element | Role | Identifier | Notes |
|---------|------|-----------|-------|
| Chat list sidebar | ? | ? | Run inspect to discover |
| 文件传输助手 item | ? | ? | Run inspect to discover |
| Chat message scroll area | ? | ? | Run inspect to discover |
| Individual message | ? | ? | Run inspect to discover |
| Timestamp separator | ? | ? | Run inspect to discover |
| Share card URL | ? | ? | Run inspect to discover |

## Confirmed Selectors

*Populate after running inspect-accessibility.js on a real macOS machine.*

## Known Limitations

*Document any AX tree limitations discovered during testing.*
