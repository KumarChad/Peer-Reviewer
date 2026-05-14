---
title: Peer Reviewer
colorFrom: gray
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Peer Reviewer

Paste an abstract, full paper, or upload a PDF. The app extracts the text and gives back a skeptical quick read:

- `CLAIM`
- `KEY NUMBER`
- `ASSUMPTION`
- `GAP`
- `CITE CHECK`

## Deploy on Hugging Face Spaces

1. Create a new Space on Hugging Face.
2. Choose `Docker` as the Space SDK.
3. Upload or push these files to the Space repository.
4. In the Space `Settings` tab, add a secret named `GEMINI_API_KEY`.
5. Optionally add `GEMINI_MODEL` if you want to override the default `gemini-2.5-flash`.
6. Wait for the Space to build and start.

The app listens on `PORT`, and the included Dockerfile is already configured for Hugging Face Spaces.

## Local Run

```bash
npm start
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).
