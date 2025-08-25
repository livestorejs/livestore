import process from "node:process";
import { makeAdapter } from "@livestore/adapter-node";
import { createStorePromise, queryDb } from "@livestore/livestore";
import { makeCfSync } from "@livestore/sync-cf";
import { events, schema, tables } from "./livestore/schema.ts";

const main = async () => {
	const adapter = makeAdapter({
		storage: { type: "fs", baseDirectory: "tmp" },
		sync: {
			backend: makeCfSync({ url: "ws://localhost:8787" }),
			onSyncError: "shutdown",
		},
	});

	const store = await createStorePromise({
		adapter,
		schema,
		storeId: process.env.STORE_ID ?? "test",
		syncPayload: { authToken: "insecure-token-change-me" },
	});

	store.subscribe(queryDb(tables.todos), {
		skipInitialRun: false,
		onUpdate: (todos) => {
			const todo = todos[todos.length - 1];
			console.log("onUpdate", todos);
			if (!todo) return;
			store.commit(
				events.commentCreated({
					id: crypto.randomUUID(),
					todoId: todo.id,
					text: "Action created from onUpdate",
				}),
			);
		},
	});

	store.subscribe(queryDb(tables.comments), {
		skipInitialRun: false,
		onUpdate: (comments) => {
			console.log("comments", comments.length);
		},
	});

	setInterval(() => {
		store.commit(
			events.todoCreated({
				id: crypto.randomUUID(),
				text: "Task created from node-adapter",
			}),
		);
	}, 1000);

	// TODO wait for syncing to be complete

	await new Promise((resolve) => setTimeout(resolve, 10 * 1000));

	await store.shutdown();
};

main().catch(console.error);
