# OAuth Provider Setup

Hearth supports Google and Apple sign-in. Credentials come from the respective developer consoles and are passed via environment variables. Without credentials the server runs with anonymous accounts only.

## Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an OAuth 2.0 Client of type **Web application**.
3. Add an **Authorized redirect URI**: `<PublicBaseURL>/api/auth/google/callback`
4. Copy the **Client ID** and **Client Secret**.

## Apple

1. Go to the [Apple Developer Console](https://developer.apple.com/account/resources/services/list).
2. Create a **Services ID** for Sign in with Apple.
3. Create a **Sign in with Apple key** (`.p8`) and download it.
4. Record the **Services ID** (the client ID), **Team ID**, and **Key ID**.
5. Add a **Return URL**: `<PublicBaseURL>/api/auth/apple/callback`

## Environment Variables

```
PUBLIC_BASE_URL=https://your-host
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
APPLE_TEAM_ID=
APPLE_KEY_ID=
```

Set these in your `.env` file or the process environment. The server runs with anonymous accounts until credentials for at least one provider are present.
