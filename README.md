# Inkling — Air Writing Studio ✍️

Write on thin air. Point your index finger at your webcam and it becomes a
glowing calligraphy nib — no stylus, no tablet, no backend. Everything runs
client-side using [MediaPipe Hands](https://developers.google.com/mediapipe)
for real-time hand tracking, so it deploys as a **static site** straight to
GitHub Pages.

### The hand-signs
| Gesture | Effect |
|---|---|
| ☝️ One finger (index) | **Draw** — fingertip becomes the pen |
| ✌️ Two fingers (index + middle) | **Hover** — move without drawing |
| 🤟 Three fingers (index + middle + ring) | **Cycle** ink colour |
| 🖐️ Open palm | **Erase** near your hand |
| ✊ Fist, held ~1 second | **Clear** the whole canvas |

Toolbar also lets you pick a colour by hand, adjust nib size, toggle the
glowing ink trail, show the hand skeleton overlay, and save your drawing as
a PNG.

---

## Run it locally

No build step, no npm install. Any static file server works, e.g.:

```bash
cd air-writer
python3 -m http.server 8080
# then open http://localhost:8080
```

You need `http://localhost` or `https://` (not `file://`) for the browser
to grant camera access.

## Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `inkling`) and push these three files
   (`index.html`, `style.css`, `script.js`) to the `main` branch:
   ```bash
   git init
   git add index.html style.css script.js README.md
   git commit -m "Inkling: air-writing studio"
   git branch -M main
   git remote add origin https://github.com/<your-username>/inkling.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick **branch: `main`**, folder **`/ (root)`**, then **Save**.
5. Wait a minute, then visit `https://<your-username>.github.io/inkling/`.

GitHub Pages serves over HTTPS by default, which is required for
`getUserMedia()` camera access to work — no extra config needed.

### Update the "source" link
In `index.html`, point the footer link at your real repo:
```html
<a href="https://github.com/<your-username>/inkling" id="repoLink">source</a>
```

---

## How the tracking works (short version)

- MediaPipe Hands returns 21 normalized landmarks per detected hand, ~30
  times a second, entirely in-browser (no video ever leaves the device).
- `script.js` compares the y-position of each fingertip to its knuckle to
  decide which fingers are extended, and maps the combination to a gesture.
- The index fingertip's position drives the "nib" — while gesture is
  `draw`, points are appended to the current stroke and rendered as a
  smoothed, glowing quadratic-curve path on a canvas layered above the
  video.

Feel free to tune the sensitivity in `detectGesture()` and
`isExtended()` in `script.js` — the `0.02` threshold controls how far a
fingertip must clear its knuckle to count as "extended."

---

## Suggested LinkedIn post

> Built something fun this weekend: **Inkling**, a browser app that turns
> your index finger into a calligraphy pen using real-time hand tracking.
> No stylus, no tablet — just a webcam and some vector math. ☝️➡️✍️
>
> It runs entirely client-side (MediaPipe Hands + Canvas), so there's no
> backend at all — the whole thing is hosted free on GitHub Pages.
>
> Try it: [your GitHub Pages link]
> Code: [your repo link]
>
> #webdev #computervision #javascript #buildinpublic

---

## Ideas for next passes
- Multi-hand support (two-handed drawing, or one hand draws / one hand is a menu)
- Pinch-to-select for tapping toolbar buttons without touching the keyboard
- Undo via a "peace sign held" gesture
- Export drawings as an animated GIF of the stroke order, not just a flat PNG
