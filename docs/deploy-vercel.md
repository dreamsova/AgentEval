# Deploy to Vercel

This is the fastest way to put the AgentEval MVP online as a public demo.

## 1. Push the app code to a GitHub repo

The app lives in the root of this project:

- `app/`
- `components/`
- `lib/`
- `package.json`

If you keep a local clone of the separate PGG research repo next to this app, make sure it stays gitignored before publishing.

## 2. Import the repo into Vercel

1. Go to [Vercel](https://vercel.com/).
2. Click `Add New...` -> `Project`.
3. Import the GitHub repository that contains AgentEval.
4. Keep the framework preset as `Next.js`.

## 3. Configure environment variables

Add these in the Vercel project settings:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` optional, defaults to `gpt-4.1-mini`

Important:

- put the key in a server-side environment variable only
- do not expose it as `NEXT_PUBLIC_OPENAI_API_KEY`

## 4. Deploy

Once the environment variables are set, trigger the deployment.

Vercel will:

- install dependencies with `npm install`
- build with `next build`
- serve the app as a standard Next.js deployment

## 5. Verify the live demo

After deployment, test:

1. the landing page loads correctly
2. sample traces populate the textarea
3. clicking `Evaluate Agent` returns a report
4. the app still works when the OpenAI call fails, using heuristic fallback

## 6. Recommended demo posture

For founder-house or startup outreach, keep the first live version narrow:

- one landing page
- one input box
- one report view
- three sample traces

Do not add auth, billing, or database features before the core demo feels strong.
