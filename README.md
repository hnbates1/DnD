# DnD Crawl Projector

A local browser-based system for running a tabletop dungeon crawl with projected animated maps, spell effects, board tokens, and webcam-assisted gesture/placement tracking.

## Start

```powershell
python server.py
```

Open:

- DM console: `http://127.0.0.1:8765/`
- Projector view: `http://127.0.0.1:8765/?screen=projector`

Put the projector browser window on the projector display, then click **Fullscreen**.

## Notes

- Map videos are selected locally in the browser. They are not uploaded anywhere.
- To sync a map to both the DM screen and projector screen, put video files in the `media` folder, then pick them from the media library in the DM console.
- The local file picker is useful for quick previews, but browser security keeps that file private to the window where it was selected.
- The webcam tracker runs in the browser. It uses simple motion/bright-object detection as a prototype, so it does not need an API key.
- The AI Table Assistant uses OpenAI from the local Python server. It can answer rules questions, give hints, help narrate, track combat concerns, or temporarily act as DM.
- Do not paste API keys into chat or source files.

## AI Setup

Rotate any key that was pasted into chat before using it.

Option 1, current PowerShell session:

```powershell
$env:OPENAI_API_KEY="your_rotated_key"
python server.py
```

Option 2, local gitignored file:

```powershell
Copy-Item secrets.env.example secrets.env
notepad secrets.env
python server.py
```

The default model is `gpt-5.5`. You can change it with `OPENAI_MODEL`.

## Suggested Setup

1. Connect the projector as a second display.
2. Open the projector URL on that display and enter fullscreen.
3. Open the DM console on your laptop screen.
4. Load a map video.
5. Use calibration to align camera coordinates with the projected board.
6. Use spells, fog, and token tools during play.
