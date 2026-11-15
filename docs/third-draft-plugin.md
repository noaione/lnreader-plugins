# Third Draft Plugin

[third-draft](https://github.com/noaione/third-draft) is a self-hosted mirror that tracks works and
their chapters. Like the [Komga plugin](./komga-plugin.md), it talks to *your own* server, so it
needs a bit of one-time setup after installing.

1. Install the Third Draft plugin.
2. Create an API key on your instance under **Your account → API keys**. A read-only key is enough:
   the plugin only needs `GET` access to the library. The secret is shown once, so copy it then.
3. On the installed plugins page, press the cog icon to open the plugin settings.
4. Fill in the server URL (e.g. `https://library.example.com`) and the API key (it starts with `td_`).
5. Press save and restart the app.
6. The Third Draft plugin will now work like the other plugins.

## What you get

- The library list and search come from the instance, so only works someone has tracked on the
  server are visible.
- A novel is a mirrored work; its chapters are the stored chapters in their original order.
- Chapter text is the mirrored content plus the chapter summary, author's notes and end notes.
- Images inside a chapter are served by the instance and are loaded with the same API key, so the
  key must stay valid for images to keep rendering.
- Covers are not part of a work, so novels show the default cover.

## Notes

- The plugin sends the key as `Authorization: Bearer <key>`; a key that has been revoked or has
  expired stops working immediately, and the plugin reports the `401` instead of an empty library.
- Keys cannot manage authentication (passkeys, password, other keys), so a leaked key cannot be
  used to mint a replacement.
- If no works are synced into the instance yet, the library is empty even though the key is
  valid; run a sync in **Admin → Sync** first.
