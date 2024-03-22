ElectricSQL setup

This is a POC combining LiveStore and ElectricSQL, with Electric running on the main thread.

You need Docker, and to get the backend running

```sh
pnpm
pnpm backend:up
pnpm db:migrate
pnpm client:generate
```

Then to start front end:

```bash
pnpm dev
```

This will:

1. Start Docker compose with an Electric and Postgres
2. Migrate the Postgres database
3. Generate the Electric client

To load the dataset, extract to the zip to backend/data/, then run `pnpm load-data`

To tare down the Docker and remove all volumes:

```sh
pnpm backend:down
```
