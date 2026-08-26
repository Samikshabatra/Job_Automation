# Gmail tracking — one-time setup

The pipeline reads your inbox to work out what happened to each application.
It requests **read-only** Gmail scope: it classifies mail and never sends,
replies, labels or deletes.

You only do this once. Roughly ten minutes, all of it in a browser.

## 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com/projectcreate
2. Name it anything (`job-automation` is fine) and create it.

## 2. Enable the Gmail API

1. https://console.cloud.google.com/apis/library/gmail.googleapis.com
2. Make sure your new project is selected, then **Enable**.

## 3. Configure the consent screen

1. https://console.cloud.google.com/apis/credentials/consent
2. Choose **External**, fill in the app name and your email, and save.
3. On the **Audience** step, add your own Gmail address as a **Test user**.
   Without this the token is refused. A personal project stays in "Testing"
   indefinitely, which is fine — you are the only user.

## 4. Create the OAuth client

1. https://console.cloud.google.com/apis/credentials
2. **Create credentials → OAuth client ID → Desktop app**.
3. Download the JSON and save it as:

```
config/gmail_credentials.json
```

## 5. Authorise once

```
npm run gmail-auth
```

It prints a URL. Open it, grant access, and Google redirects to a `localhost`
address **that fails to load — this is expected**. Copy the `code=` value out
of the browser's address bar and paste it back into the terminal.

That writes `config/gmail_token.json`.

## 6. Run it

```
npm run inbox        # last 7 days
npm run inbox 30     # wider window, useful on the first run
```

Output:

```
fetched=64 new=12 linked=5 unlinked=7
rules=4 llm=1 unclassified=0 ghosted=2
Tracker written to C:\Users\...\job-applications\tracker.xlsx
```

## Security notes

- Both `config/gmail_credentials.json` and `config/gmail_token.json` are
  gitignored. They grant access to your mailbox — never commit them, and do
  not paste their contents anywhere.
- The scope requested is `gmail.readonly`. A leaked token could read mail but
  could not send as you or delete anything.
- To revoke access at any time: https://myaccount.google.com/permissions

## How classification works

Rules first, LLM only for the remainder — this is what keeps the tracker
inside the Gemini free tier.

| Signal | Outcome |
|---|---|
| "unfortunately", "regret to inform", "not moving forward" | `rejected` |
| "interview", "schedule a call", "your availability" | `interview` |
| "coding challenge", "assessment", "take-home" | `screening` |
| "received your application", "thank you for applying" | `acknowledged` |
| no rule matches | one small Gemini call |
| silent for 21 days | `ghosted` |

Rejection patterns are tested **before** interview ones on purpose: a
rejection routinely names the interview it is declining to offer, and the
reverse order would misread the most common email in the inbox as the best
news in it.

An email that cannot be attributed to a specific application is recorded but
left unlinked rather than guessed at — a wrong link would silently move
another company's application to `rejected`.
