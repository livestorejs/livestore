# @livestore/adapter-web

## Current limitations

- Note that until [this Vite bug](https://github.com/vitejs/vite/issues/8427) is fixed you need to ...
  - Explicitly add `@livestore/wa-sqlite` to your `package.json`
  - Add the following to your `vite.config.js`
    ```
      optimizeDeps: {
    		exclude: ['@livestore/wa-sqlite'],
    	},
    ```

## Extension discovery

The app sends its session registration immediately and listens for the content
script's readiness announcement. If injection happens after the initial request,
the announcement triggers registration once the listener exists. There are no
timed retries. An older extension can still answer the initial request without
announcing readiness; an older app can still register after the extension listener
has been installed.

This additive bootstrap message does not change DevTools protocol version 1.
Legacy window channels ignore the unknown announcement, and request/response
messages are unchanged. The protocol-mismatch overlay remains driven by the
leader/session Ping protocol version, not extension bootstrap messages.
