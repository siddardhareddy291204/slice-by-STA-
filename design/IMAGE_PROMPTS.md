# Slice — Image Brief for the Image Model

Photographs for the Slice app (Sridhar’s Tennis Academy). The app is a **mobile tennis-day organizer**: dark forest-green photographic headers, a tennis-ball **lime** accent, white rounded cards and floating glass controls.

Make every image **photorealistic, editorial sports photography**, never illustration or 3D render. The UI places white text and glass buttons over these photos, so each brief says where the image must stay quiet.

---

## 1. Shared style (apply to every prompt)

| | |
| --- | --- |
| **Look** | Photorealistic, premium sports-brand campaign, natural light, shallow depth of field, subtle film grain |
| **Palette** | Deep forest and moss greens (#1C2A1A, #2A3B26, #4F6B3A), tennis-ball yellow-green (#D4F04C) as the hero accent, soft sage and off-white highlights. No red/orange clay. |
| **Light** | Golden hour or soft overcast. Gentle, warm highlights, rich shadows; never harsh midday sun or HDR. |
| **Lens** | 50–100 mm look, f/1.8–f/2.8 bokeh, slightly low camera angles near the court surface |
| **Surfaces** | Green hard courts, grass courts, white court lines, dark net mesh, green windscreens, chain-link fence |
| **People** | None, unless a brief asks. No faces, ever (the app stores no personal data and must not look like it shows real players). |

**Negative prompt (all images):**
`text, letters, words, logos, brand names, watermark, signature, tournament branding, sponsor boards, scoreboards with numbers, clay court, orange court, red court, faces, crowds, cartoon, illustration, 3D render, CGI, oversaturated, HDR, lens flare streaks, distorted ball, extra balls floating, blurry subject`

**Delivery:** JPG (or WebP), sRGB, quality 80–85, **under 400 KB each**. Save with the **exact filename** below into `slice/public/img/`. The app picks them up automatically, with no code changes.

---

## 2. Image list

Until a file exists, the app shows a dark-green gradient with a soft lime glow in its place, so the layout already works with nothing in `public/img/`.

### IMG-01 · Sign-in hero
- **File:** `public/img/hero-signin.jpg`
- **Size:** 1170 × 1560 (3:4, portrait)
- **Used on:** the full-bleed photo behind the organizer sign-in card
- **Quiet zones:** top 30% (app name sits there) and bottom 35% (glass sign-in card). Put the subject in the middle band.

> Photorealistic close-up of a single bright yellow-green tennis ball resting on a dark green hard tennis court, sitting right on a crisp white baseline, low camera angle at court level, shallow depth of field with the net and a dark green windscreen softly blurred behind, golden-hour side light catching the ball’s felt fuzz, deep forest-green color grade, moody and premium, subtle film grain, vertical composition with lots of calm dark space above and below the ball.

### IMG-02 · Home header
- **File:** `public/img/hero-home.jpg`
- **Size:** 1170 × 900 (≈4:3)
- **Used on:** the top header of the organizer home screen (greeting, week date strip)
- **Quiet zones:** left half and bottom 40%, which hold white text and the date chips. Ball on the right.

> Photorealistic tennis ball lying in lush, slightly dewy grass on a grass tennis court, white painted line running diagonally through the frame, ball placed in the upper-right third, extreme shallow depth of field, early-morning soft backlight with glowing dew, rich forest and moss greens, darker vignette toward the left and bottom edges, calm editorial sports photography, no people.

### IMG-03 · Session card thumbnail A (outdoor hard court)
- **File:** `public/img/court-1.jpg`
- **Size:** 720 × 540 (4:3)
- **Used on:** the thumbnail on session cards (cards rotate through court-1/2/3)
- **Quiet zones:** none, since it's shown small with rounded corners

> Photorealistic elevated view of an empty outdoor tennis court with a green playing surface and darker green surround, crisp white lines, net across the middle, tall trees and green windscreen around the fence, late-afternoon warm light with long soft shadows, clean and inviting, no people, no signage.

### IMG-04 · Session card thumbnail B (indoor court)
- **File:** `public/img/court-2.jpg`
- **Size:** 720 × 540 (4:3)
- **Used on:** session card thumbnail

> Photorealistic wide view of an empty indoor tennis hall, two green hard courts with white lines, high arched roof with soft daylight panels, diffused even light, a few tennis balls near the baseline, calm and spacious, green and sage tones, no people, no signage or logos.

### IMG-05 · Session card thumbnail C (floodlit evening court)
- **File:** `public/img/court-3.jpg`
- **Size:** 720 × 540 (4:3)
- **Used on:** session card thumbnail

> Photorealistic outdoor tennis court at blue hour under warm floodlights, green court surface glowing, white lines, net in the mid-ground, dark trees silhouetted against a deep teal-blue sky, gentle light halos, atmospheric and calm, no people, no signage.

### IMG-06 · Day screen header
- **File:** `public/img/hero-day.jpg`
- **Size:** 1170 × 780 (3:2)
- **Used on:** the header behind a session’s title on the Courts / Standings / Log / Setup screens
- **Quiet zones:** bottom 45% (title, meta chips). The upper area can be busier.

> Photorealistic low-angle shot along the white tape of a tennis net on a green hard court, net mesh in sharp focus at the top of the frame, two tennis balls resting at the bottom of the net, court falling away into soft bokeh, golden-hour backlight, deep green grade, darker bottom half, cinematic and minimal, no people.

### IMG-07 · Live scoring backdrop
- **File:** `public/img/scoring-bg.jpg`
- **Size:** 1170 × 2532 (≈9:19.5, tall phone)
- **Used on:** the full-screen background of the point-by-point scorer, darkened and blurred behind a glass scoreboard and two large tap pads
- **Quiet zones:** everything. It must be calm and low-contrast. Large score numbers and buttons cover most of it.

> Photorealistic dark, moody view of a green tennis court at dusk seen from behind the baseline, net and far court heavily out of focus, soft green and teal ambient tones, a faint warm floodlight glow at the top edge, very low contrast and minimal detail, lots of smooth dark space, subtle film grain, vertical phone wallpaper composition, no people, no text.

### IMG-08 · Player of the Day card
- **File:** `public/img/potd.jpg`
- **Size:** 1170 × 660 (16:9)
- **Used on:** background of the Player of the Day card (standings and player view), darkened, with the winner’s name in large white text and lime stats on the left
- **Quiet zones:** left 60% must be dark and simple. Subject on the right.

> Photorealistic still life of a tennis racket leaning against a courtside bench with a fresh tennis ball and a folded white towel, placed in the right third of the frame, warm golden-hour rim light, deep shadowed forest-green background fading to near-black on the left, celebratory but understated mood, shallow depth of field, premium editorial sports photography, no people, no trophies with engraving, no logos on the racket.

### IMG-09 · Player view header
- **File:** `public/img/hero-public.jpg`
- **Size:** 1170 × 780 (3:2)
- **Used on:** the header of the read-only link players open on their phones
- **Quiet zones:** bottom 45% (session title, date)

> Photorealistic view through a dark green chain-link fence onto a sunlit green tennis court, fence wire softly out of focus in the foreground, a single tennis ball on the court in sharp focus mid-frame, warm afternoon light, rich greens with a soft lime highlight on the ball, darker lower third, inviting spectator perspective, no people.

### IMG-10 · Empty state
- **File:** `public/img/empty.jpg`
- **Size:** 800 × 800 (1:1)
- **Used on:** friendly empty states ("No sessions yet", "No results yet"), shown as a small rounded image above one short line of text
- **Quiet zones:** none

> Photorealistic minimal composition of one tennis ball resting against the bottom of a tennis net on a green hard court, soft overcast light, clean muted sage-green background, lots of negative space, calm and simple, centered subject, no people, no text.

---

## 3. Checklist when you hand images back

- [ ] Filenames match exactly (`hero-signin.jpg`, `hero-home.jpg`, `court-1.jpg`, `court-2.jpg`, `court-3.jpg`, `hero-day.jpg`, `scoring-bg.jpg`, `potd.jpg`, `hero-public.jpg`, `empty.jpg`)
- [ ] No text, logos or faces anywhere in the frame
- [ ] Quiet zones respected (white text must stay readable)
- [ ] Each file under 400 KB

Drop them into `slice/public/img/`, or attach them in chat and I’ll place, crop and compress them.
