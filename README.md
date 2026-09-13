# NongMeow2

NongMeow2 is a NestJS LINE reminder bot. It reads natural language reminders from LINE DMs or group mentions, asks Gemini to turn the text into structured reminder records, stores them in SQLite, and sends LINE notifications when they are due.

## Features

- Create one or many reminders from one message.
- Understand Thai, English, and mixed messages through Gemini.
- Support one-time reminders and recurring reminders such as every Sunday.
- List reminders with natural language queries.
- Hide finished items by default unless the user asks for all or finished items.
- Show overdue reminders.
- Display LINE Flex widgets for confirmation, reminder lists, notifications, and cancel confirmation.
- Use LINE loading animation in DMs.
- Send a short thinking message in group chats before the final widget.
- Require confirmation before cancelling reminders.

## Requirements

- Node.js 20.19+, 22.13+, or newer is recommended.
- npm
- A LINE Messaging API channel
- A Gemini API key
- A public HTTPS tunnel for local testing, such as ngrok or Cloudflare Tunnel

## Setup

Install dependencies:

```powershell
npm install
```

Create `.env` from `.env.example`:

```env
LINE_CHANNEL_SECRET=your_line_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
APP_TIMEZONE=Asia/Bangkok
REMINDER_IMAGE_URL=https://example.com/cat-clock.jpg
DATABASE_PATH=data/reminders.sqlite
```

Run the development server:

```powershell
npm run start:dev
```

The app listens on:

```text
http://localhost:3000
```

## LINE Webhook

Expose your local server:

```powershell
ngrok http 3000
```

Set this webhook URL in LINE Developers:

```text
https://your-public-url/line/webhook
```

Enable:

```text
Use webhook: Enabled
```

The webhook endpoint is:

```text
POST /line/webhook
```

## Example Messages

Create reminders:

```text
พรุ่งนี้ 9 โมง เตือนประชุม
Tmrw wake up at 8 am
Next week run in the evening all week
Every Sunday review homework at 7pm
```

List reminders:

```text
ตอนนี้มีงานไรบ้าง
งานสัปดาห์นี้มีไรบ้าง
งานที่ส่งพุธหน้า
งานที่ยังไม่เสร็จ
รายการทั้งหมดรวมเสร็จแล้ว
งานที่เลยกำหนดมีอะไรบ้าง
```

Cancel reminders:

```text
ยกเลิกงานประชุมพรุ่งนี้
ลบงานที่เลยกำหนด
cancel all overdue tasks
ยกเลิก reminder วิ่งวันอาทิตย์
```

## How It Works

1. LINE sends events to `POST /line/webhook`.
2. The controller verifies the LINE signature using the raw request body.
3. The service accepts DMs automatically and group messages only when the bot is mentioned.
4. Simple exact commands like `list`, `ซ้ำ`, or `help` are handled locally before calling Gemini.
5. Gemini classifies natural-language text as create, list, cancel, or unknown.
6. Reminder records are stored in SQLite at `data/reminders.sqlite` by default.
7. The scheduler sends LINE push notifications when reminders are due.

## Scripts

```powershell
npm run build
npm run start:dev
npm run start:prod
npm test
```

## Notes

`data/reminders.sqlite` is local development storage and is ignored by Git. On startup, if the database is empty and an old `data/reminders.json` file exists, the app migrates those reminders into SQLite once.
