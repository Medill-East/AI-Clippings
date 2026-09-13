# WeChat tab-strip regression fixture

`docked-tabbar.png` is the right-hand tab strip (1470×100 pixels) cropped from
run `2026-09-13T16-13-21`'s `viewer-cleanup-failed.png`. It excludes the chat
sidebar and article body. The active close control is centered near (612, 56).
It reproduces the crowded strip where the former fixed 905-point click missed.

`references/article-tab-close.png` is the 36×36-pixel close-button template from
the same frame. The native matcher normalizes brightness and display scale.
