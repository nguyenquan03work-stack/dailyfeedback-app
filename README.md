# Daily Feedback App

Mobile web app (Next.js App Router + Tailwind) to pick a teacher and student
from a Google Sheet and capture a photo of the student's learning diary.

## Flow
1. Teacher dropdown — populated from the spreadsheet's worksheet **tab names**.
2. Student dropdown — populated from **Column C (row 3 down)** of the selected teacher's tab.
3. Camera button — opens the phone's rear camera and shows a preview.

## Setup
1. `cp .env.local.example .env.local` and fill in the three values.
2. In Google Cloud: create a **Service Account**, download its JSON key, and
   **enable the Google Sheets API**.
3. **Share the spreadsheet** with the service account email (Viewer is enough).
4. `npm install`
5. `npm run dev` and open the URL on your phone (same network) to test the camera.

## Env vars (.env.local)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the service account email.
- `GOOGLE_PRIVATE_KEY` — the `private_key` from the JSON, in quotes, keeping the `\n` sequences.
- `GOOGLE_SHEET_ID` — the ID in the sheet URL between `/d/` and `/edit`.

## Key files
- `components/FeedbackForm.tsx` — the two dropdowns + camera capture UI.
- `app/api/get-students/route.ts` — reads Column C of the teacher's tab.
- `app/api/get-teachers/route.ts` — lists worksheet tab names as teachers.
- `app/lib/googleSheet.ts` — shared Google Sheets auth helper.
