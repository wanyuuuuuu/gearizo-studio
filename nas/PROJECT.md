# Adjustable video projects (口播 subtitles, 花字, stickers)

Videos made with Claude can be sent to the Gearizo app as an **adjustable project** instead of a finished MP4.
The content team then opens **Adjust** on that video in Review: they drag subtitles, 花字 and stickers around,
change the text, font, size, colour, outline, shadow and timing, and press **Render new version**. This Mac
renders it, drops the file in `Content Video/Checking`, and it becomes the next version, sent for review.

## What a project folder holds

```
my-video/
  project.json
  base.mp4            the video WITHOUT subtitles or 花字 (they are drawn on top)
  assets/…            pictures (.png/.jpg/.webp) and sticker clips (.mov with transparency)
```

`project.json`:

```json
{
  "base": {"path": "base.mp4"},
  "layers": [
    {"id": "s1", "kind": "text", "group": "sub", "text": "轮胎气压不够，油耗会变高",
     "x": 540, "y": 1560, "start": 0.5, "end": 3.5,
     "style": {"font": "heiti", "size": 64, "weight": 900, "color": "#FFFFFF", "stroke": "#000000", "strokeW": 6, "maxW": 940}},
    {"id": "f1", "kind": "text", "text": "蛤？！", "x": 760, "y": 620, "rot": -8, "start": 1, "end": 4,
     "anim": {"in": "pop", "out": "fade"},
     "style": {"font": "huangyou", "size": 150, "color": "#FFE14D", "stroke": "#E8336D", "strokeW": 10, "shadowA": 0.45}},
    {"id": "k1", "kind": "sticker", "name": "惊讶", "src": {"path": "assets/wow.mov"}, "crop": [1224, 368, 220, 336],
     "loop": 1, "w": 240, "x": 880, "y": 820, "start": 4, "end": 7, "anim": {"in": "fade", "out": "fade"}},
    {"id": "p1", "kind": "image", "name": "Product", "src": {"path": "assets/product.png"}, "w": 600, "x": 540, "y": 900, "start": 8, "end": 12}
  ]
}
```

- Positions are in video pixels; `x`/`y` is the **centre** of the layer. `s` = scale (default 1), `rot` = degrees.
- `start`/`end` in seconds. `anim.in`: `none` `pop` `fade` `up`; `anim.out`: `none` `fade`.
- `group: "sub"` marks subtitles: in the app their style and position change together.
- Text style keys (all optional): `font` (`heiti` 粗黑, `huangyou` 黄油体, `kuaile` 快乐体, `xiaowei` 小薇体, `maobi` 毛笔字,
  `song` 宋体, `montserrat`, `bebas`, `anton`), `size`, `weight`, `italic`, `color`, `stroke`, `strokeW`, `shadow`,
  `shadowA` (0–1, 0 = none), `shadowBlur`, `shadowY`, `bg`, `bgA` (box behind the text, 0 = none), `radius`, `pad`,
  `maxW` (wrap width, 0 = one line), `lh`, `ls`. Emoji work as text.
- Stickers: `w` = width on screen, `crop` = `[x, y, w, h]` of the part of the clip to use, `loop` = extra plays.
  Stickers sit under text. Images can have a shadow (`style.shadowA`).
- Layers later in the list are drawn on top.

## Commands (run on the Mac in `~/.claude/gearizo-nas`)

```
python3 gz_edit.py render <folder> out.mp4         # check it here first
python3 gz_edit.py push <folder> GZ012             # send it to the app as video GZ012
python3 gz_edit.py push <folder> GZ012 --force     # replace an existing project (drops the team's adjustments)
```

`push` copies the folder to `Content Video/Projects/<code> <title>` on the NAS, uploads a small preview of the
base video and stills of pictures/stickers, and creates the project in the app. Rendering needs this Mac on,
the NAS mounted, Google Chrome and Node.js. The text drawing is shared with the app (`gzlayers.js`), so what
the team sees while adjusting is what comes out.
