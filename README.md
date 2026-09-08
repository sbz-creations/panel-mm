# panel-mm

Internal operations panel that runs the day-to-day audiovisual production workflow of a coach-training platform: SRT subtitle localization across 5+ languages, Vimeo thumbnail and subtitle-track management, and bulk video-version replacement.

**Live:** https://panel-mm.vercel.app — access is Google OAuth + email allowlist. UI is in Spanish.

## What it does

- **Subflow** — SRT subtitle localization. Bulk translation across 5+ target languages with per-line editing, translation history, and ZIP export. Uses Claude as the primary translator, with Google Translate as fallback.
- **Thumbnails** — browse Vimeo folders, preview and apply custom thumbnails through a safe dry-run → apply → discard flow, and manage the subtitle tracks embedded in each video.
- **Bulk Versions** — replace the source file of multiple Vimeo videos at once without changing the public link, using resumable TUS uploads.
- **Transcribe** — hand off a local path or URL to a Python + faster-whisper backend and pull back the resulting SRT.
- **Auth & i18n** — Auth.js v5 with Google OAuth and a hard email allowlist; UI fully bilingual (ES/EN).

## Why it exists

Built to run the day-to-day operations of **Maradona Menotti**, a coach-training platform endorsed by AFA and CONMEBOL, whose library has grown to **1,200+ videos distributed in 5 languages**. Manual localization at that scale is a full-time job — this panel replaces it with a single operator flow.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
- Auth.js v5 (Google OAuth + email allowlist)
- Vimeo API (folders, videos, tracks, thumbnails)
- `tus-js-client` for resumable uploads
- Anthropic Claude + Google Translate for subtitle localization
- Delegates transcription to a separate Python service (FastAPI + `faster-whisper`)

## Screenshots

<!-- TODO: subir capturas -->
![Home](docs/screenshot-1.png)
![Subflow — subtitle translation flow](docs/screenshot-2.png)
![Thumbnails — dry-run preview](docs/screenshot-3.png)

## Running locally

```bash
cp env.example .env.local   # fill in the values
npm install
npm run dev
```

See [`env.example`](env.example) for the required environment variables (Auth.js, Google OAuth, Vimeo token, Anthropic key).

## Notes

Internal tool. Not an official product of Vimeo, Anthropic, Google, AFA, CONMEBOL, or the Maradona Menotti platform itself — this repository is my own operator tooling, built to make day-to-day work on the platform's video library scale. The endorsement mentioned above refers to the parent platform; it does not extend to this panel or to me personally.

## License

MIT — see [LICENSE](LICENSE).
